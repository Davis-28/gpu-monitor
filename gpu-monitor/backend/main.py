"""
Bledot GPU Monitor — Backend v3
Foco: custo real, automação, processos, profundidade técnica.
"""
import os, json, io, csv
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from database import init_db, get_conn
from intelligence import (
    compute_efficiency_score, score_label,
    detect_waste, generate_insights,
    cost_this_sample, wasted_cost,
    project_cost, vram_exhaustion_eta,
    AUTOMATION_RULES,
)
from alerter import alert_if_needed

app = FastAPI(title="Bledot GPU Monitor", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

SAMPLE_SEC = 5

# ── In-memory idle tracker (machine_id+gpu_id → consecutive idle seconds) ──
_idle_tracker: dict[str, int] = {}
_auto_actions: dict[str, bool] = {}  # rule_code → enabled

@app.on_event("startup")
def startup():
    init_db()
    print("✅ Bledot GPU Monitor Backend v3")

# ── Models ─────────────────────────────────────────────────────────────
class ProcessInfo(BaseModel):
    pid: int
    name: str
    memory_mb: int
    utilization_pct: float = 0.0

class MetricPayload(BaseModel):
    machine_id:   str
    gpu_id:       int
    gpu_name:     Optional[str]   = None
    timestamp:    str
    utilization:  float
    vram_used_mb: int
    vram_free_mb: int
    vram_total_mb: int
    temperature_c: int
    power_draw_w:  int
    power_limit_w: Optional[int]  = None
    throughput_tokens_per_sec: Optional[float] = None
    latency_ms:    Optional[float] = None
    batch_time_ms: Optional[float] = None
    batch_efficiency: Optional[float] = None
    error_rate:    Optional[float] = None
    memory_bandwidth_pct: Optional[float] = None
    phase:         Optional[str]  = None
    processes:     Optional[List[ProcessInfo]] = []
    cost_per_hour: float = 2.50

class SettingPayload(BaseModel):
    key: str; value: str

class AutomationPayload(BaseModel):
    rule_code: str; enabled: bool

# ── /health ─────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    with get_conn() as c:
        count = c.execute("SELECT COUNT(*) FROM metrics").fetchone()[0]
    return {"status":"ok","time":datetime.now(timezone.utc).isoformat(),"total_metrics":count}

# ── /metrics POST ────────────────────────────────────────────────────────
@app.post("/metrics")
def receive_metrics(p: MetricPayload):
    score = compute_efficiency_score(
        p.utilization, p.vram_used_mb, p.vram_total_mb,
        p.throughput_tokens_per_sec, p.batch_efficiency, p.memory_bandwidth_pct)
    waste = detect_waste(
        p.utilization, p.vram_used_mb, p.vram_total_mb,
        p.temperature_c, score, p.error_rate,
        p.memory_bandwidth_pct, p.batch_efficiency)

    sample_cost  = cost_this_sample(p.cost_per_hour, SAMPLE_SEC)
    max_waste    = max((w.waste_pct for w in waste), default=0)
    wasted       = wasted_cost(p.cost_per_hour, max_waste, SAMPLE_SEC)

    alert_if_needed(p.machine_id, p.gpu_id, waste, score)

    # Idle tracker → automação
    key = f"{p.machine_id}_{p.gpu_id}"
    if p.utilization < 5:
        _idle_tracker[key] = _idle_tracker.get(key, 0) + SAMPLE_SEC
    else:
        _idle_tracker[key] = 0

    idle_seconds = _idle_tracker.get(key, 0)

    with get_conn() as c:
        # Pega settings de idle threshold
        row = c.execute("SELECT value FROM settings WHERE key='idle_shutdown_minutes'").fetchone()
        idle_threshold_min = int(row["value"]) if row else 15

        cur = c.execute("""
            INSERT INTO metrics (
                machine_id,gpu_id,gpu_name,timestamp,
                utilization,vram_used_mb,vram_free_mb,vram_total_mb,
                temperature_c,power_draw_w,power_limit_w,
                throughput_tokens_per_sec,latency_ms,
                batch_time_ms,batch_efficiency,error_rate,
                memory_bandwidth_pct,phase,
                cost_per_hour,efficiency_score,cost_this_sample
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (p.machine_id,p.gpu_id,p.gpu_name,p.timestamp,
             p.utilization,p.vram_used_mb,p.vram_free_mb,p.vram_total_mb,
             p.temperature_c,p.power_draw_w,p.power_limit_w,
             p.throughput_tokens_per_sec,p.latency_ms,
             p.batch_time_ms,p.batch_efficiency,p.error_rate,
             p.memory_bandwidth_pct,p.phase,
             p.cost_per_hour,score,sample_cost))
        metric_id = cur.lastrowid

        # Salva processos
        total_proc_mem = sum(pr.memory_mb for pr in (p.processes or []))
        for pr in (p.processes or []):
            mem_frac = pr.memory_mb / total_proc_mem if total_proc_mem > 0 else 0
            proc_cost = sample_cost * mem_frac
            c.execute("""INSERT INTO processes
                (metric_id,machine_id,gpu_id,timestamp,pid,name,memory_mb,utilization_pct,cost_attributed)
                VALUES (?,?,?,?,?,?,?,?,?)""",
                (metric_id,p.machine_id,p.gpu_id,p.timestamp,
                 pr.pid,pr.name,pr.memory_mb,pr.utilization_pct,round(proc_cost,8)))

        # Automação: registrar idle shutdown
        rule = c.execute("SELECT value FROM settings WHERE key='auto_shutdown_enabled'").fetchone()
        auto_enabled = rule and rule["value"] == "true"
        if auto_enabled and idle_seconds >= idle_threshold_min * 60:
            # Verifica se já não foi logado nos últimos 5 min
            recent = c.execute("""
                SELECT id FROM automation_log
                WHERE machine_id=? AND gpu_id=? AND action='shutdown_gpu'
                AND timestamp > datetime('now','-5 minutes')""",
                (p.machine_id, p.gpu_id)).fetchone()
            if not recent:
                c.execute("""INSERT INTO automation_log
                    (timestamp,machine_id,gpu_id,action,reason,executed)
                    VALUES (?,?,?,?,?,?)""",
                    (p.timestamp, p.machine_id, p.gpu_id,
                     "shutdown_gpu",
                     f"GPU ociosa por {idle_seconds//60} minutos",
                     1))

    return {
        "ok": True,
        "efficiency_score": score,
        "cost_per_hour_realtime": round(p.cost_per_hour * (p.utilization/100 + 0.1), 4),
        "wasted_this_sample": wasted,
        "idle_seconds": idle_seconds,
    }

# ── /metrics GET ─────────────────────────────────────────────────────────
@app.get("/metrics")
def get_metrics(machine_id: Optional[str]=None, gpu_id: Optional[int]=None,
                minutes: int=Query(30,ge=1,le=1440), limit: int=Query(300,ge=1,le=5000)):
    since = (datetime.now(timezone.utc)-timedelta(minutes=minutes)).isoformat()
    f,p   = ["timestamp >= ?"], [since]
    if machine_id: f.append("machine_id = ?"); p.append(machine_id)
    if gpu_id is not None: f.append("gpu_id = ?"); p.append(gpu_id)
    p.append(limit)
    with get_conn() as c:
        rows = c.execute(
            f"SELECT * FROM metrics WHERE {' AND '.join(f)} ORDER BY timestamp DESC LIMIT ?",p
        ).fetchall()
    return [dict(r) for r in rows]

# ── /insights ────────────────────────────────────────────────────────────
@app.get("/insights")
def get_insights(machine_id: Optional[str]=None, gpu_id: Optional[int]=None):
    q = """SELECT m.* FROM metrics m
           INNER JOIN (SELECT machine_id,gpu_id,MAX(timestamp) ts FROM metrics GROUP BY machine_id,gpu_id) l
           ON m.machine_id=l.machine_id AND m.gpu_id=l.gpu_id AND m.timestamp=l.ts"""
    f,p = [],[]
    if machine_id: f.append("m.machine_id=?"); p.append(machine_id)
    if gpu_id is not None: f.append("m.gpu_id=?"); p.append(gpu_id)
    if f: q += " WHERE " + " AND ".join(f)
    with get_conn() as c: rows = c.execute(q,p).fetchall()

    res = []
    for row in rows:
        r     = dict(row)
        score = r["efficiency_score"] or 0
        waste = detect_waste(r["utilization"],r["vram_used_mb"],r["vram_total_mb"],
                             r["temperature_c"],score,r.get("error_rate"),
                             r.get("memory_bandwidth_pct"),r.get("batch_efficiency"))
        ins   = generate_insights(r["utilization"],r["vram_used_mb"],r["vram_total_mb"],
                                   r.get("throughput_tokens_per_sec"),score,waste,
                                   r.get("batch_efficiency"),r.get("error_rate"),
                                   r.get("latency_ms"),r.get("memory_bandwidth_pct"),
                                   r.get("cost_per_hour",2.5))
        key   = f"{r['machine_id']}_{r['gpu_id']}"
        res.append({
            "machine_id":r["machine_id"],"gpu_id":r["gpu_id"],"gpu_name":r["gpu_name"],
            "last_seen":r["timestamp"],"efficiency_score":score,
            "score_label":score_label(score),"phase":r.get("phase"),
            "idle_seconds":_idle_tracker.get(key,0),
            "waste_signals":[{"code":w.code,"severity":w.severity,"message":w.message,
                               "action":w.action,"waste_pct":w.waste_pct,
                               "can_automate":w.can_automate} for w in waste],
            "insights":[{"type":i.type,"title":i.title,"description":i.description,
                         "estimated_savings_per_hour":i.estimated_savings_per_hour} for i in ins],
        })
    return res

# ── /costs ───────────────────────────────────────────────────────────────
@app.get("/costs")
def get_costs(machine_id: Optional[str]=None,
              minutes: int=Query(60,ge=1,le=10080)):
    since = (datetime.now(timezone.utc)-timedelta(minutes=minutes)).isoformat()
    f,p   = ["timestamp >= ?"], [since]
    if machine_id: f.append("machine_id=?"); p.append(machine_id)
    where = " AND ".join(f)
    with get_conn() as c:
        rows = c.execute(f"""
            SELECT machine_id,gpu_id,gpu_name,cost_per_hour,
                   COUNT(*) samples,
                   AVG(utilization) avg_util,
                   AVG(efficiency_score) avg_score,
                   AVG(batch_efficiency) avg_batch_eff,
                   SUM(cost_this_sample) total_cost,
                   MIN(timestamp) first_ts, MAX(timestamp) last_ts
            FROM metrics WHERE {where} GROUP BY machine_id,gpu_id
        """, p).fetchall()
        # All-time total
        total_all = c.execute("SELECT COALESCE(SUM(cost_this_sample),0) FROM metrics").fetchone()[0]
        # All-time wasted (util < 30%)
        wasted_all = c.execute("""
            SELECT COALESCE(SUM(cost_this_sample * CASE WHEN utilization < 30
                THEN (30-utilization)/30.0 ELSE 0 END),0) FROM metrics""").fetchone()[0]

    gpus, total, total_wasted = [], 0.0, 0.0
    for row in rows:
        r    = dict(row)
        cost = r["total_cost"] or 0
        avg_u= r["avg_util"] or 0
        waste_pct = round(max(0,(30-avg_u)/30*100),1) if avg_u < 30 else 0
        wasted_c  = round(cost * waste_pct / 100, 4)
        total += cost; total_wasted += wasted_c
        gpus.append({
            "machine_id":r["machine_id"],"gpu_id":r["gpu_id"],"gpu_name":r["gpu_name"],
            "cost_usd":round(cost,4),"cost_per_hour":r["cost_per_hour"],
            "wasted_cost_usd":wasted_c,"waste_pct":waste_pct,
            "avg_utilization":round(avg_u,1),
            "avg_efficiency_score":round(r["avg_score"] or 0,1),
            "avg_batch_efficiency":round(r["avg_batch_eff"] or 0,1),
            "hours_active":round(r["samples"]*SAMPLE_SEC/3600,3),
            "first_seen":r["first_ts"],"last_seen":r["last_ts"],
        })
    return {
        "period_minutes":minutes,
        "total_cost_usd":round(total,4),
        "total_wasted_usd":round(total_wasted,4),
        "total_all_time_usd":round(total_all,4),
        "total_wasted_all_time_usd":round(wasted_all,4),
        "gpus":gpus,
    }

# ── /costs/history ───────────────────────────────────────────────────────
@app.get("/costs/history")
def cost_history(machine_id: Optional[str]=None, gpu_id: Optional[int]=None,
                 minutes: int=Query(60,ge=5,le=1440), buckets: int=Query(40,ge=5,le=100)):
    since = (datetime.now(timezone.utc)-timedelta(minutes=minutes)).isoformat()
    f,p   = ["timestamp >= ?"], [since]
    if machine_id: f.append("machine_id=?"); p.append(machine_id)
    if gpu_id is not None: f.append("gpu_id=?"); p.append(gpu_id)
    with get_conn() as c:
        rows = c.execute(
            f"SELECT timestamp,cost_this_sample,efficiency_score,utilization FROM metrics WHERE {' AND '.join(f)} ORDER BY timestamp ASC",p
        ).fetchall()
    if not rows: return []
    bsz  = max(1, len(rows)//buckets)
    hist, cum = [], 0.0
    for i in range(0, len(rows), bsz):
        chunk = rows[i:i+bsz]
        cum  += sum(dict(r)["cost_this_sample"] or 0 for r in chunk)
        last  = dict(chunk[-1])
        hist.append({
            "t":last["timestamp"][:19].replace("T"," "),
            "cumulative_cost":round(cum,5),
            "avg_score":round(sum(dict(r)["efficiency_score"] or 0 for r in chunk)/len(chunk),1),
            "avg_util":round(sum(dict(r)["utilization"] or 0 for r in chunk)/len(chunk),1),
        })
    return hist

# ── /processes ───────────────────────────────────────────────────────────
@app.get("/processes")
def get_processes(machine_id: Optional[str]=None, gpu_id: Optional[int]=None,
                  minutes: int=Query(30,ge=1,le=1440)):
    since = (datetime.now(timezone.utc)-timedelta(minutes=minutes)).isoformat()
    f,p   = ["timestamp >= ?"], [since]
    if machine_id: f.append("machine_id=?"); p.append(machine_id)
    if gpu_id is not None: f.append("gpu_id=?"); p.append(gpu_id)
    where = " AND ".join(f)
    with get_conn() as c:
        rows = c.execute(f"""
            SELECT machine_id,gpu_id,name,pid,
                   SUM(cost_attributed) total_cost,
                   AVG(utilization_pct) avg_util,
                   AVG(memory_mb) avg_mem,
                   COUNT(*) samples,
                   MAX(timestamp) last_seen
            FROM processes WHERE {where}
            GROUP BY machine_id,gpu_id,name,pid
            ORDER BY total_cost DESC
        """, p).fetchall()
    return [dict(r) for r in rows]

# ── /projection ──────────────────────────────────────────────────────────
@app.get("/projection")
def get_projection(machine_id: Optional[str]=None, gpu_id: Optional[int]=None,
                   estimated_total_hours: Optional[float]=None):
    since = (datetime.now(timezone.utc)-timedelta(hours=24)).isoformat()
    f,p   = ["timestamp >= ?"], [since]
    if machine_id: f.append("machine_id=?"); p.append(machine_id)
    if gpu_id is not None: f.append("gpu_id=?"); p.append(gpu_id)
    with get_conn() as c:
        row = c.execute(
            f"SELECT COUNT(*) samples,AVG(cost_per_hour) cph,SUM(cost_this_sample) total FROM metrics WHERE {' AND '.join(f)}",p
        ).fetchone()
        vram_rows = c.execute(
            f"SELECT vram_used_mb,vram_total_mb FROM metrics WHERE {' AND '.join(f)} ORDER BY timestamp DESC LIMIT 12",p
        ).fetchall()
    if not row or not row["samples"]: return {"error":"Sem dados suficientes"}
    r = dict(row)
    elapsed = r["samples"]*SAMPLE_SEC/3600
    proj    = project_cost(r["cph"], elapsed, r["total"] or 0, estimated_total_hours)
    if len(vram_rows) >= 2:
        old = dict(vram_rows[-1]); new = dict(vram_rows[0])
        growth = (new["vram_used_mb"] - old["vram_used_mb"])
        proj["vram_exhaustion_minutes"] = vram_exhaustion_eta(
            new["vram_used_mb"], new["vram_total_mb"], max(0, growth))
    return proj

# ── /machines ────────────────────────────────────────────────────────────
@app.get("/machines")
def list_machines():
    with get_conn() as c:
        rows = c.execute("""
            SELECT machine_id,gpu_id,gpu_name,
                   COUNT(*) total_samples, MAX(timestamp) last_seen,
                   AVG(efficiency_score) avg_score,
                   SUM(cost_this_sample) total_cost
            FROM metrics GROUP BY machine_id,gpu_id ORDER BY machine_id,gpu_id
        """).fetchall()
    return [dict(r) for r in rows]

# ── /automation ──────────────────────────────────────────────────────────
@app.get("/automation/log")
def get_automation_log(limit: int=Query(50,ge=1,le=200)):
    with get_conn() as c:
        rows = c.execute(
            "SELECT * FROM automation_log ORDER BY timestamp DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]

@app.get("/automation/rules")
def get_rules():
    with get_conn() as c:
        settings = {r["key"]:r["value"] for r in c.execute("SELECT key,value FROM settings").fetchall()}
    return [{"code":r.code,"description":r.description,
             "condition":r.condition,"action":r.action,
             "enabled":settings.get(f"auto_{r.code.lower()}","false")=="true"}
            for r in AUTOMATION_RULES]

@app.post("/automation/rules")
def set_rule(p: AutomationPayload):
    with get_conn() as c:
        c.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                  (f"auto_{p.rule_code.lower()}", "true" if p.enabled else "false"))
    return {"ok":True}

# ── /settings ────────────────────────────────────────────────────────────
@app.get("/settings")
def get_settings():
    with get_conn() as c:
        rows = c.execute("SELECT key,value FROM settings").fetchall()
    return {r["key"]:r["value"] for r in rows}

@app.post("/settings")
def upsert_setting(p: SettingPayload):
    with get_conn() as c:
        c.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                  (p.key, p.value))
    return {"ok":True}

# ── /export/csv ──────────────────────────────────────────────────────────
@app.get("/export/csv")
def export_csv(machine_id: Optional[str]=None, minutes: int=Query(60,ge=1,le=10080)):
    since = (datetime.now(timezone.utc)-timedelta(minutes=minutes)).isoformat()
    f,p   = ["timestamp >= ?"], [since]
    if machine_id: f.append("machine_id=?"); p.append(machine_id)
    with get_conn() as c:
        rows = c.execute(
            f"SELECT * FROM metrics WHERE {' AND '.join(f)} ORDER BY timestamp DESC", p
        ).fetchall()
    out = io.StringIO()
    if rows:
        w = csv.DictWriter(out, fieldnames=dict(rows[0]).keys())
        w.writeheader(); w.writerows([dict(r) for r in rows])
    out.seek(0)
    return StreamingResponse(iter([out.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition":f"attachment; filename=bledot_gpu_{minutes}min.csv"})

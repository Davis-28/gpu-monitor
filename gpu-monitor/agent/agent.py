"""
Bledot GPU Monitor Agent v3
Coleta métricas, processos e envia ao backend.
"""
import os, time, random, requests, json
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

BACKEND_URL       = os.getenv("BACKEND_URL", "http://localhost:8000")
SEND_INTERVAL     = int(os.getenv("SEND_INTERVAL", "5"))
GPU_COST_PER_HOUR = float(os.getenv("GPU_COST_PER_HOUR", "2.50"))
MACHINE_ID        = os.getenv("MACHINE_ID", "machine-01")
SIMULATED_GPUS    = int(os.getenv("SIMULATED_GPUS", "2"))

try:
    import pynvml
    pynvml.nvmlInit()
    GPU_COUNT = pynvml.nvmlDeviceGetCount()
    REAL_GPU = True
    print(f"✅ GPU real: {GPU_COUNT} device(s)")
except Exception:
    REAL_GPU = False
    GPU_COUNT = SIMULATED_GPUS
    print(f"⚠️  Simulando {GPU_COUNT} GPUs")

SIMULATED_PROCESSES = [
    {"pid": 1001, "name": "python train.py",     "memory_mb": 0},
    {"pid": 1002, "name": "jupyter-notebook",    "memory_mb": 0},
    {"pid": 1003, "name": "python inference.py", "memory_mb": 0},
    {"pid": 1004, "name": "tensorboard",         "memory_mb": 0},
]

class SimulatedGPU:
    PHASE_LEN = [80, 30, 20, 50]
    PHASES    = ["training", "evaluation", "idle", "moderate"]

    def __init__(self, gid):
        self.gid        = gid
        self.names      = ["NVIDIA A100 80GB", "NVIDIA RTX 4090", "NVIDIA V100 32GB"]
        self.name       = self.names[gid % len(self.names)]
        self.vram_total = 81920 if "A100" in self.name else 24576
        self.max_power  = 400   if "A100" in self.name else 350
        self._phase = 0; self._tick = 0

    def tick(self):
        self._tick += 1
        if self._tick >= self.PHASE_LEN[self._phase]:
            self._tick = 0
            self._phase = (self._phase + 1) % 4

    def metrics(self):
        self.tick(); p = self._phase
        if p == 0:
            util=random.uniform(72,96); vram_pct=random.uniform(58,88)
            pw=random.uniform(78,98);   thr=random.uniform(850,1300)
            bt=random.uniform(80,140);  be=random.uniform(65,92)
            er=random.uniform(0,.5);    bw=random.uniform(65,90)
        elif p == 1:
            util=random.uniform(12,32); vram_pct=random.uniform(38,62)
            pw=random.uniform(28,48);   thr=random.uniform(80,280)
            bt=random.uniform(200,600); be=random.uniform(15,35)
            er=random.uniform(0,.2);    bw=random.uniform(20,45)
        elif p == 2:
            util=random.uniform(1,10);  vram_pct=random.uniform(4,14)
            pw=random.uniform(8,18);    thr=random.uniform(0,40)
            bt=0.0;                     be=random.uniform(0,5)
            er=0.0;                     bw=random.uniform(2,12)
        else:
            util=random.uniform(42,72); vram_pct=random.uniform(48,78)
            pw=random.uniform(52,76);   thr=random.uniform(380,820)
            bt=random.uniform(120,260); be=random.uniform(40,70)
            er=random.uniform(0,1.0);   bw=random.uniform(40,70)

        vu = int(self.vram_total * vram_pct / 100)
        # Processos simulados
        procs = []
        if util > 20:
            n_procs = random.randint(1, 3)
            total_proc_mem = vu
            for i in range(n_procs):
                proc = dict(SIMULATED_PROCESSES[i % len(SIMULATED_PROCESSES)])
                proc["memory_mb"] = int(total_proc_mem / n_procs * random.uniform(0.7, 1.3))
                proc["utilization_pct"] = round(util / n_procs * random.uniform(0.5, 1.5), 1)
                procs.append(proc)

        return {
            "gpu_id": self.gid, "gpu_name": self.name,
            "utilization": round(util, 1),
            "vram_used_mb": vu, "vram_free_mb": self.vram_total - vu,
            "vram_total_mb": self.vram_total,
            "temperature_c": int(42 + (util/100)*43 + random.uniform(-3,3)),
            "power_draw_w": int(self.max_power * pw / 100),
            "power_limit_w": self.max_power,
            "throughput_tokens_per_sec": round(thr, 1),
            "latency_ms": round(1000/thr if thr > 0 else 9999, 2),
            "batch_time_ms": round(bt, 2),
            "batch_efficiency": round(be, 1),
            "error_rate": round(er, 3),
            "memory_bandwidth_pct": round(bw, 1),
            "phase": self.PHASES[p],
            "processes": procs,
        }

sims = [SimulatedGPU(i) for i in range(GPU_COUNT)] if not REAL_GPU else []

def collect_real(gid):
    h    = pynvml.nvmlDeviceGetHandleByIndex(gid)
    name = pynvml.nvmlDeviceGetName(h)
    if isinstance(name, bytes): name = name.decode()
    util = pynvml.nvmlDeviceGetUtilizationRates(h)
    mem  = pynvml.nvmlDeviceGetMemoryInfo(h)
    temp = pynvml.nvmlDeviceGetTemperature(h, pynvml.NVML_TEMPERATURE_GPU)
    pwr  = pynvml.nvmlDeviceGetPowerUsage(h) // 1000
    try:    plim = pynvml.nvmlDeviceGetPowerManagementLimit(h) // 1000
    except: plim = None
    # Processos reais
    procs = []
    try:
        for p in pynvml.nvmlDeviceGetComputeRunningProcesses(h):
            procs.append({"pid": p.pid, "name": f"PID {p.pid}",
                          "memory_mb": p.usedGpuMemory // (1024*1024),
                          "utilization_pct": 0})
    except: pass
    return {
        "gpu_id": gid, "gpu_name": name,
        "utilization": float(util.gpu),
        "vram_used_mb": mem.used//(1024*1024),
        "vram_free_mb": mem.free//(1024*1024),
        "vram_total_mb": mem.total//(1024*1024),
        "temperature_c": temp, "power_draw_w": pwr, "power_limit_w": plim,
        "throughput_tokens_per_sec": None, "latency_ms": None,
        "batch_time_ms": None, "batch_efficiency": None,
        "error_rate": None, "memory_bandwidth_pct": float(util.memory),
        "phase": None, "processes": procs,
    }

def collect():
    out = []
    for i in range(GPU_COUNT):
        try:
            d = collect_real(i) if REAL_GPU else sims[i].metrics()
            d["machine_id"]    = MACHINE_ID
            d["timestamp"]     = datetime.now(timezone.utc).isoformat()
            d["cost_per_hour"] = GPU_COST_PER_HOUR
            out.append(d)
        except Exception as e:
            print(f"  ⚠ GPU {i}: {e}")
    return out

def send(metrics):
    for m in metrics:
        try:
            r = requests.post(f"{BACKEND_URL}/metrics", json=m, timeout=5)
            if r.status_code == 200:
                data  = r.json()
                score = data.get("efficiency_score", "?")
                cost  = data.get("cost_per_hour_realtime", "?")
                print(f"  📤 GPU {m['gpu_id']} | util={m['utilization']}% | score={score} | ${cost}/h | sent ✓")
            else:
                print(f"  ❌ HTTP {r.status_code}")
        except requests.exceptions.ConnectionError:
            print(f"  ❌ Backend offline")
        except Exception as e:
            print(f"  ❌ {e}")

def main():
    print("="*55)
    print("  ◈ Bledot GPU Monitor Agent v3")
    print(f"  Machine: {MACHINE_ID} | GPUs: {GPU_COUNT}")
    print(f"  Backend: {BACKEND_URL}")
    print(f"  Cost/hr: ${GPU_COST_PER_HOUR:.2f}")
    print("="*55)
    while True:
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Coletando...")
        send(collect())
        time.sleep(SEND_INTERVAL)

if __name__ == "__main__":
    main()

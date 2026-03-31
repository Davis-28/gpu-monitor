"""
Bledot Intelligence Engine v3
Foco: dinheiro primeiro, profundidade técnica completa.
"""
from dataclasses import dataclass, field
from typing import Optional

# ── Score ──────────────────────────────────────────────────────────────
def compute_efficiency_score(util, vram_used, vram_total,
                              throughput=None, batch_eff=None, mem_bw=None):
    vram_pct   = (vram_used / vram_total * 100) if vram_total > 0 else 0
    util_score = min(util / 70 * 100, 100)
    vram_score = min(vram_pct / 50 * 100, 100)
    extras = []
    if throughput and throughput > 0: extras.append(min(throughput / 1000 * 100, 100))
    if batch_eff is not None:         extras.append(batch_eff)
    if mem_bw is not None:            extras.append(min(mem_bw / 70 * 100, 100))
    if extras:
        score = util_score*.35 + vram_score*.30 + (sum(extras)/len(extras))*.35
    else:
        score = util_score*.55 + vram_score*.45
    return round(min(score, 100), 1)

def score_label(s):
    return "eficiente" if s >= 70 else "médio" if s >= 40 else "ineficiente"

# ── Waste signals ──────────────────────────────────────────────────────
@dataclass
class WasteSignal:
    code: str
    severity: str          # high | medium | low
    message: str
    action: str
    waste_pct: float = 0.0
    can_automate: bool = False

def detect_waste(util, vram_used, vram_total, temp, score,
                 error_rate=None, mem_bw=None, batch_eff=None):
    signals = []
    vram_pct = (vram_used / vram_total * 100) if vram_total > 0 else 0

    if util < 5 and vram_pct < 5:
        signals.append(WasteSignal("GPU_IDLE","high",
            "GPU completamente ociosa — pagando sem usar",
            "Desligue a instância imediatamente", 98.0, True))
    elif util < 30 and vram_pct < 30:
        w = round((30 - util) / 30 * 100, 1)
        signals.append(WasteSignal("GPU_UNDERUTILIZED","medium",
            "GPU subutilizada — desperdício financeiro ativo",
            "Aumente o batch size ou consolide workloads", w, True))
    elif util < 30:
        signals.append(WasteSignal("GPU_CPU_BOTTLENECK","medium",
            "Utilização baixa com VRAM alta — gargalo CPU/I-O",
            "Aumente num_workers e use prefetch no DataLoader", 40.0, False))

    if temp >= 85:
        signals.append(WasteSignal("TEMP_CRITICAL","high",
            f"Temperatura crítica {temp}°C — throttling iminente",
            "Reduza a carga e verifique refrigeração imediatamente", 0.0, False))
    elif temp >= 78:
        signals.append(WasteSignal("TEMP_HIGH","medium",
            f"Temperatura elevada {temp}°C",
            "Monitore — pode haver throttling térmico", 0.0, False))

    if score < 40 and util > 30:
        signals.append(WasteSignal("INEFFICIENT_WORKLOAD","medium",
            "Treino ineficiente — score baixo com GPU ativa",
            "Ative fp16/bf16 e revise hiperparâmetros", round((40-score)/40*60,1), False))

    if error_rate is not None and error_rate > 2.0:
        signals.append(WasteSignal("HIGH_ERROR_RATE","high",
            f"Taxa de erro alta: {error_rate:.1f}% — instabilidade no treino",
            "Reduza learning rate e aplique gradient clipping", 0.0, False))
    elif error_rate is not None and error_rate > 0.5:
        signals.append(WasteSignal("ELEVATED_ERROR_RATE","medium",
            f"Taxa de erro elevada: {error_rate:.1f}%",
            "Monitore convergência e ajuste hiperparâmetros", 0.0, False))

    if mem_bw is not None and mem_bw < 20 and util > 50:
        signals.append(WasteSignal("LOW_MEM_BW","medium",
            "GPU ativa com bandwidth de memória baixo — ops não otimizadas",
            "Use tensores contíguos em memória e otimize kernels CUDA", 0.0, False))

    if batch_eff is not None and batch_eff < 30 and util > 40:
        signals.append(WasteSignal("LOW_BATCH_EFF","medium",
            f"Batch efficiency baixa: {batch_eff:.0f}%",
            "Aumente o batch size — há capacidade de memória disponível", round((30-batch_eff)/30*40,1), False))

    return signals

# ── Insights ────────────────────────────────────────────────────────────
@dataclass
class Insight:
    type: str      # optimization | warning | info | action
    title: str
    description: str
    priority: int
    estimated_savings_per_hour: float = 0.0

def generate_insights(util, vram_used, vram_total, throughput, score,
                      waste_signals, batch_eff=None, error_rate=None,
                      latency_ms=None, mem_bw=None, cost_per_hour=2.5):
    insights = []
    vram_pct = (vram_used / vram_total * 100) if vram_total > 0 else 0

    if util < 50 and vram_pct < 40:
        savings = cost_per_hour * 0.3
        insights.append(Insight("optimization","Aumente o batch size",
            f"GPU a {util:.0f}% com {vram_pct:.0f}% VRAM. Dobrar o batch pode elevar eficiência sem custo extra.",
            1, savings))

    if vram_pct > 80 and util > 60:
        insights.append(Insight("optimization","Ative mixed precision (fp16/bf16)",
            "VRAM quase cheia. fp16/bf16 reduz uso ~50% e acelera em Tensor Cores.",
            2, cost_per_hour * 0.15))

    if util < 35 and throughput is not None and throughput < 200:
        insights.append(Insight("warning","Gargalo de dados/CPU detectado",
            f"GPU ociosa ({util:.0f}%) com throughput baixo ({throughput:.0f} tok/s). "
            "Aumente num_workers e use prefetch_factor=2.",
            1, cost_per_hour * 0.4))

    if util > 80 and vram_pct > 85:
        insights.append(Insight("optimization","Use gradient accumulation",
            "GPU e VRAM no limite. Gradient accumulation aumenta batch efetivo sem mais VRAM.",
            3, 0))

    if util < 10:
        insights.append(Insight("action","GPU ociosa — desligue agora",
            "GPU ativa sem carga. Cada hora custa $"+f"{cost_per_hour:.2f} sem retorno.",
            1, cost_per_hour * 0.95))

    if batch_eff is not None and batch_eff < 40:
        insights.append(Insight("optimization",f"Batch efficiency em {batch_eff:.0f}% — otimize o pipeline",
            "Remova .item() em loops de treino e elimine operações síncronas desnecessárias.",
            2, cost_per_hour * 0.2))

    if error_rate is not None and error_rate > 1.0:
        insights.append(Insight("warning","Taxa de erro preocupante",
            f"Error rate {error_rate:.2f}%. Use gradient clipping (max_norm=1.0) e reduza lr.",
            1, 0))

    if latency_ms is not None and latency_ms > 500:
        insights.append(Insight("optimization","Latência alta por token",
            f"{latency_ms:.0f}ms/token. Use torch.compile() ou FlashAttention.",
            3, cost_per_hour * 0.1))

    if mem_bw is not None and mem_bw > 85:
        insights.append(Insight("info","Memory bandwidth saturado",
            f"BW em {mem_bw:.0f}%. Modelo bem otimizado — aumente batch para saturar compute cores.",
            4, 0))

    if score >= 75 and not insights:
        insights.append(Insight("info","Workload eficiente",
            f"Score {score}/100. GPU bem aproveitada. Continue monitorando.",
            5, 0))

    return sorted(insights, key=lambda x: x.priority)

# ── Cost ────────────────────────────────────────────────────────────────
def cost_this_sample(cost_per_hour, interval_sec=5):
    return round(cost_per_hour * interval_sec / 3600, 8)

def wasted_cost(cost_per_hour, waste_pct, interval_sec=5):
    return round(cost_per_hour * (waste_pct/100) * interval_sec / 3600, 8)

# ── Automation ──────────────────────────────────────────────────────────
@dataclass
class AutomationRule:
    code: str
    description: str
    condition: str
    action: str

AUTOMATION_RULES = [
    AutomationRule("AUTO_SHUTDOWN_IDLE",
        "Desligar GPU ociosa automaticamente",
        "utilization < 5% por X minutos consecutivos",
        "shutdown_gpu"),
    AutomationRule("AUTO_ALERT_WASTE",
        "Alertar quando desperdício > 50%",
        "waste_pct > 50",
        "send_alert"),
    AutomationRule("AUTO_ALERT_TEMP",
        "Alertar temperatura crítica",
        "temperature >= 85",
        "send_alert"),
    AutomationRule("AUTO_LOG_INEFFICIENCY",
        "Registrar workloads ineficientes",
        "efficiency_score < 30",
        "log_event"),
]

# ── Projection ──────────────────────────────────────────────────────────
def project_cost(cost_per_hour, elapsed_hours, current_cost, total_hours=None):
    if elapsed_hours <= 0: return {}
    burn = current_cost / elapsed_hours
    res  = {"burn_rate_per_hour": round(burn,4),
            "current_cost":       round(current_cost,4),
            "elapsed_hours":      round(elapsed_hours,3)}
    if total_hours:
        remaining = max(0, total_hours - elapsed_hours)
        res["projected_total"]     = round(current_cost + burn * remaining, 4)
        res["projected_remaining"] = round(burn * remaining, 4)
        res["remaining_hours"]     = round(remaining, 2)
    return res

def vram_exhaustion_eta(vram_used, vram_total, growth_mb_per_min):
    if growth_mb_per_min <= 0: return None
    return round((vram_total - vram_used) / growth_mb_per_min, 1)

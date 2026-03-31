"""
Alertas automáticos — Slack + Email (opcional)
"""
import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()

SLACK_WEBHOOK    = os.getenv("SLACK_WEBHOOK_URL", "")
COOLDOWN_MINUTES = int(os.getenv("ALERT_COOLDOWN_MINUTES", "10"))

_last_alert: dict[str, float] = {}


def _can_send(code: str) -> bool:
    now  = time.time()
    last = _last_alert.get(code, 0)
    if now - last > COOLDOWN_MINUTES * 60:
        _last_alert[code] = now
        return True
    return False


def _slack(message: str):
    if not SLACK_WEBHOOK:
        return
    try:
        requests.post(SLACK_WEBHOOK, json={"text": message}, timeout=5)
    except Exception as e:
        print(f"  ⚠️  Slack error: {e}")


def alert_if_needed(
    machine_id: str,
    gpu_id: int,
    waste_signals,
    score: float,
    projected_cost: float = 0,
    cost_threshold: float = 0,
):
    for signal in waste_signals:
        key = f"{machine_id}_{gpu_id}_{signal.code}"
        if signal.severity == "high" and _can_send(key):
            _slack(
                f"🚨 *GPU Monitor Alert*\n"
                f"Machine: `{machine_id}` | GPU {gpu_id}\n"
                f"*{signal.message}*\n"
                f"➡️ {signal.action}"
            )

    if score < 30 and _can_send(f"{machine_id}_{gpu_id}_LOW_SCORE"):
        _slack(
            f"⚠️ *Score de Eficiência Baixo*\n"
            f"Machine: `{machine_id}` | GPU {gpu_id}\n"
            f"Score: *{score}/100*\n"
            f"➡️ Revise o workload em execução"
        )

    if cost_threshold > 0 and projected_cost > cost_threshold:
        key = f"{machine_id}_{gpu_id}_COST_THRESHOLD"
        if _can_send(key):
            _slack(
                f"💰 *Alerta de Custo*\n"
                f"Machine: `{machine_id}` | GPU {gpu_id}\n"
                f"Custo projetado *${projected_cost:.2f}* ultrapassou o limite de *${cost_threshold:.2f}*"
            )

"""
Simulação de treino PyTorch com envio de métricas ao GPU Monitor.
Roda sem GPU real — usa CPU.
"""

import os
import time
import random
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
MACHINE_ID = os.getenv("MACHINE_ID", "training-node-01")
GPU_COST_PER_HOUR = float(os.getenv("GPU_COST_PER_HOUR", "2.50"))

# Tenta usar PyTorch se disponível
try:
    import torch
    import torch.nn as nn
    HAS_TORCH = True
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"✅ PyTorch disponível — device: {DEVICE}")
except ImportError:
    HAS_TORCH = False
    print("⚠️  PyTorch não instalado — simulando métricas de treino")


class SimpleModel(nn.Module if HAS_TORCH else object):
    def __init__(self):
        if HAS_TORCH:
            super().__init__()
            self.net = nn.Sequential(
                nn.Linear(512, 1024),
                nn.ReLU(),
                nn.Linear(1024, 1024),
                nn.ReLU(),
                nn.Linear(1024, 256),
            )

    def forward(self, x):
        return self.net(x)


def send_training_metric(
    batch: int,
    total_batches: int,
    batch_time_ms: float,
    throughput: float,
    loss: float,
    simulated_gpu_util: float,
):
    payload = {
        "machine_id": MACHINE_ID,
        "gpu_id": 0,
        "gpu_name": "Training Node (simulated)",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "utilization": simulated_gpu_util,
        "vram_used_mb": int(4096 + throughput * 2),
        "vram_free_mb": int(24576 - 4096 - throughput * 2),
        "vram_total_mb": 24576,
        "temperature_c": int(65 + simulated_gpu_util / 10),
        "power_draw_w": int(200 + simulated_gpu_util * 1.5),
        "throughput_tokens_per_sec": throughput,
        "latency_ms": batch_time_ms,
        "cost_per_hour": GPU_COST_PER_HOUR,
    }
    try:
        resp = requests.post(f"{BACKEND_URL}/metrics", json=payload, timeout=3)
        status = "✓" if resp.status_code == 200 else f"✗ {resp.status_code}"
    except Exception:
        status = "✗ offline"

    print(
        f"  Batch {batch:4d}/{total_batches} | "
        f"loss={loss:.4f} | "
        f"thr={throughput:.0f} tok/s | "
        f"gpu={simulated_gpu_util:.0f}% | "
        f"backend={status}"
    )


def run_training():
    print("=" * 60)
    print("  🧠 GPU Monitor — Simulação de Treino")
    print(f"  Machine: {MACHINE_ID}")
    print(f"  Backend: {BACKEND_URL}")
    print("=" * 60)

    EPOCHS = 3
    BATCHES_PER_EPOCH = 50
    BATCH_SIZE = 32

    if HAS_TORCH:
        model = SimpleModel().to(DEVICE)
        optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4)
        criterion = nn.MSELoss()

    for epoch in range(EPOCHS):
        print(f"\n📚 Epoch {epoch + 1}/{EPOCHS}")
        epoch_loss = 0.0

        for batch in range(1, BATCHES_PER_EPOCH + 1):
            t_start = time.time()

            if HAS_TORCH:
                x = torch.randn(BATCH_SIZE, 512).to(DEVICE)
                y = torch.randn(BATCH_SIZE, 256).to(DEVICE)
                optimizer.zero_grad()
                out = model(x)
                loss_val = criterion(out, y)
                loss_val.backward()
                optimizer.step()
                loss = loss_val.item()
                # Simula tokens processados
                throughput = BATCH_SIZE * 512 / max(time.time() - t_start, 0.001)
                gpu_util = random.uniform(60, 90)
            else:
                # Simulação pura
                time.sleep(random.uniform(0.05, 0.15))
                loss = 2.5 * (0.98 ** (epoch * BATCHES_PER_EPOCH + batch))
                throughput = random.uniform(600, 1100)
                gpu_util = random.uniform(55, 92)

            batch_time = (time.time() - t_start) * 1000
            epoch_loss += loss

            # Envia a cada 5 batches para não sobrecarregar
            if batch % 5 == 0 or batch == 1:
                send_training_metric(
                    batch=batch,
                    total_batches=BATCHES_PER_EPOCH,
                    batch_time_ms=batch_time,
                    throughput=throughput,
                    loss=loss,
                    simulated_gpu_util=gpu_util,
                )

        print(f"  ✅ Epoch {epoch + 1} | avg loss: {epoch_loss / BATCHES_PER_EPOCH:.4f}")

    print("\n🏁 Treino concluído!")


if __name__ == "__main__":
    run_training()

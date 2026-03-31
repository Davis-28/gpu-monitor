# ◈ GPU Monitor — AI Cost Intelligence Platform

Sistema de monitoramento e otimização de uso de GPU para workloads de IA.
Gera **insights acionáveis** focados em redução de custo e aumento de eficiência.

---

##  Formas de Instalar e Rodar

---

## Opção 1 — Script de Instalação (mais simples)

### Linux / macOS
```bash
chmod +x install.sh && ./install.sh
./start.sh
```

### Windows
Clique duplo em **`install.bat`**, depois em **`start.bat`**

> Instala tudo automaticamente e gera os scripts de start.

**Pré-requisitos:** Python 3.10+ e Node.js 18+

---

## Opção 2 — Docker Compose (recomendado para produção)

```bash
cp .env.example .env   # configure custo/hora e Slack
docker compose up --build
```

Acesse **http://localhost:3000** — sem instalar Python ou Node.

Para GPU NVIDIA real no Docker, descomente no `docker-compose.yml`:
```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [gpu]
```

**Pré-requisito:** [Docker Desktop](https://docker.com/products/docker-desktop)

---

## Opção 3 — Executável standalone (distribuição ao cliente)

```bash
chmod +x build_executable.sh && ./build_executable.sh
# Executável gerado em: agent/dist/gpu-monitor-agent
```

O cliente não precisa instalar Python. Só cria um `.env` e executa o binário.

---

## Opção 4 — Manual (desenvolvimento)

```bash
# Terminal 1
cd backend && pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Terminal 2
cd agent && pip install -r requirements.txt
python agent.py

# Terminal 3
cd frontend && npm install && npm run dev
```

---

##  Estrutura

```
gpu-monitor/
├── install.sh / install.bat     ← Instaladores
├── start.sh / start.bat         ← Iniciadores (gerados pelo install)
├── docker-compose.yml           ← Sobe tudo com Docker
├── build_executable.sh          ← Gera binário do agent
├── .env.example                 ← Configuração
├── agent/
│   ├── agent.py
│   └── agent.spec               ← Config PyInstaller
├── backend/
│   ├── main.py
│   ├── intelligence.py          ← Score, insights, desperdício
│   ├── alerter.py
│   └── Dockerfile
├── frontend/
│   ├── src/App.jsx
│   ├── Dockerfile
│   └── nginx.conf
└── examples/
    └── training_simulation.py
```

---

##  Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `GPU_COST_PER_HOUR` | `2.50` | Custo por hora da GPU em USD |
| `MACHINE_ID` | `machine-01` | Nome desta máquina |
| `SEND_INTERVAL` | `5` | Intervalo de coleta (segundos) |
| `SLACK_WEBHOOK_URL` | *(vazio)* | Webhook para alertas Slack |
| `BACKEND_URL` | `http://localhost:8000` | URL do backend (usado pelo agent) |

### Custo por hora — referência AWS

| GPU | Instância | Custo/hora |
|---|---|---|
| NVIDIA A100 | p4d.24xlarge | ~$4.10 por GPU |
| NVIDIA V100 | p3.2xlarge | $3.06 |
| NVIDIA T4 | g4dn.xlarge | $0.53 |
| NVIDIA A10G | g5.xlarge | $1.01 |

---

##  API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Healthcheck |
| POST | `/metrics` | Recebe métricas |
| GET | `/metrics` | Histórico de métricas |
| GET | `/insights` | Score e insights por GPU |
| GET | `/costs` | Análise de custos |
| GET | `/machines` | Máquinas monitoradas |

Documentação interativa: **http://localhost:8000/docs**

---

##  Inteligência

**Score de Eficiência (0–100):** utilização GPU (40%) + VRAM (35%) + throughput (25%)

- 70–100 → Eficiente
- 40–70 →  Médio
- 0–40 →   Ineficiente

**Alertas Slack:** severidade alta + score < 30, com cooldown configurável

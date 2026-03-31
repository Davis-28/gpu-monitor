#!/usr/bin/env bash
# ============================================================
#  GPU Monitor — Instalador Linux/macOS
#  Uso: chmod +x install.sh && ./install.sh
# ============================================================

set -e

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

header() { echo -e "\n${CYAN}${BOLD}◈ $1${NC}"; }
ok()     { echo -e "  ${GREEN}✓${NC} $1"; }
warn()   { echo -e "  ${YELLOW}⚠${NC}  $1"; }
fail()   { echo -e "  ${RED}✗${NC} $1"; exit 1; }
step()   { echo -e "  ${BOLD}→${NC} $1"; }

clear
echo -e "${CYAN}${BOLD}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║     GPU Monitor — Instalador         ║"
echo "  ║     AI Cost Intelligence Platform    ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"

# ── Pré-requisitos ───────────────────────────────────────────
header "Verificando pré-requisitos"

# Python
if command -v python3 &>/dev/null; then
    PY=$(python3 --version 2>&1 | awk '{print $2}')
    ok "Python $PY encontrado"
    PYTHON=python3
elif command -v python &>/dev/null; then
    PY=$(python --version 2>&1 | awk '{print $2}')
    ok "Python $PY encontrado"
    PYTHON=python
else
    fail "Python não encontrado. Instale em https://python.org"
fi

# Node
if command -v node &>/dev/null; then
    NODE=$(node --version)
    ok "Node.js $NODE encontrado"
else
    fail "Node.js não encontrado. Instale em https://nodejs.org"
fi

# npm
if command -v npm &>/dev/null; then
    ok "npm $(npm --version) encontrado"
else
    fail "npm não encontrado"
fi

# GPU NVIDIA (opcional)
if command -v nvidia-smi &>/dev/null; then
    GPU=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
    ok "GPU NVIDIA detectada: $GPU"
else
    warn "GPU NVIDIA não detectada — modo simulação será usado"
fi

# ── Backend ──────────────────────────────────────────────────
header "Instalando Backend (FastAPI)"

step "Criando ambiente virtual..."
cd backend
$PYTHON -m venv .venv
source .venv/bin/activate

step "Instalando dependências Python..."
pip install -q --upgrade pip
pip install -q -r requirements.txt
ok "Dependências instaladas"

# .env
if [ ! -f .env ]; then
    cp .env.example .env
    ok ".env criado"
else
    ok ".env já existe"
fi

deactivate
cd ..

# ── Agent ────────────────────────────────────────────────────
header "Instalando Agent"

step "Criando ambiente virtual..."
cd agent
$PYTHON -m venv .venv
source .venv/bin/activate

step "Instalando dependências..."
pip install -q --upgrade pip
pip install -q -r requirements.txt
ok "Dependências instaladas"

if [ ! -f .env ]; then
    cp .env.example .env
    ok ".env criado"
else
    ok ".env já existe"
fi

deactivate
cd ..

# ── Frontend ─────────────────────────────────────────────────
header "Instalando Frontend (React)"

step "Instalando pacotes npm..."
cd frontend
npm install --silent
ok "Pacotes instalados"
cd ..

# ── Script de start ──────────────────────────────────────────
header "Criando script de inicialização"

cat > start.sh << 'EOF'
#!/usr/bin/env bash
# GPU Monitor — Inicializador

CYAN='\033[0;36m'; GREEN='\033[0;32m'; NC='\033[0m'; BOLD='\033[1m'

cleanup() {
    echo -e "\n\n  Encerrando todos os serviços..."
    kill $PID_BACKEND $PID_AGENT $PID_FRONTEND 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

clear
echo -e "${CYAN}${BOLD}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║     GPU Monitor — Iniciando...       ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"

# Backend
echo -e "  ${BOLD}→${NC} Iniciando Backend..."
cd backend
source .venv/bin/activate
uvicorn main:app --port 8000 --log-level warning &
PID_BACKEND=$!
deactivate
cd ..
sleep 2
echo -e "  ${GREEN}✓${NC} Backend rodando em http://localhost:8000"

# Agent
echo -e "  ${BOLD}→${NC} Iniciando Agent..."
cd agent
source .venv/bin/activate
python agent.py > ../logs/agent.log 2>&1 &
PID_AGENT=$!
deactivate
cd ..
echo -e "  ${GREEN}✓${NC} Agent coletando métricas"

# Frontend
echo -e "  ${BOLD}→${NC} Iniciando Frontend..."
cd frontend
npm run dev -- --port 3000 > ../logs/frontend.log 2>&1 &
PID_FRONTEND=$!
cd ..
sleep 3
echo -e "  ${GREEN}✓${NC} Dashboard em http://localhost:3000"

echo ""
echo -e "  ${CYAN}${BOLD}◈ GPU Monitor rodando!${NC}"
echo -e "  Acesse: ${BOLD}http://localhost:3000${NC}"
echo ""
echo -e "  Pressione ${BOLD}Ctrl+C${NC} para encerrar todos os serviços"
echo ""

wait
EOF

chmod +x start.sh
ok "start.sh criado"

# Cria pasta de logs
mkdir -p logs

# ── Resumo ───────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║        Instalação concluída!  ✓          ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Para iniciar o GPU Monitor, execute:"
echo -e "  ${BOLD}  ./start.sh${NC}"
echo ""
echo -e "  Dashboard: ${CYAN}http://localhost:3000${NC}"
echo -e "  API:       ${CYAN}http://localhost:8000/docs${NC}"
echo ""

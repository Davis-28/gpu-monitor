#!/usr/bin/env bash
# ============================================================
#  GPU Monitor — Build de Executável (PyInstaller)
#  Gera: agent/dist/gpu-monitor-agent (Linux/Mac)
#        agent/dist/gpu-monitor-agent.exe (Windows)
#  Uso: ./build_executable.sh
# ============================================================

set -e

GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

echo -e "\n${CYAN}${BOLD}◈ GPU Monitor — Build Executável${NC}\n"

# ── Instala PyInstaller ──────────────────────────────────────
echo "  → Instalando PyInstaller..."
cd agent

if [ ! -d .venv ]; then
    python3 -m venv .venv
fi

source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
pip install -q pyinstaller

# ── Build ────────────────────────────────────────────────────
echo "  → Buildando executável..."
pyinstaller agent.spec --clean --noconfirm

deactivate

# ── Resultado ────────────────────────────────────────────────
EXE="dist/gpu-monitor-agent"
[ -f "dist/gpu-monitor-agent.exe" ] && EXE="dist/gpu-monitor-agent.exe"

echo ""
echo -e "  ${GREEN}✓ Executável gerado: agent/${EXE}${NC}"
echo ""
echo "  Distribuição:"
echo "    1. Copie o executável para a máquina do cliente"
echo "    2. Crie um arquivo .env com BACKEND_URL e GPU_COST_PER_HOUR"
echo "    3. Execute: ./gpu-monitor-agent"
echo ""

cd ..

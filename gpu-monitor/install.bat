@echo off
:: ============================================================
::  GPU Monitor — Instalador Windows
::  Uso: clique duplo em install.bat
:: ============================================================

title GPU Monitor — Instalador
color 0B

echo.
echo   ==========================================
echo    GPU Monitor — AI Cost Intelligence
echo    Instalador Windows
echo   ==========================================
echo.

:: ── Pré-requisitos ────────────────────────────────────────────

echo   [1/4] Verificando pre-requisitos...
echo.

:: Python
python --version >nul 2>&1
if errorlevel 1 (
    echo   [ERRO] Python nao encontrado.
    echo   Instale em: https://python.org
    echo   Marque "Add Python to PATH" durante a instalacao!
    pause
    exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo   [OK] Python %PY_VER% encontrado

:: Node
node --version >nul 2>&1
if errorlevel 1 (
    echo   [ERRO] Node.js nao encontrado.
    echo   Instale em: https://nodejs.org
    pause
    exit /b 1
)
for /f %%v in ('node --version') do set NODE_VER=%%v
echo   [OK] Node.js %NODE_VER% encontrado

:: GPU NVIDIA (opcional)
nvidia-smi >nul 2>&1
if errorlevel 1 (
    echo   [AVISO] GPU NVIDIA nao detectada - modo simulacao sera usado
) else (
    echo   [OK] GPU NVIDIA detectada
)

echo.

:: ── Backend ───────────────────────────────────────────────────

echo   [2/4] Instalando Backend...

cd backend

if not exist .venv (
    python -m venv .venv
)

call .venv\Scripts\activate.bat
pip install -q --upgrade pip
pip install -q -r requirements.txt
call .venv\Scripts\deactivate.bat

if not exist .env (
    copy .env.example .env >nul
)

cd ..
echo   [OK] Backend instalado

:: ── Agent ─────────────────────────────────────────────────────

echo   [3/4] Instalando Agent...

cd agent

if not exist .venv (
    python -m venv .venv
)

call .venv\Scripts\activate.bat
pip install -q --upgrade pip
pip install -q -r requirements.txt
call .venv\Scripts\deactivate.bat

if not exist .env (
    copy .env.example .env >nul
)

cd ..
echo   [OK] Agent instalado

:: ── Frontend ──────────────────────────────────────────────────

echo   [4/4] Instalando Frontend...

cd frontend
call npm install --silent
cd ..
echo   [OK] Frontend instalado

:: ── Criar start.bat ───────────────────────────────────────────

(
echo @echo off
echo title GPU Monitor
echo color 0B
echo.
echo   Iniciando GPU Monitor...
echo.
echo   Criando pasta de logs...
echo.
if not exist logs mkdir logs

echo :: Backend
echo start "GPU Monitor - Backend" /min cmd /c "cd backend && .venv\Scripts\activate && uvicorn main:app --port 8000 --log-level warning"
echo timeout /t 3 /nobreak ^>nul
echo echo   [OK] Backend rodando em http://localhost:8000

echo :: Agent
echo start "GPU Monitor - Agent" /min cmd /c "cd agent && .venv\Scripts\activate && python agent.py >> ..\logs\agent.log 2^>^&1"
echo echo   [OK] Agent coletando metricas

echo :: Frontend
echo start "GPU Monitor - Frontend" /min cmd /c "cd frontend && npm run dev -- --port 3000 >> ..\logs\frontend.log 2^>^&1"
echo timeout /t 4 /nobreak ^>nul
echo echo   [OK] Dashboard em http://localhost:3000

echo :: Abre o browser
echo start http://localhost:3000

echo echo.
echo echo   GPU Monitor rodando!
echo echo   Acesse: http://localhost:3000
echo echo.
echo echo   Feche esta janela para ENCERRAR todos os servicos.
echo echo.
echo pause

echo :: Encerra tudo ao fechar
echo taskkill /f /fi "WINDOWTITLE eq GPU Monitor*" ^>nul 2^>^&1
) > start.bat

if not exist logs mkdir logs

echo.
echo   ==========================================
echo    Instalacao concluida!
echo   ==========================================
echo.
echo   Para iniciar o GPU Monitor:
echo   Execute: start.bat
echo.
echo   Dashboard: http://localhost:3000
echo   API Docs:  http://localhost:8000/docs
echo.
pause

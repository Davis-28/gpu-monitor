@echo off
title GPU Monitor
color 0B

  Iniciando GPU Monitor...

  Criando pasta de logs...

:: Backend
start "GPU Monitor - Backend" /min cmd /c "cd backend && .venv\Scripts\activate && uvicorn main:app --port 8000 --log-level warning"
timeout /t 3 /nobreak >nul
echo   [OK] Backend rodando em http://localhost:8000
:: Agent
start "GPU Monitor - Agent" /min cmd /c "cd agent && .venv\Scripts\activate && python agent.py >> ..\logs\agent.log 2^>^&1"
echo   [OK] Agent coletando metricas
:: Frontend
start "GPU Monitor - Frontend" /min cmd /c "cd frontend && npm run dev -- --port 3000 >> ..\logs\frontend.log 2^>^&1"
timeout /t 4 /nobreak >nul
echo   [OK] Dashboard em http://localhost:3000
:: Abre o browser
start http://localhost:3000
echo.
echo   GPU Monitor rodando!
echo   Acesse: http://localhost:3000
echo.
echo   Feche esta janela para ENCERRAR todos os servicos.
echo.
pause
:: Encerra tudo ao fechar
taskkill /f /fi "WINDOWTITLE eq GPU Monitor*" >nul 2>&1

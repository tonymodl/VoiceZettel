@echo off
chcp 65001 >nul
title VoiceZettel — Запуск всех сервисов
color 0A

echo.
echo  ╔═══════════════════════════════════════════════╗
echo  ║       VoiceZettel — Запуск всех сервисов      ║
echo  ╚═══════════════════════════════════════════════╝
echo.

set "PROJECT_DIR=C:\Users\anton\OneDrive\Документы\VoiceZettel"
set "PYTHON=C:\Users\anton\AppData\Local\Programs\Python\Python311\python.exe"
set "NODE=C:\Program Files\nodejs\node.exe"
set "UVICORN=C:\Users\anton\AppData\Local\Programs\Python\Python311\Scripts\uvicorn.exe"
set "OBSIDIAN=C:\Program Files\Obsidian\Obsidian.exe"
set "ANTIGRAVITY=C:\Users\anton\AppData\Local\Programs\Antigravity\Antigravity.exe"
set "LOG_DIR=%PROJECT_DIR%\.antigravity\logs"

:: Create log directory
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: ─────────────────────────────────────────────────────
:: 1. Obsidian (needs to be running first for REST API)
:: ─────────────────────────────────────────────────────
echo [1/6] Запуск Obsidian...
tasklist /FI "IMAGENAME eq Obsidian.exe" 2>nul | find /I "Obsidian.exe" >nul
if errorlevel 1 (
    start "" "%OBSIDIAN%"
    echo       ✓ Obsidian запущен
    :: Wait for REST API to initialize
    timeout /t 5 /nobreak >nul
) else (
    echo       • Obsidian уже запущен
)

:: ─────────────────────────────────────────────────────
:: 2. Indexer Service (ChromaDB vectorization, port 8030)
:: ─────────────────────────────────────────────────────
echo [2/6] Запуск Indexer Service (порт 8030)...
netstat -aon 2>nul | find ":8030" >nul
if errorlevel 1 (
    start /B /MIN "VZ-Indexer" cmd /c "cd /d %PROJECT_DIR%\services\indexer && "%UVICORN%" main:app --host 0.0.0.0 --port 8030 --log-level info > "%LOG_DIR%\indexer.log" 2>&1"
    echo       ✓ Indexer запущен на :8030
) else (
    echo       • Indexer уже запущен на :8030
)

:: ─────────────────────────────────────────────────────
:: 3. Telegram Service (export + sync, port 8038)
:: ─────────────────────────────────────────────────────
echo [3/6] Запуск Telegram Service (порт 8038)...
netstat -aon 2>nul | find ":8038" >nul
if errorlevel 1 (
    start /B /MIN "VZ-Telegram" cmd /c "cd /d %PROJECT_DIR%\services\telegram && "%UVICORN%" main:app --host 0.0.0.0 --port 8038 --log-level info > "%LOG_DIR%\telegram.log" 2>&1"
    echo       ✓ Telegram запущен на :8038
) else (
    echo       • Telegram уже запущен на :8038
)

:: ─────────────────────────────────────────────────────
:: 4. Next.js Frontend (port 3000)
:: ─────────────────────────────────────────────────────
echo [4/6] Запуск Next.js Frontend (порт 3000)...
netstat -aon 2>nul | find ":3000" >nul
if errorlevel 1 (
    start /B /MIN "VZ-Frontend" cmd /c "cd /d %PROJECT_DIR% && "%NODE%" node_modules\next\dist\bin\next dev --hostname 0.0.0.0 --port 3000 > "%LOG_DIR%\frontend.log" 2>&1"
    echo       ✓ Frontend запущен на :3000
) else (
    echo       • Frontend уже запущен на :3000
)

:: ─────────────────────────────────────────────────────
:: 5. Antigravity IDE
:: ─────────────────────────────────────────────────────
echo [5/6] Запуск Antigravity...
tasklist /FI "IMAGENAME eq Antigravity.exe" 2>nul | find /I "Antigravity.exe" >nul
if errorlevel 1 (
    start "" "%ANTIGRAVITY%"
    echo       ✓ Antigravity запущен
) else (
    echo       • Antigravity уже запущен
)

:: ─────────────────────────────────────────────────────
:: 6. Wait for services to be ready
:: ─────────────────────────────────────────────────────
echo [6/6] Проверка готовности сервисов...
timeout /t 3 /nobreak >nul

:: Check Frontend
"%NODE%" -e "fetch('http://localhost:3000').then(()=>console.log('       ✓ Frontend: OK')).catch(()=>console.log('       ⚠ Frontend: не готов (подождите)'))" 2>nul

:: Check Indexer
"%NODE%" -e "fetch('http://localhost:8030/health').then(()=>console.log('       ✓ Indexer: OK')).catch(()=>console.log('       ⚠ Indexer: не готов (подождите)'))" 2>nul

:: Check Telegram
"%NODE%" -e "fetch('http://localhost:8038/health').then(()=>console.log('       ✓ Telegram: OK')).catch(()=>console.log('       ⚠ Telegram: не готов (подождите)'))" 2>nul

echo.
echo  ╔═══════════════════════════════════════════════╗
echo  ║        Все сервисы VoiceZettel запущены!       ║
echo  ║                                               ║
echo  ║  Frontend:    http://localhost:3000            ║
echo  ║  Telegram:    http://localhost:8038            ║
echo  ║  Indexer:     http://localhost:8030            ║
echo  ║  Obsidian:    REST API :27123                 ║
echo  ║                                               ║
echo  ║  Логи: .antigravity\logs\                     ║
echo  ╚═══════════════════════════════════════════════╝
echo.

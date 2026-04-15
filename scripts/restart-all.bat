@echo off
chcp 65001 >nul
title VoiceZettel — Перезагрузка сервисов
color 0E

echo.
echo  ╔═══════════════════════════════════════════════╗
echo  ║    VoiceZettel — Перезагрузка всех сервисов   ║
echo  ╚═══════════════════════════════════════════════╝
echo.

set "PROJECT_DIR=C:\Users\anton\OneDrive\Документы\VoiceZettel"
set "LOG_DIR=%PROJECT_DIR%\.antigravity\logs"

:: ─────────────────────────────────────────────────────
:: Phase 1: Stop all services
:: ─────────────────────────────────────────────────────
echo  ── ОСТАНОВКА ──────────────────────────────────
echo.

:: Kill Next.js (dev server on port 3000)
echo [STOP] Frontend (порт 3000)...
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)
echo       ✓ Остановлен

:: Kill Telegram service (port 8020)
echo [STOP] Telegram Service (порт 8020)...
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":8020" ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)
echo       ✓ Остановлен

:: Kill Indexer service (port 8030)  
echo [STOP] Indexer Service (порт 8030)...
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":8030" ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)
echo       ✓ Остановлен

:: Kill orphan uvicorn processes
echo [STOP] Orphan Python processes...
taskkill /F /IM uvicorn.exe >nul 2>&1

echo.
echo  ── ПАУЗА ─────────────────────────────────────
timeout /t 3 /nobreak >nul

:: ─────────────────────────────────────────────────────
:: Phase 2: Restart all services
:: ─────────────────────────────────────────────────────
echo.
echo  ── ЗАПУСК ─────────────────────────────────────
echo.

call "%PROJECT_DIR%\scripts\start-all.bat"

echo.
echo  ╔═══════════════════════════════════════════════╗
echo  ║      Перезагрузка завершена успешно!           ║
echo  ╚═══════════════════════════════════════════════╝
echo.
echo  Нажмите любую клавишу для закрытия...
pause >nul

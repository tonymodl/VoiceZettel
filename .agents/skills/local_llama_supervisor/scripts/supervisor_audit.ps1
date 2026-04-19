# ═══════════════════════════════════════════════════════════════
# VoiceZettel Supervisor Audit — Llama 4 Scout via Ollama
# G.O.D. Protocol §4: Mandatory pre-commit gate
# ═══════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"
$OLLAMA_URL = "http://localhost:11434/api/generate"
$MODEL = "llama4:scout"

# Navigate to project root
$PROJECT_ROOT = Split-Path (Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent) -Parent
Set-Location $PROJECT_ROOT

$LOG_DIR = Join-Path $PROJECT_ROOT ".antigravity\logs"
$LOG_FILE = Join-Path $LOG_DIR "supervisor_audit.log"
if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null }

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  VoiceZettel Supervisor Audit (G.O.D. Protocol)" -ForegroundColor Cyan
Write-Host "  Model: $MODEL | Context: 131072 tokens" -ForegroundColor DarkCyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Collect git diff ──────────────────────────────────────
Write-Host "[1/4] Collecting git diff..." -ForegroundColor Yellow
$diff = git diff --cached 2>$null
if (-not $diff) { $diff = git diff 2>$null }
if (-not $diff) {
    Write-Host "  WARNING: No changes detected in git diff." -ForegroundColor DarkYellow
    $diff = "No uncommitted changes detected."
}
$diffSize = $diff.Length
# Truncate to fit in context window alongside logs and prompt
if ($diff.Length -gt 8000) {
    $diff = "...[truncated first $($diff.Length - 8000) chars]...`n" + $diff.Substring($diff.Length - 8000)
}
Write-Host "  Diff size: $diffSize chars" -ForegroundColor DarkGray

# ── 2. Collect system logs ───────────────────────────────────
Write-Host "[2/4] Reading system logs (last 150 lines)..." -ForegroundColor Yellow
$logContent = ""
$logPaths = @(
    "logs\main_py.log",
    "logs\indexer.log",
    "next_dev.log",
    "ws-proxy.log"
)
foreach ($lp in $logPaths) {
    $fullPath = Join-Path $PROJECT_ROOT $lp
    if (Test-Path $fullPath) {
        $lines = Get-Content $fullPath -Tail 40 -Encoding UTF8 -ErrorAction SilentlyContinue
        if ($lines) {
            $logContent += "`n=== $lp (last 40 lines) ===`n" + ($lines -join "`n")
            Write-Host "  Found: $lp ($($lines.Count) lines)" -ForegroundColor DarkGray
        }
    }
}
if (-not $logContent) {
    $logContent = "No log files found in project."
    Write-Host "  No log files found." -ForegroundColor DarkYellow
}

# ── 3. Build the review prompt ───────────────────────────────
Write-Host "[3/4] Building review prompt..." -ForegroundColor Yellow

$prompt = @"
ТЫ — БЕЗЖАЛОСТНЫЙ СТАРШИЙ АРХИТЕКТОР. Твоя единственная задача: найти баги, регрессии, проблемы безопасности и нарушения архитектуры.

ПРОЕКТ: VoiceZettel — голосовой Zettelkasten с AI.
СТЕК: Next.js 16, React 19, TypeScript (strict), FastAPI, ChromaDB, Telegram (Telethon), Google Gemini Multimodal Live API, Three.js.

ПРАВИЛА РЕВЬЮ:
1. Если найдена ЛЮБАЯ проблема, способная вызвать runtime error, потерю данных или регрессию → REJECT
2. Если есть нарушения типизации (any, missing types), отсутствие обработки ошибок → REJECT  
3. Если код чистый, типобезопасный и архитектурно здоровый → PASS
4. ВСЕГДА начинай ответ СТРОГО с "VERDICT: PASS" или "VERDICT: REJECT"
5. После вердикта — объясни причины в виде bullet points
6. Будь конкретен: указывай имена файлов, номера строк, имена переменных
7. Отвечай на РУССКОМ, технические термины на английском
8. НЕ ХВАЛИ КОД. Ищи ТОЛЬКО проблемы. Если проблем нет — просто PASS.

=== GIT DIFF (изменённый код) ===
$diff

=== СИСТЕМНЫЕ ЛОГИ (последние записи) ===
$logContent

ТВОЙ ВЕРДИКТ:
"@

# ── 4. Call Ollama API ───────────────────────────────────────
Write-Host "[4/4] Sending to Llama 4 Scout ($MODEL)..." -ForegroundColor Yellow
Write-Host "  Waiting for response (this may take 30-120 seconds)..." -ForegroundColor DarkGray

$body = @{
    model = $MODEL
    prompt = $prompt
    stream = $false
    options = @{
        num_ctx = 131072
        temperature = 0.3
        top_p = 0.9
    }
} | ConvertTo-Json -Depth 5 -Compress

try {
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $response = Invoke-RestMethod -Uri $OLLAMA_URL -Method Post -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType "application/json; charset=utf-8" -TimeoutSec 300
    $stopwatch.Stop()
    $verdict = $response.response
    $elapsed = $stopwatch.Elapsed.TotalSeconds

    # ── Log the audit ────────────────────────────────────────
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = @"

═══════════════════════════════════════════════════════════════
AUDIT: $timestamp
MODEL: $MODEL (num_ctx: 131072)  
DIFF_SIZE: $diffSize chars | RESPONSE_TIME: $([math]::Round($elapsed, 1))s
═══════════════════════════════════════════════════════════════
$verdict
═══════════════════════════════════════════════════════════════

"@
    Add-Content -Path $LOG_FILE -Value $logEntry -Encoding UTF8

    # ── Display result ───────────────────────────────────────
    Write-Host ""
    Write-Host "Response time: $([math]::Round($elapsed, 1)) seconds" -ForegroundColor DarkGray
    Write-Host ""

    if ($verdict -match "VERDICT:\s*PASS") {
        Write-Host "================================================================" -ForegroundColor Green
        Write-Host "  VERDICT: PASS" -ForegroundColor Green
        Write-Host "================================================================" -ForegroundColor Green
        Write-Host ""
        Write-Host $verdict
        Write-Host ""
        Write-Host "Commit APPROVED by Llama 4 Scout supervisor." -ForegroundColor Green
        Write-Host "Logged to: $LOG_FILE" -ForegroundColor DarkGray
        exit 0
    } else {
        Write-Host "================================================================" -ForegroundColor Red
        Write-Host "  VERDICT: REJECT" -ForegroundColor Red  
        Write-Host "================================================================" -ForegroundColor Red
        Write-Host ""
        Write-Host $verdict
        Write-Host ""
        Write-Host "Commit BLOCKED. Fix ALL issues above and re-run this audit." -ForegroundColor Red
        Write-Host "Logged to: $LOG_FILE" -ForegroundColor DarkGray
        exit 1
    }
} catch {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Red
    Write-Host "  ERROR: Ollama API unreachable" -ForegroundColor Red
    Write-Host "================================================================" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Checklist:" -ForegroundColor Yellow
    Write-Host "  1. Is Ollama running?  ollama serve" -ForegroundColor Yellow
    Write-Host "  2. Is model pulled?    ollama pull llama4:scout" -ForegroundColor Yellow
    Write-Host "  3. Is port 11434 open? curl http://localhost:11434" -ForegroundColor Yellow

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LOG_FILE -Value "`n[$timestamp] AUDIT FAILED: Ollama unreachable - $_`n" -Encoding UTF8
    exit 2
}

---
name: local_llama_supervisor
description: >
  Локальный супервизор качества кода на базе Llama 4 Scout (Ollama).
  Анализирует git diff + системные логи и выносит вердикт PASS/REJECT.
  Обязательный гейт перед каждым git commit согласно G.O.D. Protocol §4.
---

# Local Llama Supervisor Skill

## Когда вызывать

Этот навык **ОБЯЗАТЕЛЕН** перед каждым `git commit`. Без статуса `PASS` от супервизора коммит запрещён (G.O.D. Protocol §4).

## Как вызывать

Выполни скрипт `scripts/supervisor_audit.ps1` из корня проекта.
Скрипт автоматически:
1. Собирает `git diff --cached` (или `git diff` если ничего не staged)
2. Читает последние 150 строк системных логов
3. Отправляет всё в Llama 4 Scout через Ollama API
4. Возвращает вердикт: `PASS` или `REJECT` с объяснением

## Интерпретация результата

- **`PASS`** — код прошёл ревью. Можно коммитить.
- **`REJECT: <причины>`** — код содержит проблемы. Исправь ВСЕ указанные проблемы, затем вызови навык повторно.

## Скрипт

Создай и выполни следующий PowerShell-скрипт:

```powershell
# ═══════════════════════════════════════════════════════════════
# VoiceZettel Supervisor Audit — Llama 4 Scout via Ollama
# ═══════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"
$OLLAMA_URL = "http://localhost:11434/api/generate"
$MODEL = "llama4:scout"
$LOG_FILE = Join-Path $PSScriptRoot "..\..\..\.antigravity\logs\supervisor_audit.log"

# Ensure log directory exists
$logDir = Split-Path $LOG_FILE -Parent
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

Write-Host "═══ VoiceZettel Supervisor Audit ═══" -ForegroundColor Cyan

# 1. Collect git diff
Write-Host "[1/4] Collecting git diff..." -ForegroundColor Yellow
$diff = git diff --cached 2>$null
if (-not $diff) { $diff = git diff 2>$null }
if (-not $diff) { $diff = "No changes detected." }
# Truncate to last 8000 chars to fit context
if ($diff.Length -gt 8000) { $diff = $diff.Substring($diff.Length - 8000) }

# 2. Collect system logs
Write-Host "[2/4] Reading system logs..." -ForegroundColor Yellow
$logContent = ""
$logPaths = @(
    "logs\main_py.log",
    "logs\indexer.log",
    "next_dev.log",
    "ws-proxy.log"
)
foreach ($lp in $logPaths) {
    $fullPath = Join-Path (Get-Location) $lp
    if (Test-Path $fullPath) {
        $lines = Get-Content $fullPath -Tail 40 -ErrorAction SilentlyContinue
        if ($lines) { $logContent += "`n=== $lp ===`n" + ($lines -join "`n") }
    }
}
if (-not $logContent) { $logContent = "No log files found." }

# 3. Build prompt
Write-Host "[3/4] Sending to Llama 4 Scout for review..." -ForegroundColor Yellow
$prompt = @"
You are a RUTHLESS senior software architect performing a mandatory code review.
Your job is to find bugs, regressions, security issues, and architectural violations.
You are reviewing a commit for the VoiceZettel project (Next.js 16, React 19, TypeScript, FastAPI, ChromaDB, Telegram).

RULES:
- If you find ANY issue that could cause runtime errors, data loss, or regressions: respond with REJECT
- If you find naming violations, missing error handling, or type-safety issues: respond with REJECT
- If the code is clean, tested-looking, and architecturally sound: respond with PASS
- ALWAYS start your response with exactly "VERDICT: PASS" or "VERDICT: REJECT"
- After the verdict, explain your reasoning in bullet points
- Be specific: cite file names, line numbers, variable names
- Language: respond in Russian, technical terms in English

=== GIT DIFF ===
$diff

=== SYSTEM LOGS (last 150 lines) ===
$logContent
"@

# 4. Call Ollama API
$body = @{
    model = $MODEL
    prompt = $prompt
    stream = $false
    options = @{
        num_ctx = 131072
        temperature = 0.3
        top_p = 0.9
    }
} | ConvertTo-Json -Depth 5

try {
    $response = Invoke-RestMethod -Uri $OLLAMA_URL -Method Post -Body $body -ContentType "application/json" -TimeoutSec 300
    $verdict = $response.response

    # Log the audit
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = @"

═══════════════════════════════════════════════════════════════
AUDIT: $timestamp
MODEL: $MODEL (num_ctx: 131072)
DIFF_SIZE: $($diff.Length) chars
═══════════════════════════════════════════════════════════════
$verdict
═══════════════════════════════════════════════════════════════

"@
    Add-Content -Path $LOG_FILE -Value $logEntry -Encoding UTF8

    # Display result
    Write-Host ""
    if ($verdict -match "VERDICT:\s*PASS") {
        Write-Host "═══ VERDICT: PASS ═══" -ForegroundColor Green
        Write-Host $verdict
        Write-Host ""
        Write-Host "Commit is APPROVED by Llama 4 Scout supervisor." -ForegroundColor Green
        exit 0
    } else {
        Write-Host "═══ VERDICT: REJECT ═══" -ForegroundColor Red
        Write-Host $verdict
        Write-Host ""
        Write-Host "Commit is BLOCKED. Fix all issues and re-run audit." -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "ERROR: Failed to reach Ollama API at $OLLAMA_URL" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Make sure Ollama is running: ollama serve" -ForegroundColor Yellow
    Write-Host "Make sure llama4:scout is pulled: ollama pull llama4:scout" -ForegroundColor Yellow

    # Log the failure
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LOG_FILE -Value "`n[$timestamp] AUDIT FAILED: Ollama unreachable - $_`n" -Encoding UTF8
    exit 2
}
```

## Альтернативный вызов через curl (для bash/WSL)

```bash
#!/bin/bash
DIFF=$(git diff --cached 2>/dev/null || git diff 2>/dev/null)
LOGS=$(tail -n 150 logs/*.log ws-proxy.log next_dev.log 2>/dev/null)

PROMPT="You are a RUTHLESS senior software architect. Review this commit for VoiceZettel.
Start with VERDICT: PASS or VERDICT: REJECT. Explain in Russian.

=== GIT DIFF ===
${DIFF:0:8000}

=== LOGS ===
${LOGS:0:4000}"

curl -s http://localhost:11434/api/generate \
  -d "{\"model\":\"llama4:scout\",\"prompt\":$(echo "$PROMPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"stream\":false,\"options\":{\"num_ctx\":131072,\"temperature\":0.3}}" \
  | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('response','ERROR'))"
```

## Файловая структура

```
.agents/skills/local_llama_supervisor/
├── SKILL.md              ← Этот файл (инструкции)
└── scripts/
    └── supervisor_audit.ps1  ← Исполняемый скрипт
```

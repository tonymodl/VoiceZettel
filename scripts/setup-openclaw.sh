#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# setup-openclaw.sh — Install Ollama + Configure OpenClaw agent
# VoiceZettel 3.0 Phase 2: LLM-Wiki Core
# ─────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OPENCLAW_DIR="$PROJECT_ROOT/.openclaw"

echo "═══════════════════════════════════════════════"
echo "  🧠 VoiceZettel 3.0 — OpenClaw Setup"
echo "═══════════════════════════════════════════════"

# ── Step 1: Install Ollama ────────────────────────────────
echo ""
echo "📦 Step 1: Checking Ollama..."
if command -v ollama &> /dev/null; then
    echo "  ✅ Ollama already installed: $(ollama --version)"
else
    echo "  ⬇ Installing Ollama..."
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
        echo "  ⚠ Windows detected. Please install Ollama from: https://ollama.com/download"
        echo "    After installation, run this script again."
        exit 1
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        brew install ollama
    else
        curl -fsSL https://ollama.com/install.sh | sh
    fi
    echo "  ✅ Ollama installed"
fi

# ── Step 2: Pull model for OpenClaw ──────────────────────
echo ""
echo "📦 Step 2: Pulling qwen2.5:14b model for OpenClaw agent..."
ollama pull qwen2.5:14b 2>/dev/null || echo "  ⚠ Model pull skipped (run manually: ollama pull qwen2.5:14b)"

# ── Step 3: Create OpenClaw config ───────────────────────
echo ""
echo "⚙ Step 3: Writing OpenClaw configuration..."

mkdir -p "$OPENCLAW_DIR"

cat > "$OPENCLAW_DIR/openclaw.json" << 'CONFIGEOF'
{
  "agent": {
    "name": "OpenClaw-VoiceZettel",
    "version": "3.0.0",
    "model": "qwen2.5:14b",
    "provider": "ollama",
    "ollama_url": "http://localhost:11434",
    "temperature": 0.3,
    "max_tokens": 8192
  },
  "tools": {
    "profile": "full"
  },
  "sandbox": {
    "enabled": true,
    "allowed_read": [
      "VoiceZettel/Raw_v2/",
      "VoiceZettel/Wiki_v2/",
      ".openclaw/SCHEMA.md"
    ],
    "allowed_write": [
      "VoiceZettel/Wiki_v2/"
    ],
    "denied": [
      "src/",
      "services/",
      "node_modules/",
      ".env",
      ".git/",
      "VoiceZettel/Raw_v2/"
    ]
  },
  "schedule": {
    "ingest_interval_minutes": 15,
    "max_files_per_run": 50,
    "quiet_hours": {
      "start": "02:00",
      "end": "06:00"
    }
  },
  "logging": {
    "level": "INFO",
    "file": ".antigravity/logs/openclaw.log",
    "max_size_mb": 50,
    "rotate_count": 5
  }
}
CONFIGEOF

echo "  ✅ Config written to $OPENCLAW_DIR/openclaw.json"

# ── Step 4: Create Shadow directories ────────────────────
echo ""
echo "📁 Step 4: Ensuring Shadow Mode directories..."
mkdir -p "$PROJECT_ROOT/VoiceZettel/Raw_v2"
mkdir -p "$PROJECT_ROOT/VoiceZettel/Wiki_v2"
echo "  ✅ Raw_v2/ and Wiki_v2/ ready"

# ── Step 5: Create SCHEMA.md ─────────────────────────────
echo ""
echo "📝 Step 5: Writing Wiki Schema..."
cat > "$OPENCLAW_DIR/SCHEMA.md" << 'SCHEMAEOF'
# LLM-Wiki Schema v1.0

## Entity Types

### Person
- **File pattern**: `Wiki_v2/People/{Name}.md`
- **Required fields**: name, first_seen, last_seen, relationship_type
- **Optional**: phone, email, telegram_handle, birthday, notes

### Project  
- **File pattern**: `Wiki_v2/Projects/{Name}.md`
- **Required fields**: name, status, owner, created_date
- **Optional**: deadline, priority, team, milestones

### Task
- **File pattern**: `Wiki_v2/Tasks/{YYYY-MM-DD}-{Title}.md`
- **Required fields**: title, status, assignee, created_date
- **Statuses**: draft, active, delegated, completed, cancelled

### InteractionEvent
- **File pattern**: Embedded in Person files under `## Interactions`
- **Required fields**: date, channel, summary, sentiment

## Taxonomy Rules
1. One entity per file (except InteractionEvents)
2. Use YAML frontmatter for structured data
3. Body in Markdown for unstructured notes
4. Cross-references via `[[wiki links]]`
5. Never modify files in /Raw_v2 (immutable source)
6. Merge duplicates: prefer most recently seen data

## Sentiment Scale
- -2: very negative
- -1: negative  
- 0: neutral
- 1: positive
- 2: very positive
SCHEMAEOF

echo "  ✅ Schema written"
echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ OpenClaw setup complete!"
echo "  Run: ollama serve (if not already running)"
echo "  Agent will read from: VoiceZettel/Raw_v2/"
echo "  Agent will write to:  VoiceZettel/Wiki_v2/"
echo "═══════════════════════════════════════════════"

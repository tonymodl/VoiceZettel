# HEARTBEAT.md — Background Agent Logic (VoiceZettel 3.0)

## Core Background Schedule
- **Obsidian Watchdog**: Every 2 seconds — file change detection + re-index trigger
- **Telegram MTProto**: 24/7 online listener with Self-Heal (heartbeat every 120s)
- **Lapel Mode**: 24/7 background diarization (on-demand start/stop)
- **OpenClaw Daemon**: Continuous LLM-Wiki compilation from /Raw_v2/ → /Wiki_v2/
- **Shelestun Scan**: Every 5 minutes — entity extraction, promise tracking, Health Score recalc

## Data Pipeline Schedule
| Interval | Task | Description |
|----------|------|-------------|
| 2s | Watchdog | Detect Obsidian vault changes |
| 120s | Heartbeat | Telegram `get_me()` keepalive |
| 5min | Shelestun | NLP entity extraction + coreference resolution |
| 15min | Graph Sync | LightRAG index update from new Wiki_v2 pages |
| 1h | Health Score | Recalculate Dunbar circle scores + decay |
| 6h | Identity Merge | Run probabilistic identity resolution scan |
| 24h (3AM) | DB Vacuum | SQLite + ChromaDB maintenance |
| 24h (6AM) | Wiki Compile | Full LLM-Wiki recompilation pass |

## Maintenance
- **Graph Index Rebuild**: Triggered after every 10 new Wiki pages
- **Vector Re-Index**: Triggered after every 5 new notes (ChromaDB, legacy)
- **Database Vacuum**: Daily at 3:00 AM (sqlite_v2.db + legacy)
- **Offline Sync**: Automatic on re-connection (IndexedDB → server)
- **Voice Cache**: Prune fingerprint vectors older than 365 days without match

## Health Checks
- Monitor GPU memory (RTX 4090) — alert at >80% VRAM
- Monitor ChromaDB latency — alert at >500ms p95
- Monitor LightRAG graph size — alert at >100K nodes
- Monitor Telegram connection state — auto-reconnect on drop
- Monitor WebSocket proxy (:3099) — log anomalies
- All anomalies logged to `.antigravity/logs/decisions.log`

## Self-Healing Priorities
1. **Telegram**: heartbeat → reconnect → webhook migration
2. **Gemini Live**: WS auto-reconnect (any close code, 12 attempts, 300ms base)
3. **ChromaDB**: dimension validation → auto-reindex on mismatch
4. **OpenClaw**: process supervision → auto-restart on crash

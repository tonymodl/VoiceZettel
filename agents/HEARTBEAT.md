# HEARTBEAT.md — Background Agent Logic

## Schedule
- **Obsidian Sync**: Every 2 seconds (Watchdog).
- **Telegram MTProto**: 24/7 online listener.
- **Lapel Mode**: 24/7 background diarization (on-demand start/stop).
- **Shelestun Scan**: Every 5 minutes (aggregate new entities, check promises).

## Maintenance
- **Vector Indexing**: Triggered after every 5 new notes.
- **Database Vacuum**: Daily at 3:00 AM.
- **Offline Sync**: Automatic on re-connection.

## Health Check
- Monitor GPU memory (RTX 4090).
- Monitor ChromaDB latency.
- Log anomalies to `.antigravity/logs/decisions.log`.

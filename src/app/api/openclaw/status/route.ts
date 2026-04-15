import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * GET /api/openclaw/status — Returns OpenClaw agent status.
 * POST /api/openclaw/trigger — Triggers a manual ingest cycle.
 * 
 * Read-only endpoint for Phase 2 monitoring.
 */

const WIKI_DIR = path.join(process.cwd(), "VoiceZettel", "Wiki_v2");
const RAW_DIR = path.join(process.cwd(), "VoiceZettel", "Raw_v2");
const CONFIG_PATH = path.join(process.cwd(), ".openclaw", "openclaw.json");
const INDEX_PATH = path.join(WIKI_DIR, ".processed_index.json");

function countFiles(dir: string, ext = ".md"): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(d, entry.name));
      else if (entry.name.endsWith(ext)) count++;
    }
  };
  walk(dir);
  return count;
}

export async function GET() {
  try {
    const configExists = fs.existsSync(CONFIG_PATH);
    const rawFiles = countFiles(RAW_DIR);
    const wikiFiles = countFiles(WIKI_DIR);

    let processedCount = 0;
    if (fs.existsSync(INDEX_PATH)) {
      try {
        const data = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
        processedCount = data.files?.length || 0;
      } catch { /* ignore */ }
    }

    // Count entities by type
    const peopleDir = path.join(WIKI_DIR, "People");
    const tasksDir = path.join(WIKI_DIR, "Tasks");
    const peopleCount = fs.existsSync(peopleDir)
      ? fs.readdirSync(peopleDir).filter((f) => f.endsWith(".md")).length
      : 0;
    const tasksCount = fs.existsSync(tasksDir)
      ? fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md")).length
      : 0;

    return NextResponse.json({
      status: "ok",
      configured: configExists,
      raw_files: rawFiles,
      wiki_pages: wikiFiles,
      processed_files: processedCount,
      pending_files: Math.max(0, rawFiles - processedCount),
      entities: {
        people: peopleCount,
        tasks: tasksCount,
      },
      directories: {
        raw_v2: fs.existsSync(RAW_DIR),
        wiki_v2: fs.existsSync(WIKI_DIR),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: String(error) },
      { status: 500 }
    );
  }
}

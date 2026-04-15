import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

/**
 * GET /api/crm/people — List all people with health scores.
 * GET /api/crm/actions — List pending draft actions.
 * POST /api/crm/actions/:id/resolve — Approve or dismiss an action.
 * 
 * Reads from isolated sqlite_v2.db — does NOT touch main DB.
 */

const DB_PATH = path.join(process.cwd(), "data", "sqlite_v2.db");

function getDb() {
  if (!fs.existsSync(DB_PATH)) {
    return null;
  }
  const db = new (require("better-sqlite3") as typeof Database)(DB_PATH, {
    readonly: true,
  });
  return db;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") || "people";

  // If DB doesn't exist yet, return empty results
  if (!fs.existsSync(DB_PATH)) {
    return NextResponse.json({
      status: "ok",
      initialized: false,
      message: "CRM database not yet initialized. Run OpenClaw agent first.",
      data: [],
    });
  }

  try {
    const db = new (require("better-sqlite3") as typeof Database)(DB_PATH, {
      readonly: true,
    });

    if (view === "people") {
      const people = db
        .prepare(
          `SELECT p.*, 
                  COUNT(ie.id) as interaction_count,
                  COALESCE(AVG(ie.sentiment), 0) as avg_sentiment,
                  MAX(ie.event_date) as last_interaction
           FROM Entity_Person p
           LEFT JOIN InteractionEvent ie ON p.id = ie.person_id
           GROUP BY p.id
           ORDER BY p.health_score ASC`
        )
        .all();

      db.close();
      return NextResponse.json({
        status: "ok",
        initialized: true,
        count: people.length,
        data: people,
      });
    }

    if (view === "actions") {
      const actions = db
        .prepare(
          `SELECT da.*, ep.name as person_name
           FROM DraftAction da
           LEFT JOIN Entity_Person ep ON da.person_id = ep.id
           WHERE da.status = 'pending'
           ORDER BY 
             CASE da.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                              WHEN 'medium' THEN 2 ELSE 3 END,
             da.created_at DESC`
        )
        .all();

      db.close();
      return NextResponse.json({
        status: "ok",
        initialized: true,
        count: actions.length,
        data: actions,
      });
    }

    if (view === "stats") {
      const personCount = db.prepare("SELECT COUNT(*) as c FROM Entity_Person").get() as { c: number };
      const taskCount = db.prepare("SELECT COUNT(*) as c FROM Entity_Task").get() as { c: number };
      const eventCount = db.prepare("SELECT COUNT(*) as c FROM InteractionEvent").get() as { c: number };
      const pendingCount = db.prepare("SELECT COUNT(*) as c FROM DraftAction WHERE status = 'pending'").get() as { c: number };

      db.close();
      return NextResponse.json({
        status: "ok",
        initialized: true,
        stats: {
          people: personCount.c,
          tasks: taskCount.c,
          interactions: eventCount.c,
          pending_actions: pendingCount.c,
        },
      });
    }

    if (view === "entities") {
      const people = db
        .prepare(
          `SELECT p.id, p.name, p.aliases, p.relationship, p.health_score, p.dunbar_layer,
                  COUNT(ie.id) as interactions,
                  MAX(ie.event_date) as last_seen
           FROM Entity_Person p
           LEFT JOIN InteractionEvent ie ON p.id = ie.person_id
           GROUP BY p.id
           ORDER BY interactions DESC
           LIMIT 100`
        )
        .all();

      const tasks = db
        .prepare(
          `SELECT t.id, t.title, t.status, t.assignee, t.deadline, t.created_at, t.source
           FROM Entity_Task t
           ORDER BY t.created_at DESC
           LIMIT 100`
        )
        .all();

      db.close();
      return NextResponse.json({
        status: "ok",
        initialized: true,
        entities: {
          people,
          tasks,
          totalPeople: people.length,
          totalTasks: tasks.length,
        },
      });
    }

    if (view === "timeline") {
      const events = db
        .prepare(
          `SELECT ie.id, ie.event_type, ie.event_date, ie.sentiment, ie.content,
                  ie.source_file, ep.name as person_name
           FROM InteractionEvent ie
           LEFT JOIN Entity_Person ep ON ie.person_id = ep.id
           ORDER BY ie.event_date DESC
           LIMIT 50`
        )
        .all();

      db.close();
      return NextResponse.json({
        status: "ok",
        initialized: true,
        timeline: events,
        count: events.length,
      });
    }

    db.close();
    return NextResponse.json({ status: "error", message: "Unknown view" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: String(error) },
      { status: 500 }
    );
  }
}

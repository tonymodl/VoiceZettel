import sqlite3, json, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect(r'c:\Users\anton\OneDrive\Документы\VoiceZettel\data\voicezettel.db')
conn.text_factory = str
c = conn.cursor()

c.execute("SELECT name FROM sqlite_master WHERE type='table'")
print("Tables:", [r[0] for r in c.fetchall()])

c.execute("SELECT count(*) FROM memories")
print("Total memories:", c.fetchone()[0])

print("\n=== COMPILED RULES ===")
c.execute("SELECT id, text, tags, created_at FROM memories WHERE tags LIKE '%compiled_rules%' ORDER BY created_at DESC LIMIT 3")
for r in c.fetchall():
    print(f"\n--- [{r[3]}] ---")
    print(r[1][:2000])

print("\n=== REQUIREMENTS / CORRECTIONS / REMARKS ===")
c.execute("SELECT text, tags, created_at FROM memories WHERE tags LIKE '%requirement%' OR tags LIKE '%correction%' OR tags LIKE '%remark%' OR tags LIKE '%preference%' ORDER BY created_at DESC LIMIT 20")
for r in c.fetchall():
    print(f"[{r[2]}] {r[1][:200]}")

print("\n=== EMPATHY PROFILE ===")
try:
    c.execute("SELECT profile_json FROM empathy_profile WHERE user_id = 'anonymous'")
    row = c.fetchone()
    if row:
        profile = json.loads(row[0])
        print(json.dumps(profile, indent=2, ensure_ascii=False)[:3000])
    else:
        print("No empathy profile found")
except Exception as e:
    print(f"Empathy table error: {e}")

conn.close()

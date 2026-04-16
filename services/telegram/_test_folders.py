import requests
r = requests.get('http://127.0.0.1:3000/api/obsidian/folders', timeout=5)
d = r.json()
print(f"Status: {r.status_code}")
print(f"Source: {d.get('source')}")
folders = d.get('folders', [])
print(f"Folders: {len(folders)}")
for f in folders:
    print(f"  {f['id']}: {f['name']} ({f['noteCount']} notes)")

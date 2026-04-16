import requests, json

# Test 1: Send by chat_id (should work since we know it)
print("=== Test 1: by chat_id 884115476 ===")
r = requests.post('http://127.0.0.1:8038/send', json={
    'chat_id': 884115476,
    'text': 'Тест VoiceZettel по ID'
})
print(f'{r.status_code}: {json.dumps(r.json(), ensure_ascii=False, indent=2)}')

# Test 2: Debug what /send sees
print("\n=== Test 2: by name 'Настя' ===")
r2 = requests.post('http://127.0.0.1:8038/send', json={
    'chat_name': 'Настя',
    'text': 'Тест по имени'
})
print(f'{r2.status_code}: {json.dumps(r2.json(), ensure_ascii=False, indent=2)}')

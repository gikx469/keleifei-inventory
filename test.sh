#!/bin/bash
BASE="http://localhost:3789"
PYTHON="C:/Users/86182/.workbuddy/binaries/python/versions/3.13.12/python.exe"

# 用 Python 解析 JSON 避免编码问题
py() { "$PYTHON" -X utf8 -c "import sys, json; d = json.loads(sys.stdin.read()); print(d$1)"; }
pyarr() { "$PYTHON" -X utf8 -c "import sys, json; d = json.loads(sys.stdin.read()); print(d.get('$1', ''))"; }

echo "=== 1. Setup admin ==="
SETUP=$(curl -s -X POST "$BASE/api/setup" -H "Content-Type: application/json" -d '{"name":"小雪老师","pass":"1234"}')
TOKEN=$(echo "$SETUP" | py '["token"]')
echo "TOKEN=$TOKEN"
echo "$SETUP" | py '["state"]["me"]'

echo ""
echo "=== 2. Wrong password ==="
curl -s -X POST "$BASE/api/login" -H "Content-Type: application/json" -d '{"name":"小雪老师","pass":"wrong"}'
echo ""

echo ""
echo "=== 3. Login + get fresh token ==="
LOGIN=$(curl -s -X POST "$BASE/api/login" -H "Content-Type: application/json" -d '{"name":"小雪老师","pass":"1234"}')
TOKEN=$(echo "$LOGIN" | py '["token"]')
echo "TOKEN=$TOKEN"

echo ""
echo "=== 4. Add item (双面胶) ==="
curl -s -X POST "$BASE/api/items" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"action":"add","name":"双面胶","spec":"宽4cm","category":"胶类","unit":"卷","initQty":50,"minQty":10}'
echo ""

echo ""
echo "=== 5. Get item id ==="
ITEM_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/state" | "$PYTHON" -X utf8 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d['state']['items'][0]['id'])")
echo "ITEM_ID=$ITEM_ID"

echo ""
echo "=== 6. Inbound +20 ==="
curl -s -X POST "$BASE/api/inbound" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{\"itemId\":\"$ITEM_ID\",\"qty\":20,\"remark\":\"淘宝购入\"}"
echo ""

echo ""
echo "=== 7. Self-register 王老师 ==="
REG=$(curl -s -X POST "$BASE/api/register" -H "Content-Type: application/json" -d '{"name":"王老师","pass":"5678"}')
NORM_TOKEN=$(echo "$REG" | py '["token"]')
echo "NORM_TOKEN=$NORM_TOKEN"

echo ""
echo "=== 8. Normal user inbound (expect 403) ==="
curl -s -X POST "$BASE/api/inbound" -H "Content-Type: application/json" -H "Authorization: Bearer $NORM_TOKEN" -d "{\"itemId\":\"$ITEM_ID\",\"qty\":5}"
echo ""

echo ""
echo "=== 9. Normal user submits out request (qty 3) ==="
REQ=$(curl -s -X POST "$BASE/api/req" -H "Content-Type: application/json" -H "Authorization: Bearer $NORM_TOKEN" -d "{\"type\":\"out\",\"itemId\":\"$ITEM_ID\",\"qty\":3,\"reason\":\"小班上课\"}")
echo "$REQ"
REQ_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/state" | "$PYTHON" -X utf8 -c "import sys,json; d=json.loads(sys.stdin.read()); rs=[r for r in d['state']['requests'] if r['type']=='out']; print(rs[0]['id'] if rs else '')")
echo "REQ_ID=$REQ_ID"

echo ""
echo "=== 10. Admin approves ==="
curl -s -X POST "$BASE/api/approve" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{\"id\":\"$REQ_ID\",\"action\":\"approve\"}"
echo ""

echo ""
echo "=== 11. Verify qty = 50+20-3 = 67 ==="
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/state" | "$PYTHON" -X utf8 -c "import sys,json; d=json.loads(sys.stdin.read()); it=d['state']['items'][0]; print(f'{it[\"name\"]} qty={it[\"qty\"]} {it[\"unit\"]}')"

echo ""
echo "=== 12. Buy request ==="
curl -s -X POST "$BASE/api/buy" -H "Content-Type: application/json" -H "Authorization: Bearer $NORM_TOKEN" -d '{"itemName":"彩色卡纸","spec":"A4","unit":"包","qty":10,"reason":"不够用了"}'
echo ""

echo ""
echo "=== 13. Admin promotes 王老师 ==="
USERS=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/state")
USER_ID=$(echo "$USERS" | "$PYTHON" -X utf8 -c "import sys,json; d=json.loads(sys.stdin.read()); us=[u for u in d['state']['users'] if u['name']=='王老师']; print(us[0]['id'] if us else '')")
echo "USER_ID=$USER_ID"
curl -s -X POST "$BASE/api/users" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{\"action\":\"role\",\"userId\":\"$USER_ID\",\"role\":\"authorized\"}"
echo ""

echo ""
echo "=== 14. Backup (head) ==="
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/backup" | head -c 400
echo ""

echo ""
echo "=== 15. Diag ==="
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/diag" | "$PYTHON" -X utf8 -c "import sys,json; d=json.loads(sys.stdin.read()); print(json.dumps(d, ensure_ascii=False, indent=2))"

echo ""
echo "=== 16. Change password ==="
curl -s -X POST "$BASE/api/changepass" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"oldPass":"1234","newPass":"abcd"}'
echo ""

echo ""
echo "=== 17. Login with new password ==="
curl -s -X POST "$BASE/api/login" -H "Content-Type: application/json" -d '{"name":"小雪老师","pass":"abcd"}' | head -c 200
echo ""

echo ""
echo "=== 18. Token without auth (expect 401) ==="
curl -s "$BASE/api/state"
echo ""

echo ""
echo "=== 19. Logout ==="
curl -s -X POST "$BASE/api/logout" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN"
echo ""

echo ""
echo "=== ALL TESTS DONE ==="
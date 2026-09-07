#!/bin/bash
echo '{"name":"小雪老师","pass":"1234"}' > /c/Users/86182/AppData/Local/Temp/test_input.json
echo "File hex:"
od -c /c/Users/86182/AppData/Local/Temp/test_input.json | head -2
echo "---"
echo "File exists:"
ls -la /c/Users/86182/AppData/Local/Temp/test_input.json
echo "---"
# Try alternative curl syntax
URL='http://localhost:3789/api/setup'
echo "Sending..."
curl -s -X POST "$URL" -H "Content-Type: application/json; charset=utf-8" --data-binary "@/c/Users/86182/AppData/Local/Temp/test_input.json"
echo ""
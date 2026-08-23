#!/bin/bash
# เปิดเว็บบนเครื่องตัวเอง — ดับเบิลคลิกไฟล์นี้ หรือรัน  ./start.sh
cd "$(dirname "$0")"
PORT=8080
echo "เปิดที่  http://localhost:$PORT/index.html   (กด Ctrl+C เพื่อหยุด)"
( sleep 1; open "http://localhost:$PORT/index.html" ) &
python3 -m http.server $PORT

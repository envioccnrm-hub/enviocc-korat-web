#!/bin/bash
# ขยับเลขรุ่นของไฟล์หน้าเว็บ ให้ผู้ใช้กดรีเฟรชธรรมดาแล้วได้โค้ดใหม่ทันที
#
#   ./bump.sh          → ขยับให้อัตโนมัติ (วันนี้ + ตัวอักษรถัดไป)
#   ./bump.sh 2026-09-01a  → กำหนดเลขรุ่นเอง
#
# รันทุกครั้ง "หลังแก้ไฟล์ใน assets/ และก่อน commit"

set -e
cd "$(dirname "$0")"

FILES=(assets/config.js index.html hospital.html admin.html test.html)

OLD=$(sed -n "s/.*WEB_VERSION: '\([^']*\)'.*/\1/p" assets/config.js)
if [ -z "$OLD" ]; then
  echo "❌ หา WEB_VERSION ใน assets/config.js ไม่เจอ" >&2
  exit 1
fi

NEW="$1"
if [ -z "$NEW" ]; then
  TODAY=$(date +%Y-%m-%d)
  if [ "${OLD:0:10}" = "$TODAY" ]; then
    # วันเดียวกัน → เลื่อนตัวอักษรท้ายไปอีกหนึ่ง
    LETTER="${OLD:10}"
    if [ "$LETTER" = "z" ]; then
      echo "❌ ถึงตัว z แล้ว วันนี้แก้ 26 รอบ ใส่เลขรุ่นเองเถอะ: ./bump.sh $TODAY-2" >&2
      exit 1
    fi
    NEW="$TODAY$(echo "$LETTER" | tr 'a-y' 'b-z')"
  else
    # คนละวัน → เริ่มนับ a ใหม่
    NEW="${TODAY}a"
  fi
fi

if [ "$NEW" = "$OLD" ]; then
  echo "⚠️  เลขรุ่นเท่าเดิม ($OLD) ไม่มีอะไรเปลี่ยน" >&2
  exit 1
fi

for f in "${FILES[@]}"; do
  sed -i '' "s/$OLD/$NEW/g" "$f"
done

echo "✅ ขยับเลขรุ่น: $OLD → $NEW"
echo "   แก้แล้ว ${#FILES[@]} ไฟล์ — ตรวจด้วย git diff แล้ว commit + push ได้เลย"

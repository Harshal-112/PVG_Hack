#!/usr/bin/env bash
# Seed script for events. Owned by [P4].
# Creates/resets event evt1 with 200 seats via POST /api/v1/admin/events.

set -e

BASE_URL="${BASE_URL:-http://localhost:8000}"
EVENT_ID="${EVENT_ID:-evt1}"
SEAT_COUNT="${SEAT_COUNT:-200}"

echo "=================================================="
echo "  FlashSeat Event Seed Script"
echo "=================================================="
echo " Target URL  : ${BASE_URL}"
echo " Event ID    : ${EVENT_ID}"
echo " Seat Count  : ${SEAT_COUNT}"
echo "--------------------------------------------------"

if command -v curl >/dev/null 2>&1; then
  RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "${BASE_URL}/api/v1/admin/events" \
    -H "Content-Type: application/json" \
    -d "{\"event_id\": \"${EVENT_ID}\", \"seat_count\": ${SEAT_COUNT}}")
  
  BODY=$(echo "$RESPONSE" | sed -e 's/HTTP_STATUS:.*//g')
  STATUS=$(echo "$RESPONSE" | tr -d '\n' | sed -e 's/.*HTTP_STATUS://g')
  
  echo "Response Status: $STATUS"
  echo "Response Body  : $BODY"
  
  if [ "$STATUS" -eq 200 ] || [ "$STATUS" -eq 201 ]; then
    echo "SUCCESS: Seeded event '${EVENT_ID}' with ${SEAT_COUNT} seats."
  else
    echo "ERROR: Failed to seed event '${EVENT_ID}' (HTTP ${STATUS})."
    exit 1
  fi
else
  echo "curl not found, using python fallback..."
  python -c "
import httpx
res = httpx.post('${BASE_URL}/api/v1/admin/events', json={'event_id': '${EVENT_ID}', 'seat_count': ${SEAT_COUNT}})
print(f'Status: {res.status_code}, Body: {res.text}')
assert res.status_code in (200, 201)
"
  echo "SUCCESS: Seeded event '${EVENT_ID}' with ${SEAT_COUNT} seats."
fi

#!/usr/bin/env bash
# Smoke test temporal del BFF en dev. Arranca Vite, prueba /api/auth/*, y apaga.
set -u
PORT="${1:-5185}"
LOG="$(mktemp)"

node_modules/.bin/vite --port "$PORT" --strictPort >"$LOG" 2>&1 &
VPID=$!
trap 'kill -9 "$VPID" 2>/dev/null' EXIT

echo "vite pid=$VPID port=$PORT log=$LOG"
ready=0
for i in $(seq 1 60); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then ready=1; echo "ready en intento $i"; break; fi
  sleep 0.5
done
if [ "$ready" != "1" ]; then echo "NO ARRANCO"; tail -n 30 "$LOG"; exit 1; fi

echo "=== 1) GET /api/auth/session (sin cookie) -> espera 401 ==="
curl -s -i "http://127.0.0.1:$PORT/api/auth/session" -H "X-GC-Auth: 1" | head -12

echo
echo "=== 2) POST /api/auth/login credenciales malas -> espera 401 ==="
curl -s -i -X POST "http://127.0.0.1:$PORT/api/auth/login" \
  -H "Content-Type: application/json" -H "X-GC-Auth: 1" \
  -d '{"email":"nope@test.com","password":"wrong"}' | head -12

echo
echo "=== 3) POST /api/auth/refresh sin cookie -> espera 401 ==="
curl -s -i -X POST "http://127.0.0.1:$PORT/api/auth/refresh" -H "X-GC-Auth: 1" | head -8

echo
echo "=== 4) GET /api/auth/login (metodo equivocado) -> espera 405 ==="
curl -s -i "http://127.0.0.1:$PORT/api/auth/login" -H "X-GC-Auth: 1" | head -6

echo
echo "=== vite log (ultimas lineas) ==="
tail -n 8 "$LOG"
echo "DONE"

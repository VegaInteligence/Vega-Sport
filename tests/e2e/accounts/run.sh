#!/bin/bash
# VI-38 accounts E2E: builds and starts the site three times (on, nosync, off) and runs accounts.e2e.mjs against
# each; the phase « verify » (the e-mail codes) runs on the build of « on ». PHASES="on verify" runs only those.
# Local only: the stand-ins of Neon Auth and of the account API listen on 127.0.0.1:4100 and :4200, the recorded
# football data on :8765, the site on :3100.
#
#   VEGA_FX=<folder with the replay's server.mjs> tests/e2e/accounts/run.sh <evidence dir> [captures dir]
#
# Needs: the local PostgreSQL 16 (pg_ctlcluster 16 main start) with the superuser vega_test, `bun install` in
# dashboard/, `npm ci` in backend/account, Playwright with Chromium. Leaves .next built by the last phase run (accounts off when all run).
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
OUT=${1:?usage: run.sh <evidence dir> [captures dir]}
CAPTURES=${2:-}
FX=${VEGA_FX:?VEGA_FX: the folder of the recorded data replay (server.mjs)}
mkdir -p "$OUT"
LOGS="$OUT/logs"
mkdir -p "$LOGS"
SECRET=e2e-cookie-secret-0123456789abcdef0123

pg_ctlcluster 16 main start 2>/dev/null || true
free_port() { fuser -k "$1/tcp" >/dev/null 2>&1 || true; }
free_port 8765
(FX_PORT=8765 node "$FX/server.mjs" > "$LOGS/data-replay.log" 2>&1 &)

PHASES=${PHASES:-on verify nosync off}
BUILT=
phase() {
  local name=$1 build=$2
  shift 2
  case " $PHASES " in *" $name "*) ;; *) return 0 ;; esac
  free_port 3100
  if [ "$BUILT" != "$build" ]; then
    echo "== $name: build"
    (cd "$ROOT/dashboard/frontend" && env -u NEON_AUTH_BASE_URL -u NEON_AUTH_COOKIE_SECRET -u ACCOUNT_API_ORIGIN \
      NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:8765 "$@" npm run build > "$LOGS/build-$name.log" 2>&1) || { echo "build $name failed"; return 1; }
    BUILT=$build
  fi
  (cd "$ROOT/dashboard" && env -u NEON_AUTH_BASE_URL -u NEON_AUTH_COOKIE_SECRET -u ACCOUNT_API_ORIGIN \
    NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:8765 "$@" nohup node node_modules/next/dist/bin/next start frontend --hostname 127.0.0.1 --port 3100 > "$LOGS/site-$name.log" 2>&1 &)
  for _ in $(seq 60); do curl -s -o /dev/null http://127.0.0.1:3100/ && break; sleep 1; done
  echo "== $name: run"
  (cd "$ROOT" && node tests/e2e/accounts/accounts.e2e.mjs "$OUT" "$name" $CAPTURES 2>&1 | tee "$LOGS/e2e-$name.log")
  local code=${PIPESTATUS[0]}
  free_port 3100
  return "$code"
}

status=0
phase on on NEON_AUTH_BASE_URL=http://127.0.0.1:4100/neondb/auth NEON_AUTH_COOKIE_SECRET=$SECRET ACCOUNT_API_ORIGIN=http://127.0.0.1:4200 || status=1
phase verify on NEON_AUTH_BASE_URL=http://127.0.0.1:4100/neondb/auth NEON_AUTH_COOKIE_SECRET=$SECRET ACCOUNT_API_ORIGIN=http://127.0.0.1:4200 || status=1
phase nosync nosync NEON_AUTH_BASE_URL=http://127.0.0.1:4100/neondb/auth NEON_AUTH_COOKIE_SECRET=$SECRET || status=1
phase off off || status=1
free_port 8765
echo "evidence: $OUT (status $status)"
exit $status

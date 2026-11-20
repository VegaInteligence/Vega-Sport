#!/bin/bash
# §48's targeted suites on the candidate worktree, against the disposable loopback PG18 of this validation.
# Usage: bash run-48.sh <output.txt> <title>
# Prerequisites: container vega-opus-finalisation-20nov-pg18 (pgvector/pgvector:pg18, 127.0.0.1:55561, trust), the
# test databases created by `ci-clean/bin/python backend/ci/test_databases.py postgresql://postgres@127.0.0.1:55561 > dsn.env`,
# `npm ci --prefix backend/api` (node 24) done in the worktree.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../candidat"
ROOT=/Users/lemonnierhugo/.codex/visualizations/2026/11/17/01a1e6f1-9c43-7b81-a52e-3ee15c953578/production-architecture-review
PY="$ROOT/ci-clean/bin/python"
N24=/Users/lemonnierhugo/.local/share/nodejs/node-v24.15.0-darwin-arm64/bin
OUT="$1"; TITLE="$2"
cd "$REPO"
set -a; . "$HERE/dsn.env"; set +a
export PATH="$N24:$PATH" PYTHONPATH=backend CI=true PYTHONDONTWRITEBYTECODE=1
TESTS=(backend/tests/test_award_year_2020_order.py backend/tests/test_collection_wakeups.py backend/tests/test_deploy_migrations.py
       backend/tests/test_player_grade_reasons.py backend/tests/test_source_identity.py)
{
  echo "# $TITLE"
  echo "HEAD=$(git rev-parse HEAD) status=[$(git status --porcelain | tr '\n' ' ')]"
  echo "backend/vega vs M0 1594b63731: [$(git diff --stat 1594b63731 HEAD -- backend/vega | tail -1)]"
  echo "date=$(date -u +%FT%TZ) $(docker --context colima exec vega-opus-finalisation-20nov-pg18 postgres --version) $("$PY" --version) node=$(node --version)"
  echo "env: set -a; . validation-opus/dsn.env; set +a (127.0.0.1:55561, trust); PATH=node 24.15.0; PYTHONPATH=backend CI=true PYTHONDONTWRITEBYTECODE=1"
  echo "command (from candidat/): ci-clean/bin/python -m unittest ${TESTS[*]} -v"
  echo
} > "$OUT"
"$PY" -m unittest "${TESTS[@]}" -v >> "$OUT" 2>&1
echo "exit=$?" >> "$OUT"
grep -E '\.\.\. (FAIL|ERROR)$|^(FAIL|ERROR):|^Ran |^FAILED|^OK|^exit=' "$OUT"

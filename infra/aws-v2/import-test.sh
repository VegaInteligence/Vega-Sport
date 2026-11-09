#!/usr/bin/env bash
# Import test of the v2 base (vega-football-db-postgres): one full league season through
# the backfill task, one archive season through the archive task, then the read API's
# answers for both. Run after deploy.sh, from the repository root:
#
#   AWS_PROFILE=statarena ARCHIVE_SOURCES_BUCKET=<main's data bucket> bash infra/aws-v2/import-test.sh
#
# Environment: LEAGUE (l_3FJFUl, Ligue 1), SEASON (2025, i.e. 2025/2026), ARCHIVE_SEASON
# (2019/2020), ARCHIVE_SOURCES_BUCKET (read only; without it the archive step is skipped).
# Writes only to the v2 base, through its own tasks; the current RDS is not touched.
set -euo pipefail
export AWS_REGION=${AWS_REGION:-us-east-2}
LEAGUE=${LEAGUE:-l_3FJFUl}
SEASON=${SEASON:-2025}
LABEL="$SEASON/$((SEASON + 1))"
ARCHIVE_SEASON=${ARCHIVE_SEASON:-2019/2020}
ARCHIVES=${ARCHIVE_SOURCES_BUCKET:-}
SUBNETS=subnet-0233a9567335f56ce,subnet-04c9af303f55d9718,subnet-0e72516f361932c15
[ "$(aws sts get-caller-identity --query Account --output text)" = 361769570630 ] || { echo "wrong AWS account" >&2; exit 1; }
output() { aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text; }
API=$(output vega-v2-api ApiOrigin)
SG=$(output vega-v2-database WorkerSecurityGroup)

# A one-off task with its command replaced; waits for it and prints how it ended.
run() {
  local family=$1 container=$2 command=$3 task
  task=$(aws ecs run-task --cluster vega-v2 --task-definition "$family" --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=ENABLED}" \
    --overrides "{\"containerOverrides\":[{\"name\":\"$container\",\"command\":$command}]}" \
    --query 'tasks[0].taskArn' --output text)
  echo "   task $task (logs: /ecs/vega-v2-worker)"
  until [ "$(aws ecs describe-tasks --cluster vega-v2 --tasks "$task" --query 'tasks[0].lastStatus' --output text)" = STOPPED ]; do sleep 60; done
  aws ecs describe-tasks --cluster vega-v2 --tasks "$task" --query 'tasks[0].containers[0].[exitCode,reason]' --output text
}
get() { curl -fsS --max-time 60 "$API$1"; }

echo "== 1. The league catalogue is loaded (the worker service reads it at start)"
until get "/api/competitions" | python3 -c "import json,sys; d=json.load(sys.stdin)['data']['leagues']; sys.exit(0 if any(l['id']=='$LEAGUE' and '$LABEL' in l['seasons'] for l in d) else 1)"; do
  echo "   waiting for $LEAGUE $LABEL in the catalogue"; sleep 120
done

echo "== 2. Backfill $LEAGUE $LABEL: calendar, then the 13 families of every finished match"
run vega-v2-backfill backfill "[\"--lanes\",\"backfill\",\"--until-idle\",\"--backfill-from\",\"$SEASON\",\"--backfill-to\",\"$SEASON\",\"--backfill-competitions\",\"$LEAGUE\"]"

if [ -n "$ARCHIVES" ]; then
  echo "== 3. Archive season $ARCHIVE_SEASON"
  run vega-v2-archives archives "[\"--sources\",\"s3://$ARCHIVES/data/sources\",\"--seasons\",\"$ARCHIVE_SEASON\"]"
else
  echo "== 3. Archive season skipped (ARCHIVE_SOURCES_BUCKET not set)"
fi

echo "== 4. Read API checks ($API)"
python3 - "$API" "$LEAGUE" "$LABEL" "$ARCHIVE_SEASON" "${ARCHIVES:+yes}" <<'PY'
import json, sys, urllib.parse, urllib.request
api, league, label, archive, with_archive = sys.argv[1:6]
def get(path):
    with urllib.request.urlopen(api + path, timeout=60) as r:
        return json.load(r)
q = urllib.parse.quote
manifest = get("/api/dashboard/manifest")
chunk = next((c for s in manifest["seasons"] if s["id"] == label for c in s["chunks"] if c["leagueId"] == league), None)
print("edition:", chunk and chunk["meta"])
fixtures = get(f"/api/fixtures?league={league}&season={q(label)}&status=played&limit=100")["data"]["matches"]
print("played matches (first page):", len(fixtures))
match = fixtures[0]["id"]
for family in ("", "/lineups", "/events", "/shots", "/stats", "/players", "/players/halves", "/momentum", "/advanced",
               "/advanced/players", "/advanced/network", "/heatmaps", "/h2h"):
    try:
        data = get(f"/api/matches/{match}{family}")["data"]
        print(f"  {match}{family or ' (match)'}: ok, {len(json.dumps(data))} bytes")
    except Exception as error:
        print(f"  {match}{family}: {error}")
page = get(f"/api/seasons/partition?season={q(label)}&league={league}")
print("season loader, first page:", len(page["data"]["fixtures"]), "fixtures,", len(page["data"]["appearances"]), "appearances")
print("clubs read:", len(get(f"/api/read/clubs?season={q(label)}&leagues={league}")["data"]["clubs"]), "clubs")
standings = get(f"/api/standings?competition={league}&season={q(label)}")
print("standings rows:", sum(len(t["rows"]) for t in standings["tables"]))
for kind in ("players", "clubs"):
    try:
        rows = get(f"/api/rankings/power?kind={kind}&season={q(label)}&limit=5")["rows"]
        print(f"power ranking {kind}:", [(r["rank"], r["name"], r.get("score", r.get("elo"))) for r in rows])
    except Exception as error:
        print(f"power ranking {kind}: {error} (computed by the worker's daily pass)")
if with_archive:
    read = get(f"/api/read/archive?season={q(archive)}")
    print("archive", archive, read["data"]["summary"])
PY
echo "done"

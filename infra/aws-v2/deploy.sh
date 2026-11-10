#!/usr/bin/env bash
# Deploy v2 next to the current backend, from the repository root. The same steps run in
# .github/workflows/v2-deploy.yml (vega-v2-deploy role) and on a workstation:
#
#   aws login --profile statarena
#   AWS_PROFILE=statarena PITCHAPI_API_KEY_FILE=~/pitchapi.key bash infra/aws-v2/deploy.sh
#
# Steps: the second base vega-football-db-postgres, its secrets, the worker stack, the
# worker image, the migrations and logins, the worker start, the live stack (store,
# broadcast, full-state read, ingestor), the read API package, the read API stack and its
# distribution, and optionally the historical archive import.
# The current RDS (statarena-postgres), API, distribution and workflows are not touched.
#
# Environment: WORKER_DESIRED_COUNT (1), BACKFILL_DESIRED_COUNT (kept from the previous
# deploy when unset: 1 while history is collected, 0 once it is), IMPORT_ARCHIVES (false), ARCHIVE_SOURCES_BUCKET
# (main's data bucket, read only, for the archives; kept from the previous deploy when unset), CFN_ROLE (CloudFormation service role,
# set by the workflow), IMAGE_TAG (git HEAD), PITCHAPI_API_KEY or PITCHAPI_API_KEY_FILE
# (needed once, to create /vega/v2/pitchapi-key), SPORTSAPI_API_KEY or SPORTSAPI_API_KEY_FILE
# (optional, once: /vega/v2/sportsapi-key, the SportsAPI ranking snapshots) and LIVE_PROVIDER
# (empty: the live circuit is deployed, the schedule that starts its ingestor is off).
set -euo pipefail
export AWS_REGION=${AWS_REGION:-us-east-2}
ACCOUNT=361769570630
REGISTRY="$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"
RELEASES="statarena-backend-releases-$ACCOUNT-$AWS_REGION"
SUBNETS=subnet-0233a9567335f56ce,subnet-04c9af303f55d9718,subnet-0e72516f361932c15
TAG=${IMAGE_TAG:-$(git rev-parse HEAD)}
# What is deployed is the commit $TAG and nothing else: the image, the two Lambda packages
# and the templates are read from a clean export of that commit, never from the checkout.
# (A checkout can be edited while the deploy runs, by hand or by a second session: the
# change went out under a tag that does not hold it.) The export holds what the deploy
# reads: v2, infra, and dashboard for main's files the image and the read API share.
if [ -z "${VEGA_V2_DEPLOY_EXPORT:-}" ]; then
  export_dir=$(mktemp -d)
  trap 'rm -rf "$export_dir"' EXIT
  git archive --format=tar "$TAG" v2 infra dashboard | tar -xf - -C "$export_dir"
  (cd "$export_dir" && IMAGE_TAG=$TAG VEGA_V2_DEPLOY_EXPORT=1 bash infra/aws-v2/deploy.sh)
  exit
fi
COUNT=${WORKER_DESIRED_COUNT:-1}
# The live ingestor stays off until a live provider is chosen (doc "Live"): LIVE_PROVIDER names its
# adapter (vega_v2/live/adapters.py) and turns on the schedule that starts it.
ARCHIVES=${ARCHIVE_SOURCES_BUCKET:-}
role=(); [ -n "${CFN_ROLE:-}" ] && role=(--role-arn "$CFN_ROLE")
if [ -z "${PITCHAPI_API_KEY:-}" ] && [ -n "${PITCHAPI_API_KEY_FILE:-}" ]; then PITCHAPI_API_KEY=$(cat "$PITCHAPI_API_KEY_FILE"); export PITCHAPI_API_KEY; fi
if [ -z "${SPORTSAPI_API_KEY:-}" ] && [ -n "${SPORTSAPI_API_KEY_FILE:-}" ]; then SPORTSAPI_API_KEY=$(cat "$SPORTSAPI_API_KEY_FILE"); export SPORTSAPI_API_KEY; fi
[ "$(aws sts get-caller-identity --query Account --output text)" = "$ACCOUNT" ] || { echo "wrong AWS account" >&2; exit 1; }
# A deploy without ARCHIVE_SOURCES_BUCKET keeps the bucket the worker stack already has
# (otherwise every later deploy dropped it, and the archive task with it).
if [ -z "$ARCHIVES" ]; then
  ARCHIVES=$(aws cloudformation describe-stacks --stack-name vega-v2-worker \
    --query "Stacks[0].Parameters[?ParameterKey=='ArchiveSourcesBucket'].ParameterValue" --output text 2>/dev/null || true)
  [ "$ARCHIVES" = None ] && ARCHIVES=
fi
# The backfill service keeps the size it has (0 or 1) unless BACKFILL_DESIRED_COUNT says otherwise.
BACKFILL=${BACKFILL_DESIRED_COUNT:-}
if [ -z "$BACKFILL" ]; then
  BACKFILL=$(aws cloudformation describe-stacks --stack-name vega-v2-worker \
    --query "Stacks[0].Parameters[?ParameterKey=='BackfillDesiredCount'].ParameterValue" --output text 2>/dev/null || true)
  case "$BACKFILL" in 0|1) ;; *) BACKFILL=0 ;; esac
fi
output() { aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text 2>/dev/null || true; }
stack() { aws cloudformation deploy ${role[@]+"${role[@]}"} --no-fail-on-empty-changeset --stack-name "$1" --template-file "infra/aws-v2/$2" "${@:3}"; }
run_task() {
  local sg task
  sg=$(output vega-v2-database WorkerSecurityGroup)
  task=$(aws ecs run-task --cluster vega-v2 --task-definition "$1" --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$sg],assignPublicIp=ENABLED}" \
    --query 'tasks[0].taskArn' --output text)
  echo "$task"
}

echo "== 1. Database vega-football-db-postgres (about 10 minutes the first time)"
stack vega-v2-database database.yaml
echo "== 2. Secrets"
bash infra/aws-v2/ci/secrets.sh
# The SportsAPI source is on once its key is in SSM.
SPORTSAPI=$(aws ssm get-parameter --name /vega/v2/sportsapi-key --query Parameter.Name --output text 2>/dev/null || true)
echo "== 3. Worker stack, worker and backfill stopped"
stack vega-v2-worker worker.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides ImageTag="$TAG" DesiredCount=0 BackfillDesiredCount=0 ArchiveSourcesBucket="$ARCHIVES" SportsApiKeyParameter="$SPORTSAPI"
echo "== 4. Worker image $TAG (linux/arm64)"
if ! aws ecr describe-images --repository-name vega-v2-worker --image-ids imageTag="$TAG" >/dev/null 2>&1; then
  aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
  docker build --platform linux/arm64 -f v2/Dockerfile -t "$REGISTRY/vega-v2-worker:$TAG" .
  docker push "$REGISTRY/vega-v2-worker:$TAG"
fi
echo "== 5. Migrations and logins"
task=$(run_task vega-v2-migrate)
aws ecs wait tasks-stopped --cluster vega-v2 --tasks "$task"
code=$(aws ecs describe-tasks --cluster vega-v2 --tasks "$task" --query 'tasks[0].containers[0].exitCode' --output text)
echo "migration exit code: $code"; [ "$code" = 0 ]
echo "== 6. Worker: $COUNT task(s); backfill: $BACKFILL task(s)"
stack vega-v2-worker worker.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides ImageTag="$TAG" DesiredCount="$COUNT" BackfillDesiredCount="$BACKFILL" ArchiveSourcesBucket="$ARCHIVES" SportsApiKeyParameter="$SPORTSAPI"
echo "== 6b. Live: store, broadcast, full-state read, ingestor schedule (provider '${LIVE_PROVIDER:-}', $([ -n "${LIVE_PROVIDER:-}" ] && echo on || echo off))"
live_zip=$(python3 infra/aws-v2/package_api.py "${RUNNER_TEMP:-$(mktemp -d)}/v2-live" live | tail -1)
live_key="releases/v2-live/$(basename "$live_zip")"
aws s3 cp "$live_zip" "s3://$RELEASES/$live_key" >/dev/null
# The browser key is renewed for 360 days on every deploy (AppSync allows 365 at most).
expires=$(( ( $(date +%s) / 3600 ) * 3600 + 360 * 86400 ))
stack vega-v2-live live.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides ImageTag="$TAG" ReleaseKey="$live_key" ApiKeyExpires="$expires" LiveProvider="${LIVE_PROVIDER:-}"
echo "== 7. Read API package"
npm ci --prefix v2/api >/dev/null
zip=$(python3 infra/aws-v2/package_api.py "${RUNNER_TEMP:-$(mktemp -d)}/v2-api" | tail -1)
key="releases/v2-api/$(basename "$zip")"
aws s3 cp "$zip" "s3://$RELEASES/$key" >/dev/null
echo "== 8. Read API stack and distribution"
url=$(aws ssm get-parameter --name /vega/v2/read-database-url --with-decryption --query Parameter.Value --output text)
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$url"
ops=$(aws ssm get-parameter --name /vega/v2/ops-key --with-decryption --query Parameter.Value --output text)
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$ops"
media=$(output vega-v2-api ApiOrigin)
api() { stack vega-v2-api api.yaml --capabilities CAPABILITY_IAM --parameter-overrides ReleaseKey="$key" ReadDatabaseUrl="$url" OpsKey="$ops" MediaBaseUrl="$1"; }
if [ -n "$media" ] && [ "$media" != None ]; then api "$media/"; else
  api ""
  media=$(output vega-v2-api ApiOrigin)
  api "$media/"  # the distribution's domain is known now: serve the media map
fi
echo "v2 read API: $media"
if [ "${IMPORT_ARCHIVES:-false}" = true ] && [ -n "$ARCHIVES" ]; then
  echo "== 9. Historical archives (runs for a while; logs /ecs/vega-v2-worker, prefix archives)"
  run_task vega-v2-archives
fi
echo "done"

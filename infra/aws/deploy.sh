#!/usr/bin/env bash
# Deploy the backend, from the repository root. The same steps run in
# .github/workflows/deploy.yml (vega-v2-deploy role) and on a workstation:
#
#   aws login --profile statarena
#   AWS_PROFILE=statarena PITCHAPI_API_KEY_FILE=~/pitchapi.key bash infra/aws/deploy.sh
#
# Steps: the base vega-football-db-postgres, its secrets, the worker stack, the
# worker image, the migrations and logins, the worker start, the live stack (store,
# broadcast, full-state read, ingestor), the read API package, the read API stack and its
# distribution, optionally the historical archive import, the alerts (alerts.yaml, and
# alerts-edge.yaml in us-east-1), and the account API (account.yaml) once SSM
# /vega/v2/account-deploy is on (backend/account/DEPLOYMENT.md; its preflight runs first).
#
# Environment: WORKER_DESIRED_COUNT (1), BACKFILL_DESIRED_COUNT (kept from the previous
# deploy when unset: 1 while history is collected, 0 once it is), IMPORT_ARCHIVES (false), ARCHIVE_SOURCES_BUCKET
# (where the pinned archive sources are, under data/sources/; the stack's release bucket when unset), CFN_ROLE (CloudFormation service role,
# set by the workflow), IMAGE_TAG (git HEAD), PITCHAPI_API_KEY or PITCHAPI_API_KEY_FILE
# (needed once, to create /vega/v2/pitchapi-key) and LIVE_PROVIDER
# (empty: the live circuit is deployed, the schedule that starts its ingestor is off).
# VI-35: WAF_MODE (Count or Block; unset, the web ACL keeps its mode, Count the first time).
set -euo pipefail
export AWS_REGION=${AWS_REGION:-us-east-2}
ACCOUNT=361769570630
REGISTRY="$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"
RELEASES="vega-v2-releases-$ACCOUNT-$AWS_REGION"
SUBNETS=subnet-0233a9567335f56ce,subnet-04c9af303f55d9718,subnet-0e72516f361932c15
TAG=${IMAGE_TAG:-$(git rev-parse HEAD)}
# What is deployed is the commit $TAG and nothing else: the image, the two Lambda packages
# and the templates are read from a clean export of that commit, never from the checkout.
# (A checkout can be edited while the deploy runs, by hand or by a second session: the
# change went out under a tag that does not hold it.) The export holds what the deploy
# reads: backend, infra, and dashboard for the site's files the image and the read API share.
if [ -z "${VEGA_V2_DEPLOY_EXPORT:-}" ]; then
  export_dir=$(mktemp -d)
  trap 'rm -rf "$export_dir"' EXIT
  git archive --format=tar "$TAG" backend infra dashboard | tar -xf - -C "$export_dir"
  (cd "$export_dir" && IMAGE_TAG=$TAG VEGA_V2_DEPLOY_EXPORT=1 bash infra/aws/deploy.sh)
  exit
fi
COUNT=${WORKER_DESIRED_COUNT:-1}
# Copies of the read API's function that may run at once (api.yaml, ReservedConcurrency).
# Passed on every deploy: CloudFormation keeps a stack's previous value for a parameter
# that is not. The login's connection limit follows it (backend/vega/migrate.py).
API_COPIES=32
# The live ingestor stays off until a live provider is chosen (doc "Live"): LIVE_PROVIDER names its
# adapter (vega/live/adapters.py) and turns on the schedule that starts it.
ARCHIVES=${ARCHIVE_SOURCES_BUCKET:-}
role=(); [ -n "${CFN_ROLE:-}" ] && role=(--role-arn "$CFN_ROLE")
if [ -z "${PITCHAPI_API_KEY:-}" ] && [ -n "${PITCHAPI_API_KEY_FILE:-}" ]; then PITCHAPI_API_KEY=$(cat "$PITCHAPI_API_KEY_FILE"); export PITCHAPI_API_KEY; fi
[ "$(aws sts get-caller-identity --query Account --output text)" = "$ACCOUNT" ] || { echo "wrong AWS account" >&2; exit 1; }
# The pinned archive sources live in the stack's own release bucket (data/sources/), next to
# the function packages: nothing of the stack reads another bucket.
[ -z "$ARCHIVES" ] && ARCHIVES=$RELEASES
# The backfill service keeps the size it has (0 or 1) unless BACKFILL_DESIRED_COUNT says otherwise.
BACKFILL=${BACKFILL_DESIRED_COUNT:-}
if [ -z "$BACKFILL" ]; then
  BACKFILL=$(aws cloudformation describe-stacks --stack-name vega-v2-worker \
    --query "Stacks[0].Parameters[?ParameterKey=='BackfillDesiredCount'].ParameterValue" --output text 2>/dev/null || true)
  case "$BACKFILL" in 0|1) ;; *) BACKFILL=0 ;; esac
fi
output() { aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text 2>/dev/null || true; }
stack() { aws cloudformation deploy ${role[@]+"${role[@]}"} --no-fail-on-empty-changeset --stack-name "$1" --template-file "infra/aws/$2" "${@:3}"; }
run_task() {
  local sg task
  sg=$(output vega-v2-database WorkerSecurityGroup)
  task=$(aws ecs run-task --cluster vega-v2 --task-definition "$1" --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$sg],assignPublicIp=ENABLED}" \
    --query 'tasks[0].taskArn' --output text)
  echo "$task"
}
ssm_value() { aws ssm get-parameter --name "$1" ${2:+--with-decryption} --query Parameter.Value --output text 2>/dev/null || true; }

# --- Account API (VI-38; backend/account/DEPLOYMENT.md, FAILURE_MODES.md section 10) ---
# One switch: SSM /vega/v2/account-deploy (String), on or off, created last by the owner. Absent
# or off, nothing of the account is touched: the Deploy is the one before the account, plus one
# line. On, every prerequisite is checked here, before anything changes; a missing or malformed
# one stops the Deploy naming it (never a Deploy stopped midway by a half-prepared account).
# Values are checked against account.yaml's AllowedPattern and never printed.
ACCOUNT=off
account_on=()
account_preflight() {
  local LC_ALL=C switch status value problems=() p name pattern need secure
  switch=$(ssm_value /vega/v2/account-deploy)
  case "$switch" in
    "") echo "account: off (no SSM parameter /vega/v2/account-deploy): the account API is not deployed (backend/account/DEPLOYMENT.md, section 3)"; return 0 ;;
    off) echo "account: off (/vega/v2/account-deploy is off): the account API is not deployed (backend/account/DEPLOYMENT.md, section 3)"; return 0 ;;
    on) ;;
    *) problems+=("/vega/v2/account-deploy holds neither value allowed: it must be on or off") ;;
  esac
  if [ ${#problems[@]} = 0 ]; then
    [ "$(output vega-v2-deploy-roles AccountGrants)" = 1 ] ||
      problems+=("stack vega-v2-deploy-roles: its output AccountGrants is not 1: the owner updates it from the Mac with infra/aws/deploy-roles.yaml (backend/account/DEPLOYMENT.md, section 3)")
    # name, pattern (account.yaml's AllowedPattern, matched on the whole value), required or optional, String or SecureString
    while read -r name pattern need secure; do
      value=$(ssm_value "$name" "$([ "$secure" = SecureString ] && echo decrypt)")
      if [ -z "$value" ]; then
        [ "$need" = optional ] || problems+=("$name: missing (SSM $secure; backend/account/DEPLOYMENT.md, section 3)")
      elif ! [[ $value =~ ^($pattern)$ ]]; then
        problems+=("$name: malformed (SSM $secure, not of the form infra/aws/account.yaml accepts)")
      fi
    done <<'PREREQUISITES'
/vega/v2/neon-auth-url https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~-]+)*/? required String
/vega/v2/neon-project-id [A-Za-z0-9_-]{1,64} required String
/vega/v2/neon-branch-id [A-Za-z0-9_-]{1,64} required String
/vega/v2/site-origins (https://[a-z0-9.-]+|http://localhost:[0-9]+)(,(https://[a-z0-9.-]+|http://localhost:[0-9]+))* required String
/vega/v2/neon-api-key [[:graph:]]{16,512} optional SecureString
/vega/v2/account-database-url postgresql://vega_v2_account:[^@]+@[^/]+/vega_v2 optional SecureString
/vega/v2/pass-key/k1 [A-Za-z0-9_-]{43,} optional SecureString
PREREQUISITES
    # Absent, the stack is created at step 11; present, CloudFormation must be able to update it.
    status=$(aws cloudformation describe-stacks --stack-name vega-v2-account --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true)
    case "$status" in
      ""|CREATE_COMPLETE|UPDATE_COMPLETE|UPDATE_ROLLBACK_COMPLETE|IMPORT_COMPLETE|IMPORT_ROLLBACK_COMPLETE) ;;
      ROLLBACK_COMPLETE) problems+=("stack vega-v2-account is ROLLBACK_COMPLETE (its first creation failed): the owner deletes it from the Mac (aws cloudformation delete-stack --profile statarena --region us-east-2 --stack-name vega-v2-account) and the next Deploy creates it again") ;;
      UPDATE_ROLLBACK_FAILED) problems+=("stack vega-v2-account is UPDATE_ROLLBACK_FAILED: the owner recovers it from the Mac (aws cloudformation continue-update-rollback --profile statarena --region us-east-2 --stack-name vega-v2-account)") ;;
      *) problems+=("stack vega-v2-account is $status: CloudFormation cannot update it now (backend/account/DEPLOYMENT.md, section 3)") ;;
    esac
  fi
  if [ ${#problems[@]} -gt 0 ]; then
    for p in "${problems[@]}"; do echo "account: $p" >&2; done
    echo "account: the Deploy stops before changing anything. To deploy without the account, set /vega/v2/account-deploy to off (aws ssm put-parameter --name /vega/v2/account-deploy --type String --overwrite --value off)." >&2
    return 1
  fi
  ACCOUNT=on
  account_on=(Account=true)
  echo "account: on: every prerequisite is present; the account API is deployed at step 11 (stack vega-v2-account)"
}
account_preflight
# --- end of the account preflight ---

echo "== 1. Database vega-football-db-postgres (about 10 minutes the first time)"
# Account=true once the account is on (its store's security group); unset, the stack keeps its value.
database=(); [ "$ACCOUNT" = on ] && database=(--parameter-overrides Account=true)
stack vega-v2-database database.yaml ${database[@]+"${database[@]}"}
echo "== 2. Secrets"
VEGA_ACCOUNT=$ACCOUNT bash infra/aws/ci/secrets.sh
# Optional, once: /vega/v2/odds-api-key (The Odds API, bookmakers' odds of the coming matches).
ODDS=$(aws ssm get-parameter --name /vega/v2/odds-api-key --query Parameter.Name --output text 2>/dev/null || true)
echo "== 3. Worker stack, worker and backfill stopped"
stack vega-v2-worker worker.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides ImageTag="$TAG" DesiredCount=0 BackfillDesiredCount=0 ArchiveSourcesBucket="$ARCHIVES" OddsApiKeyParameter="$ODDS" ${account_on[@]+"${account_on[@]}"}
echo "== 4. Worker image $TAG (linux/arm64)"
if ! aws ecr describe-images --repository-name vega-v2-worker --image-ids imageTag="$TAG" >/dev/null 2>&1; then
  aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
  docker build --platform linux/arm64 -f backend/Dockerfile -t "$REGISTRY/vega-v2-worker:$TAG" .
  docker push "$REGISTRY/vega-v2-worker:$TAG"
fi
echo "== 5. Migrations and logins"
task=$(run_task vega-v2-migrate)
aws ecs wait tasks-stopped --cluster vega-v2 --tasks "$task"
code=$(aws ecs describe-tasks --cluster vega-v2 --tasks "$task" --query 'tasks[0].containers[0].exitCode' --output text)
echo "migration exit code: $code"; [ "$code" = 0 ]
echo "== 6. Worker: $COUNT task(s); backfill: $BACKFILL task(s)"
stack vega-v2-worker worker.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides ImageTag="$TAG" DesiredCount="$COUNT" BackfillDesiredCount="$BACKFILL" ArchiveSourcesBucket="$ARCHIVES" OddsApiKeyParameter="$ODDS" ${account_on[@]+"${account_on[@]}"}
echo "== 6b. Live: store, broadcast, full-state read, ingestor schedule (provider '${LIVE_PROVIDER:-}', $([ -n "${LIVE_PROVIDER:-}" ] && echo on || echo off))"
live_zip=$(python3 infra/aws/package_api.py "${RUNNER_TEMP:-$(mktemp -d)}/live-package" live | tail -1)
live_key="releases/v2-live/$(basename "$live_zip")"
aws s3 cp "$live_zip" "s3://$RELEASES/$live_key" >/dev/null
# The browser key is renewed for 360 days on every deploy (AppSync allows 365 at most).
expires=$(( ( $(date +%s) / 3600 ) * 3600 + 360 * 86400 ))
stack vega-v2-live live.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides ImageTag="$TAG" ReleaseKey="$live_key" ApiKeyExpires="$expires" LiveProvider="${LIVE_PROVIDER:-}"
echo "== 7. Read API package"
npm ci --prefix backend/api >/dev/null
zip=$(python3 infra/aws/package_api.py "${RUNNER_TEMP:-$(mktemp -d)}/api-package" | tail -1)
key="releases/v2-api/$(basename "$zip")"
aws s3 cp "$zip" "s3://$RELEASES/$key" >/dev/null
# BEGIN VI-35 web ACL
# The distribution's per-address limit (waf.yaml). A web ACL of CloudFront scope lives in
# us-east-1 only. Its mode is kept unless WAF_MODE names one; the site's server key
# (/vega/v2/edge-key) takes the site's own reads out of the counts.
echo "== 7b. Web ACL of the distribution (us-east-1, mode ${WAF_MODE:-kept})"
edge=$(aws ssm get-parameter --name /vega/v2/edge-key --with-decryption --query Parameter.Value --output text)
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$edge"
waf_mode=(); [ -n "${WAF_MODE:-}" ] && waf_mode=(Mode="$WAF_MODE")
stack vega-v2-waf waf.yaml --region us-east-1 --parameter-overrides SiteKey="$edge" ${waf_mode[@]+"${waf_mode[@]}"}
web_acl=$(aws cloudformation describe-stacks --region us-east-1 --stack-name vega-v2-waf \
  --query "Stacks[0].Outputs[?OutputKey=='WebAclArn'].OutputValue" --output text)
# END VI-35 web ACL
echo "== 8. Read API stack and distribution"
url=$(aws ssm get-parameter --name /vega/v2/read-database-url --with-decryption --query Parameter.Value --output text)
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$url"
ops=$(aws ssm get-parameter --name /vega/v2/ops-key --with-decryption --query Parameter.Value --output text)
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$ops"
media=$(output vega-v2-api ApiOrigin)
api() { stack vega-v2-api api.yaml --capabilities CAPABILITY_IAM --parameter-overrides ReleaseKey="$key" ReadDatabaseUrl="$url" OpsKey="$ops" MediaBaseUrl="$1" ReservedConcurrency="$API_COPIES" WebAclArn="$web_acl"; }
if [ -n "$media" ] && [ "$media" != None ]; then api "$media/"; else
  api ""
  media=$(output vega-v2-api ApiOrigin)
  api "$media/"  # the distribution's domain is known now: serve the media map
fi
echo "read API: $media"
if [ "${IMPORT_ARCHIVES:-false}" = true ] && [ -n "$ARCHIVES" ]; then
  echo "== 9. Historical archives (runs for a while; logs /ecs/vega-v2-worker, prefix archives)"
  run_task vega-v2-archives
fi
# --- Alerts (alerts.yaml here, alerts-edge.yaml in us-east-1; README, Alerts) ---
# After the read API stack: the edge stack names its distribution. The addresses are never
# in the repository: SSM /vega/v2/alert-email, set once by the account owner, one address
# or two separated by a comma (two people run the service). Without it the topics have no
# subscription and the deploy goes on.
echo "== 10. Alerts: topic vega-v2-alerts and its alarms (here and in us-east-1)"
alert_emails=$(aws ssm get-parameter --name /vega/v2/alert-email --with-decryption --query Parameter.Value --output text 2>/dev/null || true)
[ "$alert_emails" = None ] && alert_emails=
alert_emails=${alert_emails//[[:space:]]/}
IFS=, read -r alert_email alert_email2 alert_more <<<"$alert_emails" || true
if [ -n "$alert_email" ]; then
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::add-mask::$alert_email"
    [ -n "$alert_email2" ] && echo "::add-mask::$alert_email2"
  fi
  [ -n "$alert_more" ] && echo "alerts: /vega/v2/alert-email holds more than two addresses: the first two are subscribed (README, Alerts)"
else
  alert_email2=
  echo "alerts: no SSM parameter /vega/v2/alert-email: the alarms notify a topic with no e-mail subscription (README, Alerts)"
fi
watch_worker=true; [ "$COUNT" = 0 ] && watch_worker=false
watch_live=false; [ -n "${LIVE_PROVIDER:-}" ] && watch_live=true
stack vega-v2-alerts alerts.yaml --parameter-overrides AlertEmail="$alert_email" AlertEmail2="$alert_email2" WatchWorker="$watch_worker" WatchLive="$watch_live" \
  ${account_on[@]+"${account_on[@]}"}
stack vega-v2-alerts-edge alerts-edge.yaml --region us-east-1 --parameter-overrides AlertEmail="$alert_email" AlertEmail2="$alert_email2" \
  DistributionId="$(output vega-v2-api DistributionId)" ApiDomain="${media#https://}"
# --- end of alerts ---
# --- Account API (VI-38): last, so that its failure leaves everything else deployed. It imports
# the database's security group (step 1) and its store connects as the login the migrate task set
# (step 5). Secrets reach the stack as NoEcho parameters, as the read API's URL does (step 8).
if [ "$ACCOUNT" = on ]; then
  echo "== 11. Account API: front and store (stack vega-v2-account)"
  npm ci --prefix backend/account >/dev/null
  account_dir="${RUNNER_TEMP:-$(mktemp -d)}/account-package"
  front_zip=$(python3 infra/aws/package_api.py "$account_dir" account-front | tail -1)
  store_zip=$(python3 infra/aws/package_api.py "$account_dir" account-store | tail -1)
  front_key="releases/v2-account/$(basename "$front_zip")"
  store_key="releases/v2-account/$(basename "$store_zip")"
  aws s3 cp "$front_zip" "s3://$RELEASES/$front_key" >/dev/null
  aws s3 cp "$store_zip" "s3://$RELEASES/$store_key" >/dev/null
  account_url=$(aws ssm get-parameter --name /vega/v2/account-database-url --with-decryption --query Parameter.Value --output text)
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$account_url"
  pass_key=$(aws ssm get-parameter --name /vega/v2/pass-key/k1 --with-decryption --query Parameter.Value --output text)
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$pass_key"
  neon_key=$(ssm_value /vega/v2/neon-api-key decrypt)
  if [ -n "$neon_key" ]; then
    [ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$neon_key"
  else
    echo "account: no SSM parameter /vega/v2/neon-api-key: DELETE /account answers 503 DELETION_UNAVAILABLE and erases nothing"
  fi
  # One pass key today (k1); a rotation adds k2 to PassKeys and later moves PassKeyCurrent.
  stack vega-v2-account account.yaml --capabilities CAPABILITY_IAM --parameter-overrides FrontReleaseKey="$front_key" StoreReleaseKey="$store_key" \
    AccountDatabaseUrl="$account_url" NeonAuthUrl="$(ssm_value /vega/v2/neon-auth-url)" SiteOrigins="$(ssm_value /vega/v2/site-origins)" \
    PassKeys="k1:$pass_key" PassKeyCurrent=k1 NeonApiKey="$neon_key" NeonProjectId="$(ssm_value /vega/v2/neon-project-id)" \
    NeonBranchId="$(ssm_value /vega/v2/neon-branch-id)"
  echo "account API: $(output vega-v2-account FrontUrl)"
fi
# --- end of the account API ---
echo "done"

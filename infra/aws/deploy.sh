#!/usr/bin/env bash
# Deploy the backend, from the repository root. The same steps run in
# .github/workflows/deploy.yml (vega-v2-deploy role) and on a workstation:
#
#   aws login --profile statarena
#   AWS_PROFILE=statarena PITCHAPI_API_KEY_FILE=~/pitchapi.key bash infra/aws/deploy.sh
#
# Steps (FAILURE_MODES_OPTIMISATIONS.md GH157/GH158): the preflight (the account's, the roles' grants) and the Deploy's
# own state (s3://<release bucket>/deploy/state.json, infra/aws/deploy_state.py: which run deploys, what it stopped);
# the base vega-football-db-postgres and its secrets; the worker's image, named by what it is made of
# (infra/aws/image_identity.py), built and pushed only when the registry does not hold it, before anything stops; the
# candidate's migrations and logins, applied while the worker and the backfill run when every pending migration is
# marked `-- vega:online`, else once both are stopped (their counts saved first); one update giving the services the
# image; the live stack (store, broadcast, full-state read, ingestor); the read API package, its stack and its
# distribution, the distribution's access logs (us-east-1); optionally the historical archive import; the alerts
# (alerts.yaml, and alerts-edge.yaml in us-east-1); the account API (account.yaml) once SSM /vega/v2/account-deploy is
# on (backend/account/DEPLOYMENT.md; its preflight runs first); then a check of the home's personal read through the
# distribution (infra/aws/smoke-favourites.mjs).
#
# Environment: WORKER_DESIRED_COUNT (0, 1, or keep/unset: the count a Deploy saved when it stopped the services and could
# not restore them, else the stack's, else 1 on a first install), BACKFILL_DESIRED_COUNT (unset: the count a Deploy saved
# when it stopped the services and could not restore them, else the stack's: 1 while history is collected, 0 once it is), IMPORT_ARCHIVES
# (false), ARCHIVE_SOURCES_BUCKET (where the pinned archive sources are, under data/sources/; the stack's release bucket
# when unset), CFN_ROLE (CloudFormation service role, set by the workflow), IMAGE_TAG (the commit to deploy, git HEAD by
# default: its export is what is deployed; the worker's image has its own name), PITCHAPI_API_KEY or
# PITCHAPI_API_KEY_FILE (needed once, to create /vega/v2/pitchapi-key), LIVE_PROVIDER (empty: the live circuit is
# deployed, the schedule that starts its ingestor is off), MIGRATE_WAIT_ROUNDS (6: rounds of ten minutes a migrate task
# is waited for), MIGRATE_REPLAY_WINDOW (3600 s: how long after its asking a migrate request whose answer is unknown is
# replayed), CLOSE_ROUNDS and CLOSE_PAUSE (240 × 15 s: how long a stack's operation in progress is awaited before the
# first change), DEPLOY_LOCK_DIR (/tmp: where a workstation's run keeps its lock, a directory of this machine's own). The
# Deploy's state: s3://vega-v2-deploy-state-<account>-<region>/state.json, in the roles stack's bucket
# (GH157.3); another run's is taken over only once that run is known dead (infra/aws/README.md, Takeover and first install).
# VI-35: WAF_MODE (Count or Block; unset, the web ACL keeps its mode, Count the first time).
# GH220: SMOKE_TEAM and SMOKE_PLAYER, both or neither (public ids t_… and p_…): the club and the player step 12 follows;
# unset, it follows the home's player of the week and the team of his match (infra/aws/smoke-favourites.mjs).
set -euo pipefail
export AWS_REGION=${AWS_REGION:-us-east-2}
ACCOUNT=361769570630
REGISTRY="$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"
RELEASES="vega-v2-releases-$ACCOUNT-$AWS_REGION"
# The Deploy's state: the one object of a bucket the roles stack creates, before anything a Deploy creates (GH157.3).
STATE_BUCKET="vega-v2-deploy-state-$ACCOUNT-$AWS_REGION"
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
COUNT=${WORKER_DESIRED_COUNT:-keep}
case "$COUNT" in 0|1|keep) ;; *) echo "WORKER_DESIRED_COUNT is 0, 1 or keep" >&2; exit 1 ;; esac
MIGRATE_ROUNDS=${MIGRATE_WAIT_ROUNDS:-6}
case "$MIGRATE_ROUNDS" in [1-9]|[1-9][0-9]) ;; *) echo "MIGRATE_WAIT_ROUNDS is 1 to 99" >&2; exit 1 ;; esac
case "${BACKFILL_DESIRED_COUNT:-}" in ""|0|1) ;; *) echo "BACKFILL_DESIRED_COUNT is 0 or 1" >&2; exit 1 ;; esac
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
output() { aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text 2>/dev/null || true; }
stack() { aws cloudformation deploy ${role[@]+"${role[@]}"} --no-fail-on-empty-changeset --stack-name "$1" --template-file "infra/aws/$2" "${@:3}"; }
run_task() {
  local family=$1 sg task
  shift
  sg=$(output vega-v2-database WorkerSecurityGroup)
  task=$(aws ecs run-task --cluster vega-v2 --task-definition "$family" --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$sg],assignPublicIp=ENABLED}" \
    "$@" --query 'tasks[0].taskArn' --output text)
  echo "$task"
}
ssm_value() { aws ssm get-parameter --name "$1" ${2:+--with-decryption} --query Parameter.Value --output text 2>/dev/null || true; }
# A call whose error matters (GH157): its output in AWS_OUT; failed, the error's code (the CLI's « An error occurred
# (<Code>) ») in AWS_CODE and its message in AWS_ERROR. A refusal is never read as an absence.
call() {
  local err
  err=$(mktemp)
  if AWS_OUT=$(aws "$@" 2>"$err"); then AWS_CODE=; AWS_ERROR=; rm -f "$err"; return 0; fi
  AWS_CODE=$(sed -n 's/.*An error occurred (\([A-Za-z0-9]*\)).*/\1/p' "$err" | head -n 1)
  AWS_ERROR=$(tr '\n' ' ' <"$err" | cut -c1-300)
  rm -f "$err"
  [ -n "$AWS_CODE" ] || AWS_CODE=Unknown
  return 1
}
sha256() { openssl dgst -sha256 -r "$@" | cut -d' ' -f1; }

# --- Account API (VI-38; backend/account/DEPLOYMENT.md, FAILURE_MODES.md section 10) ---
# One switch: SSM /vega/v2/account-deploy (String), on or off, created last by the owner. Absent
# or off, nothing of the account is touched: the Deploy is the one before the account, plus one
# line. On, every prerequisite is checked here, before anything changes; a missing or malformed
# one stops the Deploy naming it (never a Deploy stopped midway by a half-prepared account).
# Values are checked against account.yaml's AllowedPattern and never printed.
ACCOUNT=off
account_on=()
account_preflight() {
  local LC_ALL=C switch status value problems=() p name pattern need secure bytes
  switch=$(ssm_value /vega/v2/account-deploy)
  case "$switch" in
    "") echo "account: off (no SSM parameter /vega/v2/account-deploy): the account API is not deployed (backend/account/DEPLOYMENT.md, section 3)"; return 0 ;;
    off) echo "account: off (/vega/v2/account-deploy is off): the account API is not deployed (backend/account/DEPLOYMENT.md, section 3)"; return 0 ;;
    on) ;;
    *) problems+=("/vega/v2/account-deploy holds neither value allowed: it must be on or off") ;;
  esac
  if [ ${#problems[@]} = 0 ]; then
    [ "$(output vega-v2-deploy-roles AccountGrants)" = 2 ] ||
      problems+=("stack vega-v2-deploy-roles: its output AccountGrants is not 2: the owner updates it from the Mac with infra/aws/deploy-roles.yaml (backend/account/DEPLOYMENT.md, section 3)")
    # name, pattern (account.yaml's AllowedPattern, matched on the whole value), required or optional, String or
    # SecureString, and a length in bytes (min-max) where a pattern would repeat more than 255 times, which macOS's bash
    # 3.2 cannot compile (review of 07 h 09): the Neon key's 16 to 512 printable ASCII bytes but the space, under LC_ALL=C.
    while read -r name pattern need secure bytes; do
      value=$(ssm_value "$name" "$([ "$secure" = SecureString ] && echo decrypt)")
      if [ -z "$value" ]; then
        [ "$need" = optional ] || problems+=("$name: missing (SSM $secure; backend/account/DEPLOYMENT.md, section 3)")
      elif ! [[ $value =~ ^($pattern)$ ]] || { [ -n "$bytes" ] && { [ "${#value}" -lt "${bytes%-*}" ] || [ "${#value}" -gt "${bytes#*-}" ]; }; }; then
        problems+=("$name: malformed (SSM $secure, not of the form infra/aws/account.yaml accepts)")
      fi
    done <<'PREREQUISITES'
/vega/v2/neon-auth-url https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~-]+)*/? required String
/vega/v2/neon-project-id [A-Za-z0-9_-]{1,64} required String
/vega/v2/neon-branch-id [A-Za-z0-9_-]{1,64} required String
/vega/v2/site-origins (https://[a-z0-9.-]+|http://localhost:[0-9]+)(,(https://[a-z0-9.-]+|http://localhost:[0-9]+))* required String
/vega/v2/neon-api-key [[:graph:]]+ optional SecureString 16-512
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

# --- The Deploy's grants and its own state (GH157, GH157.3) -----------------------------------------------------------
# The roles of deploy-roles.yaml are the owner's (the workflow cannot update them): this Deploy needs their grants of
# 26 November 2026 (the state's bucket and object, the edge logs, the alarms and the dashboard).
[ "$(output vega-v2-deploy-roles DeployGrants)" = 1 ] || {
  echo "deploy: stack vega-v2-deploy-roles: its output DeployGrants is not 1: the owner updates it from the Mac with infra/aws/deploy-roles.yaml (infra/aws/README.md, One-time setup); nothing is changed" >&2
  exit 1
}
# Who deploys: a GitHub run (its run and attempt), else a workstation's: host:<this machine>:<its process>:<a token of its
# own, 32 random hex digits>. A workstation's run holds, from here, a lock every command it starts inherits (descriptor 9
# on <DEPLOY_LOCK_DIR, /tmp>/vega-deploy-<token>.lock, infra/aws/run_lock.py): while any process of the run lives, it is
# held (GH157-ad). This machine: its short name and a digest of its machine identity (run_lock.py host, GH157-u); a
# machine without one names no host and a workstation's Deploy stops there (GH157-af).
THIS_HOST=$(python3 infra/aws/run_lock.py host) || THIS_HOST=
LOCK_DIR=${DEPLOY_LOCK_DIR:-/tmp}
OWNER=${GITHUB_RUN_ID:+gh-$GITHUB_RUN_ID-${GITHUB_RUN_ATTEMPT:-1}}
if [ -z "$OWNER" ]; then
  if [ -z "$THIS_HOST" ]; then
    echo "deploy: this machine has no identity of its own (no /etc/machine-id, no IOPlatformUUID, or a placeholder): a workstation's Deploy is named by it, so that another machine of its short name is never taken for this one: deploy from GitHub Actions (the Deploy workflow), or give this machine an identity (on Linux: systemd-machine-id-setup). Nothing is changed." >&2
    exit 1
  fi
  RUN_TOKEN=$(python3 infra/aws/run_lock.py token)
  OWNER="host:$THIS_HOST:$$:$RUN_TOKEN"
  RUN_LOCK="$LOCK_DIR/vega-deploy-$RUN_TOKEN.lock"
  exec 9>>"$RUN_LOCK"
  python3 infra/aws/run_lock.py hold 9 || { echo "deploy: this run's lock $RUN_LOCK could not be taken: nothing is changed" >&2; exit 1; }
fi
STATE=off STATE_ETAG= STATE_PHASE=idle STATE_OWNER= STATE_BEFORE_WORKER= STATE_BEFORE_BACKFILL= STATE_BEFORE_IMAGE= STATE_BEFORE_DIGEST=
STATE_CHANGED=false STATE_UNSAFE=false STATE_TOOK_OVER= STATE_TOOK_OVER_AGE= STATE_HOLDER= STATE_HOLDER_PHASE= STATE_HOLDER_AGE= STATE_ABANDONED=
STATE_MIGRATE_TOKEN= STATE_MIGRATE_PHASE= STATE_MIGRATE_ARN= STATE_MIGRATE_TASKDEF= STATE_MIGRATE_COMMAND= STATE_MIGRATE_SG= STATE_MIGRATE_ASKED= STATE_MIGRATE_SEEN=
TAKEOVER_PROOF= HOLDER_WHY=
# Another run is known dead (FAILURE_MODES_OPTIMISATIONS.md GH157.3), never for its age and never on a word alone: a
# GitHub run once GitHub says its attempt completed (a hosted runner's job is over, its machine gone); a workstation's run
# once its lock is found in this machine's lock directory and free (no process of it lives: the shell and every command it
# started); a run the owner attested dead (deploy_state.py abandon). A lock held: the run lives. A lock absent or
# unreadable here, or a name without a run token (an earlier Deploy's): nothing is proved — another machine's run (of any
# name or identity, a clone), or this one's before a restart or a cleaning of the lock directory — and only the owner's
# attestation lets the next Deploy take it over (GH157-ag). HOLDER_WHY says what would prove it otherwise.
known_dead() {
  local holder=$1 status host lock_state lock attest
  TAKEOVER_PROOF= HOLDER_WHY=
  [ -n "$holder" ] || return 1
  if [ -n "$STATE_ABANDONED" ] && [ "$STATE_ABANDONED" = "$holder" ]; then
    TAKEOVER_PROOF="the owner attested it dead (deploy_state.py abandon)"; return 0
  fi
  if [[ $holder =~ ^gh-([0-9]+)-([0-9]+)$ ]]; then
    if [ -z "${GITHUB_REPOSITORY:-}" ] || ! command -v gh >/dev/null 2>&1; then
      HOLDER_WHY="It is a GitHub run, and this run cannot ask GitHub (gh and GITHUB_REPOSITORY, as the workflow has them): run the Deploy from the workflow once that run has ended."
      return 1
    fi
    status=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/${BASH_REMATCH[1]}/attempts/${BASH_REMATCH[2]}" --jq .status 2>/dev/null) || status=
    if [ "$status" = completed ]; then TAKEOVER_PROOF="its GitHub run is completed: its runner is gone"; return 0; fi
    HOLDER_WHY="Its GitHub run is not known finished (GitHub answered: ${status:-nothing}): once it has ended, the next Deploy takes it over."
    return 1
  fi
  if [[ $holder =~ ^host:([^:]+):[0-9]+:[^:]+$ ]]; then
    host=${BASH_REMATCH[1]}
    read -r lock_state lock < <(python3 infra/aws/run_lock.py state "$holder") || lock_state=unreadable
    attest="once its processes are known gone (that machine off or restarted, or the run's shell and every command it started stopped), the owner attests it: python3 infra/aws/deploy_state.py abandon --bucket $STATE_BUCKET --holder '$holder' --reason '<what was checked>' (infra/aws/README.md); the next Deploy then takes it over"
    case "$lock_state" in
      free) TAKEOVER_PROOF="no process of its run lives (its lock $lock is here and free)"; return 0 ;;
      held) HOLDER_WHY="A process of its run is alive on this machine (its lock $lock is held: its shell, or a command it started such as an aws cloudformation deploy): wait for them or stop them all; the next Deploy then takes it over." ;;
      untokened) HOLDER_WHY="It ran on host $host under an earlier Deploy's name (no run token), which this run cannot check: nothing here proves it dead; $attest." ;;
      absent) HOLDER_WHY="Its lock $lock is not in this machine's lock directory (it ran on host $host: another machine, or this one before a restart or a cleaning of $LOCK_DIR), which this run cannot check: nothing here proves it dead; $attest." ;;
      *) HOLDER_WHY="Its lock $lock cannot be read here ($lock_state), which this run cannot check: nothing here proves it dead; $attest." ;;
    esac
    return 1
  fi
  HOLDER_WHY="Its name is neither a GitHub run's nor a workstation's: the owner settles it (infra/aws/README.md, Takeover and first install)."
  return 1
}
take_state() {
  local out code=0
  out=$(python3 infra/aws/deploy_state.py acquire --bucket "$STATE_BUCKET" --owner "$OWNER") || code=$?
  if [ "$code" = 4 ]; then
    eval "$out"
    if known_dead "$STATE_HOLDER"; then
      code=0
      out=$(python3 infra/aws/deploy_state.py acquire --bucket "$STATE_BUCKET" --owner "$OWNER" --takeover "$STATE_HOLDER") || code=$?
    else
      echo "deploy: another Deploy ($STATE_HOLDER) holds the Deploy state (phase $STATE_HOLDER_PHASE, last seen $STATE_HOLDER_AGE min ago): a run is taken over only once known dead, whatever its age. $HOLDER_WHY Nothing is changed." >&2
      exit 1
    fi
  fi
  case "$code" in
    0) eval "$out"; STATE=on
       [ -n "$STATE_TOOK_OVER" ] && echo "deploy: taking over $STATE_TOOK_OVER ($TAKEOVER_PROOF; phase $STATE_PHASE, last seen $STATE_TOOK_OVER_AGE min ago): its saved counts and intents are kept"
       echo "deploy: the Deploy state is this run's ($OWNER)" ;;
    3) echo "deploy: the bucket $STATE_BUCKET, where the Deploy's state lives, does not exist: the owner updates the stack vega-v2-deploy-roles, which creates it (infra/aws/README.md, One-time setup); nothing is changed" >&2
       exit 1 ;;
    *) exit 1 ;;
  esac
}
# A change of the state: refused, the Deploy stops. Refused because another run wrote it (exit 5), the state is lost
# to this run: it changes nothing more, its exit neither restores nor releases anything (GH157-o, GH157-p).
lost_state() {
  STATE=lost
  echo "deploy: the Deploy state is another run's now: this run stops here and changes nothing more (no restore, no release)" >&2
}
set_state() {
  [ "$STATE" = on ] || return 0
  local out code=0
  out=$(python3 infra/aws/deploy_state.py set --bucket "$STATE_BUCKET" --owner "$OWNER" --etag "$STATE_ETAG" "$@") || code=$?
  [ "$code" = 5 ] && { lost_state; exit 1; }
  [ "$code" = 0 ] || exit 1
  eval "$out"
}
# Before each step that changes the worker, the backfill, the base or a stack: the state written again (still this
# run's).
hold_state() { set_state; }
# The same check where the run must go on whatever it finds (its exit): 1 when the state is not this run's.
still_ours() {
  [ "$STATE" = on ] || return 1
  local out code=0
  out=$(python3 infra/aws/deploy_state.py set --bucket "$STATE_BUCKET" --owner "$OWNER" --etag "$STATE_ETAG") || code=$?
  [ "$code" = 5 ] && { lost_state; return 1; }
  [ "$code" = 0 ] || return 1
  eval "$out"
}
release_state() {
  [ "$STATE" = on ] || return 0
  local out code=0
  out=$(python3 infra/aws/deploy_state.py release --bucket "$STATE_BUCKET" --owner "$OWNER" --etag "$STATE_ETAG" "$@") || code=$?
  [ "$code" = 5 ] && { lost_state; return 1; }
  [ "$code" = 0 ] || return 1
  eval "$out"
  STATE=released
}
# --- What a dead run left (GH157.3), reconciled before the first change, taken over or not -------------------------------
# Each stack's operation in progress is awaited to its end (CloudFormation finishes what was submitted, CLI or no CLI);
# REVIEW_IN_PROGRESS, a stack whose creating change set was never executed, is no operation: deploy makes its own change
# set on it. No change set is deleted: executing one deletes a stack's others, and a manual one is the owner's. Then
# each status is read again, and the migrate task the state names is settled.
STACKS="vega-v2-database:$AWS_REGION vega-v2-worker:$AWS_REGION vega-v2-live:$AWS_REGION vega-v2-api:$AWS_REGION vega-v2-alerts:$AWS_REGION vega-v2-account:$AWS_REGION vega-v2-waf:us-east-1 vega-v2-edge-logs:us-east-1 vega-v2-alerts-edge:us-east-1"
stack_status() {
  if call cloudformation describe-stacks --region "$2" --stack-name "$1" --query 'Stacks[0].StackStatus' --output text; then
    STATUS=$AWS_OUT
  elif [ "$AWS_CODE" = ValidationError ] && [[ $AWS_ERROR == *"does not exist"* ]]; then
    STATUS=
  else
    echo "deploy: the stack $1 could not be read ($AWS_CODE): nothing is changed" >&2; exit 1
  fi
}
reconcile() {
  local pair name region round busy=
  for pair in $STACKS; do
    name=${pair%%:*} region=${pair#*:}
    for round in $(seq 1 "${CLOSE_ROUNDS:-240}"); do
      stack_status "$name" "$region"
      case "$STATUS" in
        REVIEW_IN_PROGRESS) break ;;
        *_IN_PROGRESS)
          [ "$round" = 1 ] && echo "deploy: $name is $STATUS (an operation submitted before this run): its end is awaited before any change"
          sleep "${CLOSE_PAUSE:-15}" ;;
        *) break ;;
      esac
    done
  done
  for pair in $STACKS; do
    name=${pair%%:*} region=${pair#*:}
    stack_status "$name" "$region"
    case "$STATUS" in REVIEW_IN_PROGRESS) ;; *_IN_PROGRESS) busy="$busy $name ($STATUS)" ;; esac
  done
  [ -z "$busy" ] || { echo "deploy: still in progress:$busy: nothing is changed" >&2; exit 1; }
  settle_migrate
}
# --- Migrate tasks (GH157.3): an intent durable before RunTask, an outcome known or the run stopped, never two at once.
MIGRATE_ATTEMPTS=3
# Waits for a task (its ARN, and when that ARN was first answered) until ECS says STOPPED: TASK_STATUS (STOPPED;
# MISSING when ECS no longer knows it; else its last status) and TASK_EXIT (its exit code, None without one); 1 unless
# STOPPED within MIGRATE_ROUNDS rounds of the waiter. ECS keeps a stopped task an hour at least, and a task stops after
# its ARN is answered: MISSING within MIGRATE_RETENTION seconds of that answer is a task not visible yet (DescribeTasks
# lagging behind RunTask, GH157-ae), waited for as a running one; only later is it a task ECS has forgotten.
wait_task() {
  local round failure seen=${2:-0}
  TASK_STATUS= TASK_EXIT=
  for round in $(seq 1 "$MIGRATE_ROUNDS"); do
    aws ecs wait tasks-stopped --cluster vega-v2 --tasks "$1" 2>/dev/null || true
    read -r TASK_STATUS TASK_EXIT failure < <(aws ecs describe-tasks --cluster vega-v2 --tasks "$1" --query '[tasks[0].lastStatus,tasks[0].containers[0].exitCode,failures[0].reason]' --output text 2>/dev/null)
    if [ "$failure" = MISSING ]; then
      if [ $(( $(date +%s) - seen )) -lt "${MIGRATE_RETENTION:-3600}" ]; then
        TASK_STATUS=PENDING
        sleep "${MIGRATE_REPLAY_PAUSE:-5}"
        continue
      fi
      TASK_STATUS=MISSING; return 1
    fi
    [ "$TASK_STATUS" = STOPPED ] && return 0
  done
  return 1
}
# RunTask with the intent's identity (token as startedBy and clientToken, the exact task definition, the command, the
# security group), asked again while its answer is unknown (up to MIGRATE_ATTEMPTS times): ASKED is task (ASKED_ARN),
# refused or unknown (ASKED_REASON: the last answer). A refusal (a failure, or a client error that rejects the request)
# is final for the request it answers, so it ends the tries; it settles the intent (refused) only when it answers the
# intent's very first request (`first`, nothing lost before it). After an answer lost, or for a later run's replay, it
# proves nothing of that first request, which may have started a task (GH157-ae): the intent stays unknown. The CLI
# sends each RunTask once (AWS_MAX_ATTEMPTS=1, that call only): its own retries (three requests in its standard mode)
# would answer only the last, hiding a first one whose answer was lost behind a refusal of the next; this loop retries.
ask_migrate() {
  local token=$1 taskdef=$2 command=$3 sg=$4 first=${5:-false} try overrides=() arn reason refusal lost=false
  [ "$command" = full ] || overrides=(--overrides "{\"containerOverrides\":[{\"name\":\"migrate\",\"command\":[\"$command\"]}]}")
  ASKED=unknown ASKED_ARN= ASKED_REASON=
  for try in $(seq 1 "$MIGRATE_ATTEMPTS"); do
    refusal=
    if AWS_MAX_ATTEMPTS=1 call ecs run-task --cluster vega-v2 --task-definition "$taskdef" --launch-type FARGATE \
        --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$sg],assignPublicIp=ENABLED}" \
        --started-by "$token" --client-token "$token" ${overrides[@]+"${overrides[@]}"} --query '[tasks[0].taskArn,failures[0].reason]' --output text; then
      read -r arn reason <<<"$AWS_OUT"
      if [ -n "$arn" ] && [ "$arn" != None ]; then ASKED=task ASKED_ARN=$arn; return 0; fi
      refusal=${reason:-no task}
    else
      case "$AWS_CODE" in
        InvalidParameterException|ClientException|AccessDeniedException|ClusterNotFoundException|PlatformUnknownException|PlatformTaskDefinitionIncompatibilityException|UnsupportedFeatureException|BlockedException)
          refusal="$AWS_CODE: $AWS_ERROR" ;;
        *) ASKED_REASON="$AWS_CODE: $AWS_ERROR"; lost=true ;;
      esac
    fi
    if [ -n "$refusal" ]; then
      if [ "$first" = true ] && [ "$lost" = false ] && [ "$try" = 1 ]; then ASKED=refused ASKED_REASON=$refusal; return 0; fi
      ASKED_REASON="refused ($refusal), which proves nothing of the first request"
      return 0
    fi
    [ "$try" = "$MIGRATE_ATTEMPTS" ] || sleep "${MIGRATE_REPLAY_PAUSE:-5}"
  done
}
# Any migrate task of the family still running stops before this run's own (a missing cluster: a first install's only).
busy_migrations() {
  local arn
  if ! call ecs list-tasks --cluster vega-v2 --family vega-v2-migrate --desired-status RUNNING --query taskArns --output text; then
    [ "$AWS_CODE" = ClusterNotFoundException ] && [ -z "$WORKER_STACK" ] && return 0
    echo "deploy: the migrate tasks could not be listed ($AWS_CODE): nothing is changed" >&2; exit 1
  fi
  for arn in $AWS_OUT; do
    [ "$arn" = None ] && continue
    echo "deploy: a migrate task runs ($arn): it stops before this run asks for its own"
    wait_task "$arn" "$(date +%s)" || { echo "deploy: it still runs after $MIGRATE_ROUNDS rounds of the waiter: nothing is changed" >&2; exit 1; }
  done
}
# The migrate task the state names (asked by a run that ended, this one's included before a crash), settled before any
# other: by its ARN, waited for until STOPPED; MISSING (stopped beyond ECS's retention) with none running: its outcome
# unknown, this run's own migrations reconcile the base's journal before any service starts. Without ARN: a task running
# under its token is waited for; else the same request is replayed (same token, task definition, command, group), which
# ECS answers with the task it created or creates once, within MIGRATE_REPLAY_WINDOW seconds of its asking; later the
# run stops and names the owner's entry. Never a second migrate task on an empty list.
settle_migrate() {
  local arn=$STATE_MIGRATE_ARN seen=${STATE_MIGRATE_SEEN:-${STATE_MIGRATE_ASKED:-0}} age
  [ -n "$STATE_MIGRATE_TOKEN" ] || return 0
  echo "deploy: the migrate task $STATE_MIGRATE_TOKEN an earlier run asked for (${STATE_MIGRATE_COMMAND:-full}, ${STATE_MIGRATE_TASKDEF:-its task definition}): settled before anything else"
  if [ -z "$arn" ]; then
    if ! call ecs list-tasks --cluster vega-v2 --started-by "$STATE_MIGRATE_TOKEN" --query taskArns --output text; then
      if [ "$AWS_CODE" = ClusterNotFoundException ] && [ -z "$WORKER_STACK" ]; then
        echo "deploy: no cluster yet (a first install): no task ran under it"; set_state migrate=; return 0
      fi
      echo "deploy: the migrate task $STATE_MIGRATE_TOKEN could not be looked up ($AWS_CODE): nothing is changed" >&2; exit 1
    fi
    if [ -n "$AWS_OUT" ] && [ "$AWS_OUT" != None ]; then
      arn=${AWS_OUT%%[[:space:]]*} seen=$(date +%s)
      set_state migrate.arn="$arn" migrate.phase=running migrate.seen="$seen"
    else
      age=$(( $(date +%s) - ${STATE_MIGRATE_ASKED:-0} ))
      if [ "$age" -gt "${MIGRATE_REPLAY_WINDOW:-3600}" ] || [ -z "$STATE_MIGRATE_TASKDEF" ]; then
        echo "deploy: it was asked $(( age / 60 )) min ago and runs under no task now: its outcome is unknown and is not guessed (a replay this late could start it again). Check ECS: the family's stopped tasks (aws ecs list-tasks --cluster vega-v2 --family vega-v2-migrate --desired-status STOPPED; ListTasks takes startedBy only alone), then theirs under that token (aws ecs describe-tasks --cluster vega-v2 --tasks <those ARNs> --query \"tasks[?startedBy=='$STATE_MIGRATE_TOKEN'].[taskArn,lastStatus,containers[0].exitCode]\"), else the migrate log (/ecs/vega-v2-worker) once ECS has forgotten it; then: python3 infra/aws/deploy_state.py resolve-migrate --bucket $STATE_BUCKET --token $STATE_MIGRATE_TOKEN (--arn <its task> | --none) --reason '<what was checked>'. Nothing is changed." >&2
        exit 1
      fi
      echo "deploy: no task listed under it (a list can lag behind a task just started): replayed with the same token ($STATE_MIGRATE_TOKEN) and parameters, which ECS answers with the task it created, or creates once"
      ask_migrate "$STATE_MIGRATE_TOKEN" "$STATE_MIGRATE_TASKDEF" "${STATE_MIGRATE_COMMAND:-full}" "$STATE_MIGRATE_SG"
      if [ "$ASKED" != task ]; then
        echo "deploy: the replay settles nothing ($ASKED_REASON): its intent stays unknown, nothing is changed; the next Deploy settles it again" >&2
        exit 1
      fi
      arn=$ASKED_ARN seen=$(date +%s)
      set_state migrate.arn="$arn" migrate.phase=running migrate.seen="$seen"
    fi
  fi
  if wait_task "$arn" "$seen"; then
    echo "deploy: it stopped (exit $TASK_EXIT)"
  elif [ "$TASK_STATUS" = MISSING ]; then
    busy_migrations
    echo "deploy: ECS no longer knows it (MISSING: stopped beyond its retention) and no migrate task runs: its outcome is unknown; this run's own migrations reconcile the base's journal before any service starts"
  else
    echo "deploy: it still runs after $MIGRATE_ROUNDS rounds of the waiter: nothing is changed; the next Deploy waits for it again" >&2
    exit 1
  fi
  set_state migrate=
}
# The worker stack with its deployed template: only the parameters given change (update-stack takes a template's
# default for a parameter it is not given, so every other one is given with its previous value).
WORKER_KEYS=
previous_template() {
  local params=() key given
  for key in $WORKER_KEYS; do
    given=
    for pair in "$@"; do [ "${pair%%=*}" = "$key" ] && given=${pair#*=}; done
    if [ -n "$given" ]; then params+=("ParameterKey=$key,ParameterValue=$given"); else params+=("ParameterKey=$key,UsePreviousValue=true"); fi
  done
  if call cloudformation update-stack ${role[@]+"${role[@]}"} --stack-name vega-v2-worker --use-previous-template --capabilities CAPABILITY_IAM --parameters "${params[@]}"; then
    aws cloudformation wait stack-update-complete --stack-name vega-v2-worker
  elif [ "$AWS_CODE" = ValidationError ] && [[ $AWS_ERROR == *"No updates are to be performed"* ]]; then
    return 0
  else
    echo "deploy: the worker stack could not be updated ($AWS_CODE): $AWS_ERROR" >&2
    return 1
  fi
}
# Stopped services may be restored at once only when nothing was submitted since they stopped, or when the worker stack,
# with no operation in progress, still holds the image and template they ran (an update rolled back): GH157.3, the
# intent before the stack's change. Never on the CLI's word: an answer can be lost after CloudFormation applied it.
restorable() {
  local image digest
  [ "$STATE_UNSAFE" = false ] && [ -n "$STATE_BEFORE_IMAGE" ] || return 1
  [ "$STATE_CHANGED" = false ] && return 0
  [ -n "$STATE_BEFORE_DIGEST" ] || return 1
  call cloudformation describe-stacks --stack-name vega-v2-worker --query 'Stacks[0].StackStatus' --output text || return 1
  case "$AWS_OUT" in *_IN_PROGRESS) return 1 ;; esac
  call cloudformation describe-stacks --stack-name vega-v2-worker --query "Stacks[0].Parameters[?ParameterKey=='ImageTag'].ParameterValue" --output text || return 1
  image=$AWS_OUT
  call cloudformation describe-stacks --stack-name vega-v2-worker --query "Stacks[0].Parameters[?ParameterKey=='TemplateDigest'].ParameterValue" --output text || return 1
  digest=$AWS_OUT
  [ "$image" = "$STATE_BEFORE_IMAGE" ] && [ "$digest" = "$STATE_BEFORE_DIGEST" ]
}
# On any failure: stopped services whose image and template are confirmed unchanged (restorable) are restored at once to
# their saved counts, after the state is written again (still this run's); otherwise they stay stopped with those counts
# and the next Deploy restores them once its own migrations succeed. Never an image started on a base it may not know.
on_exit() {
  local code=$?
  trap - EXIT
  if [ "$code" != 0 ] && [ "$STATE" = on ]; then
    if [ "$STATE_PHASE" = stopped ] && restorable; then
      if still_ours; then
        echo "deploy: failed with the worker and the backfill stopped, their image and template unchanged on the stack: restoring them (worker $STATE_BEFORE_WORKER, backfill $STATE_BEFORE_BACKFILL, image $STATE_BEFORE_IMAGE)"
        if previous_template DesiredCount="$STATE_BEFORE_WORKER" BackfillDesiredCount="$STATE_BEFORE_BACKFILL"; then
          release_state --done || true
        else
          echo "deploy: they could not be restored: they stay stopped, and the next Deploy restores them (worker $STATE_BEFORE_WORKER, backfill $STATE_BEFORE_BACKFILL)"
          release_state || true
        fi
      fi
    elif [ "$STATE_PHASE" = stopped ]; then
      echo "deploy: the worker and the backfill stay stopped (worker $STATE_BEFORE_WORKER, backfill $STATE_BEFORE_BACKFILL saved): $([ "$STATE_UNSAFE" = true ] && echo "a migration of this candidate may have started" || { [ -z "$STATE_BEFORE_IMAGE" ] && echo "a first install" || echo "the candidate's template or image may be on the stack"; })"'; the next Deploy starts them once its own migrations succeed'
      release_state || true
    else
      release_state --done || true
    fi
  fi
  exit "$code"
}
trap on_exit EXIT
trap 'exit 130' INT TERM HUP
take_state
# The worker stack as it is: absent (a first install), else its parameters; any other answer stops here. A stack in
# REVIEW_IN_PROGRESS was never created (a first install's change set never executed).
WORKER_STACK=
if call cloudformation describe-stacks --stack-name vega-v2-worker --query 'Stacks[0].StackStatus' --output text; then
  WORKER_STACK=$AWS_OUT
  [ "$WORKER_STACK" = REVIEW_IN_PROGRESS ] && { echo "deploy: the stack vega-v2-worker is REVIEW_IN_PROGRESS (never created): a first install"; WORKER_STACK=; }
elif ! { [ "$AWS_CODE" = ValidationError ] && [[ $AWS_ERROR == *"does not exist"* ]]; }; then
  echo "deploy: the stack vega-v2-worker could not be read ($AWS_CODE): nothing is changed" >&2
  exit 1
fi
reconcile
worker_param() {
  call cloudformation describe-stacks --stack-name vega-v2-worker --query "Stacks[0].Parameters[?ParameterKey=='$1'].ParameterValue" --output text ||
    { echo "deploy: the stack vega-v2-worker could not be read ($AWS_CODE): nothing is changed" >&2; exit 1; }
  [ "$AWS_OUT" = None ] && AWS_OUT=
  printf '%s' "$AWS_OUT"
}
CUR_IMAGE= CUR_COUNT=0 CUR_BACKFILL=0 CUR_SECRETS= CUR_DIGEST=
if [ -n "$WORKER_STACK" ]; then
  call cloudformation describe-stacks --stack-name vega-v2-worker --query 'Stacks[0].Parameters[].ParameterKey' --output text ||
    { echo "deploy: the stack vega-v2-worker could not be read ($AWS_CODE): nothing is changed" >&2; exit 1; }
  WORKER_KEYS=$AWS_OUT
  CUR_IMAGE=$(worker_param ImageTag) CUR_COUNT=$(worker_param DesiredCount) CUR_BACKFILL=$(worker_param BackfillDesiredCount)
  CUR_SECRETS=$(worker_param SecretsRevision) CUR_DIGEST=$(worker_param TemplateDigest)
fi
# The repository, and the release bucket beside it, as they are before any change (GH157-d, GH157-s): a first install
# when neither the worker stack nor the repository exists; the bucket missing beside either is not one.
REPO=
if call ecr describe-repositories --repository-names vega-v2-worker --query 'repositories[0].repositoryName' --output text; then
  REPO=present
elif [ "$AWS_CODE" = RepositoryNotFoundException ]; then
  REPO=absent
else
  echo "deploy: the repository vega-v2-worker could not be read ($AWS_CODE): nothing is stopped" >&2
  exit 1
fi
if [ -n "$WORKER_STACK" ] || [ "$REPO" = present ]; then
  if ! call s3api head-bucket --bucket "$RELEASES"; then
    case "$AWS_CODE" in
      404|NoSuchBucket|NotFound)
        echo "deploy: the release bucket $RELEASES does not exist while ${WORKER_STACK:+the stack vega-v2-worker ($WORKER_STACK)}${WORKER_STACK:+$([ "$REPO" = present ] && echo " and ")}$([ "$REPO" = present ] && echo "the repository vega-v2-worker") exist: this is not a first install. The owner restores the bucket (infra/aws/README.md); nothing is changed" >&2 ;;
      *) echo "deploy: the release bucket $RELEASES could not be read ($AWS_CODE): nothing is changed" >&2 ;;
    esac
    exit 1
  fi
fi
# A first install's target (GH157.3): saved as a stop's counts are, before anything is created; a failure afterwards
# leaves it for the next run (keep). Never written over saved counts.
if [ -z "$WORKER_STACK" ] && [ "$REPO" = absent ] && [ "$STATE_PHASE" != stopped ]; then
  target_worker=1; [ "$COUNT" = keep ] || target_worker=$COUNT
  set_state phase=stopped before.worker="$target_worker" before.backfill="${BACKFILL_DESIRED_COUNT:-0}" before.image= before.digest= changed=true unsafe=false
  echo "deploy: a first install: its target (worker $target_worker, backfill ${BACKFILL_DESIRED_COUNT:-0}) saved before anything is created"
fi
# The worker and the backfill keep the counts they have (0 or 1) unless WORKER_DESIRED_COUNT and BACKFILL_DESIRED_COUNT
# say otherwise; services an earlier Deploy stopped and could not restore, or a first install's, get the counts saved
# (GH157-y, GH157-z).
if [ "$COUNT" = keep ]; then
  if [ "$STATE_PHASE" = stopped ] && [ -n "$STATE_BEFORE_WORKER" ]; then COUNT=$STATE_BEFORE_WORKER
  elif [ -n "$WORKER_STACK" ]; then COUNT=${CUR_COUNT:-1}
  else COUNT=1; fi
  case "$COUNT" in 0|1) ;; *) COUNT=1 ;; esac
fi
BACKFILL=${BACKFILL_DESIRED_COUNT:-}
if [ -z "$BACKFILL" ]; then
  if [ "$STATE_PHASE" = stopped ] && [ -n "$STATE_BEFORE_BACKFILL" ]; then BACKFILL=$STATE_BEFORE_BACKFILL
  else BACKFILL=${CUR_BACKFILL:-0}; fi
  case "$BACKFILL" in 0|1) ;; *) BACKFILL=0 ;; esac
fi
# --- end of the Deploy's state ---

echo "== 1. Database vega-football-db-postgres (about 10 minutes the first time)"
# Account=true once the account is on (its store's security group); unset, the stack keeps its value.
database=(); [ "$ACCOUNT" = on ] && database=(--parameter-overrides Account=true)
stack vega-v2-database database.yaml ${database[@]+"${database[@]}"}
echo "== 2. Secrets"
hold_state
VEGA_ACCOUNT=$ACCOUNT bash infra/aws/ci/secrets.sh
# Optional, once: /vega/v2/odds-api-key (The Odds API, bookmakers' odds of the coming matches).
ODDS=$(aws ssm get-parameter --name /vega/v2/odds-api-key --query Parameter.Name --output text 2>/dev/null || true)
# What the services read from SSM, by version only (no value): a rotation gives another revision, which replaces their
# tasks once so that they read it.
SECRETS=
for name in /vega/v2/collect-database-url /vega/v2/calc-database-url /vega/v2/pitchapi-key ${ODDS:+"$ODDS"}; do
  call ssm get-parameter --name "$name" --query '[Parameter.Version,Parameter.LastModifiedDate]' --output text ||
    { echo "deploy: the version of $name could not be read ($AWS_CODE)" >&2; exit 1; }
  SECRETS+="$name $AWS_OUT"$'\n'
done
SECRETS=$(printf '%s' "$SECRETS" | sha256)
DIGEST=$(sha256 infra/aws/worker.yaml)
worker=(ArchiveSourcesBucket="$ARCHIVES" OddsApiKeyParameter="$ODDS" SecretsRevision="$SECRETS" TemplateDigest="$DIGEST" ${account_on[@]+"${account_on[@]}"})

echo "== 3. Worker image (linux/arm64) of commit $TAG"
IMAGE=$(python3 infra/aws/image_identity.py) || { echo "deploy: the worker image's identity could not be computed: nothing is stopped" >&2; exit 1; }
FRESH=false
if [ "$REPO" = absent ] && [ -z "$WORKER_STACK" ]; then
  echo "a first install: the worker stack creates the repository and the buckets, the worker and the backfill at 0"
  hold_state
  stack vega-v2-worker worker.yaml --capabilities CAPABILITY_IAM \
    --parameter-overrides ImageTag="$IMAGE" TaskImageTag="$IMAGE" DesiredCount=0 BackfillDesiredCount=0 "${worker[@]}"
  FRESH=true
elif [ "$REPO" = absent ]; then
  echo "deploy: the repository vega-v2-worker does not exist while the stack vega-v2-worker does: the owner recreates it (infra/aws/README.md); nothing is stopped" >&2
  exit 1
fi
if call ecr describe-images --repository-name vega-v2-worker --image-ids imageTag="$IMAGE" --query 'imageDetails[0].imageDigest' --output text; then
  echo "worker image $IMAGE: in the registry, reused (no build, no push)"
elif [ "$AWS_CODE" = ImageNotFoundException ]; then
  aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
  docker build --platform linux/arm64 -f backend/Dockerfile -t "$REGISTRY/vega-v2-worker:$IMAGE" .
  docker push "$REGISTRY/vega-v2-worker:$IMAGE"
  echo "worker image $IMAGE: built and pushed"
else
  echo "deploy: the image $IMAGE could not be looked up in the repository ($AWS_CODE): nothing is stopped" >&2
  exit 1
fi

echo "== 4. Migrations and logins"
# The migrate task of the image, durable (GH157.3): its intent in the state before RunTask (token, the worker stack's
# exact MigrationTaskDefinition, command, security group, time), its ARN once known, cleared once it is seen stopped.
# MIGRATE_CODE: its exit code (None: none), refused (no task ran), unknown (RunTask's answer never known: the intent
# stays for the next Deploy) or running (still running after the waiter's rounds: kept too).
migrate_task() {
  local command=${1:-full} token taskdef sg seen
  settle_migrate
  busy_migrations
  token="vm-$(date +%s)-$$"
  taskdef=$(output vega-v2-worker MigrationTaskDefinition)
  sg=$(output vega-v2-database WorkerSecurityGroup)
  if [ -z "$taskdef" ] || [ "$taskdef" = None ]; then
    echo "deploy: the worker stack names no MigrationTaskDefinition: no migrate task is asked" >&2
    MIGRATE_CODE=refused; return
  fi
  set_state migrate.token="$token" migrate.phase=asked migrate.taskdef="$taskdef" migrate.command="$command" migrate.sg="$sg" migrate.asked="$(date +%s)"
  ask_migrate "$token" "$taskdef" "$command" "$sg" true
  case "$ASKED" in
    task) seen=$(date +%s); set_state migrate.arn="$ASKED_ARN" migrate.phase=running migrate.seen="$seen" ;;
    refused)
      set_state migrate=
      echo "deploy: RunTask refused the migrate task ($ASKED_REASON): no task runs" >&2
      MIGRATE_CODE=refused; echo "migration task${1:+ $1}: exit $MIGRATE_CODE"; return ;;
    *)
      echo "deploy: RunTask's answer for the migrate task $token is unknown (the last of its tries: $ASKED_REASON): its intent stays in the Deploy state, and the next Deploy settles it (the same request, the same token) before anything" >&2
      MIGRATE_CODE=unknown; echo "migration task${1:+ $1}: exit $MIGRATE_CODE"; return ;;
  esac
  if wait_task "$ASKED_ARN" "$seen"; then
    MIGRATE_CODE=${TASK_EXIT:-None}
    set_state migrate=
  elif [ "$TASK_STATUS" = MISSING ]; then
    MIGRATE_CODE=unknown
    echo "deploy: ECS does not know the migrate task it started ($ASKED_ARN): its intent stays; the next Deploy settles it" >&2
  else
    MIGRATE_CODE=running
    echo "deploy: the migrate task $token ($ASKED_ARN) still runs after $MIGRATE_ROUNDS rounds of the waiter: it stays in the Deploy state, and the next Deploy waits for it before anything" >&2
  fi
  echo "migration task${1:+ $1}: exit $MIGRATE_CODE"
}
STOP=true
if [ "$FRESH" = false ] && [ "$STATE_PHASE" != stopped ] && [ -n "$CUR_DIGEST" ] && [ "$CUR_DIGEST" = "$DIGEST" ]; then
  # The template is the candidate's: the one-off tasks take its image alone (the previous template, every other
  # parameter's previous value: the services' task definitions do not change), and its migrations run while the worker
  # and the backfill collect.
  hold_state
  previous_template TaskImageTag="$IMAGE" ${account_on[@]+"${account_on[@]}"}
  migrate_task --online
  case "$MIGRATE_CODE" in
    0) STOP=false; echo "migrations applied while the worker and the backfill run" ;;
    3) echo "a pending migration is not marked '-- vega:online': the worker and the backfill stop for it" ;;
    4) echo "deploy: the base holds a migration this image does not know (an older commit than the base): nothing is stopped, nothing applied" >&2; exit 1 ;;
    *) echo "deploy: the online migrations failed (exit $MIGRATE_CODE): the worker and the backfill were never stopped; a migration marked online keeps their code working" >&2; exit 1 ;;
  esac
elif [ "$FRESH" = false ] && [ "$STATE_PHASE" = stopped ]; then
  echo "the worker and the backfill were stopped by an earlier Deploy (saved: worker $STATE_BEFORE_WORKER, backfill $STATE_BEFORE_BACKFILL)"
elif [ "$FRESH" = false ]; then
  echo "the worker stack's template is not the candidate's (or not known): the worker and the backfill stop before its migrations"
fi
if [ "$STOP" = true ]; then
  if [ "$FRESH" = false ]; then
    if [ "$STATE_PHASE" != stopped ]; then
      set_state phase=stopped before.worker="${CUR_COUNT:-0}" before.backfill="${CUR_BACKFILL:-0}" before.image="$CUR_IMAGE" before.digest="$CUR_DIGEST" changed=false unsafe=false
      echo "deploy: the counts saved (worker ${CUR_COUNT:-0}, backfill ${CUR_BACKFILL:-0}) before the worker and the backfill stop"
    else
      hold_state
    fi
    previous_template DesiredCount=0 BackfillDesiredCount=0
  fi
  # The intent before the submission (GH157.3): changed before the candidate's template and image reach the stack,
  # unsafe before the full migrate is asked for. Whatever the CLI answers next, the exit restores nothing it cannot
  # confirm unchanged (restorable).
  set_state changed=true
  stack vega-v2-worker worker.yaml --capabilities CAPABILITY_IAM \
    --parameter-overrides ImageTag="$IMAGE" TaskImageTag="$IMAGE" DesiredCount=0 BackfillDesiredCount=0 "${worker[@]}"
  set_state unsafe=true
  migrate_task
  [ "$MIGRATE_CODE" = 0 ] || { echo "deploy: the migrations failed (exit $MIGRATE_CODE)" >&2; exit 1; }
  set_state unsafe=false
fi
echo "== 5. Worker: $COUNT task(s); backfill: $BACKFILL task(s), on image $IMAGE"
hold_state
stack vega-v2-worker worker.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides ImageTag="$IMAGE" TaskImageTag="$IMAGE" DesiredCount="$COUNT" BackfillDesiredCount="$BACKFILL" "${worker[@]}"
set_state phase=running before= changed=false unsafe=false
echo "== 6. Live: store, broadcast, full-state read, ingestor schedule (provider '${LIVE_PROVIDER:-}', $([ -n "${LIVE_PROVIDER:-}" ] && echo on || echo off))"
hold_state
live_zip=$(python3 infra/aws/package_api.py "${RUNNER_TEMP:-$(mktemp -d)}/live-package" live | tail -1)
live_key="releases/v2-live/$(basename "$live_zip")"
aws s3 cp "$live_zip" "s3://$RELEASES/$live_key" >/dev/null
# The browser key is renewed for 360 days on every deploy (AppSync allows 365 at most).
expires=$(( ( $(date +%s) / 3600 ) * 3600 + 360 * 86400 ))
stack vega-v2-live live.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides ImageTag="$IMAGE" ReleaseKey="$live_key" ApiKeyExpires="$expires" LiveProvider="${LIVE_PROVIDER:-}"
echo "== 7. Read API package"
hold_state
npm ci --prefix backend/api >/dev/null
zip=$(python3 infra/aws/package_api.py "${RUNNER_TEMP:-$(mktemp -d)}/api-package" | tail -1)
key="releases/v2-api/$(basename "$zip")"
aws s3 cp "$zip" "s3://$RELEASES/$key" >/dev/null
# BEGIN VI-35 web ACL
# The distribution's per-address limit (waf.yaml). A web ACL of CloudFront scope lives in
# us-east-1 only. Its mode is kept unless WAF_MODE names one; the site's server key
# (/vega/v2/edge-key) takes the site's own reads out of the counts.
echo "== 7b. Web ACL of the distribution (us-east-1, mode ${WAF_MODE:-kept})"
hold_state
edge=$(aws ssm get-parameter --name /vega/v2/edge-key --with-decryption --query Parameter.Value --output text)
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$edge"
waf_mode=(); [ -n "${WAF_MODE:-}" ] && waf_mode=(Mode="$WAF_MODE")
stack vega-v2-waf waf.yaml --region us-east-1 --parameter-overrides SiteKey="$edge" ${waf_mode[@]+"${waf_mode[@]}"}
web_acl=$(aws cloudformation describe-stacks --region us-east-1 --stack-name vega-v2-waf \
  --query "Stacks[0].Outputs[?OutputKey=='WebAclArn'].OutputValue" --output text)
# END VI-35 web ACL
echo "== 8. Read API stack and distribution"
hold_state
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
# GH149: the distribution's access logs (standard logging v2), set up in us-east-1 where CloudFront's delivery lives: each
# record holds the request's family (api.yaml EdgeFamily), its result, times and size, nothing naming a visitor or a path.
echo "== 8b. Access logs of the distribution (us-east-1, vega-v2-api-access, 14 days)"
hold_state
stack vega-v2-edge-logs edge-logs.yaml --region us-east-1 --parameter-overrides DistributionId="$(output vega-v2-api DistributionId)"
if [ "${IMPORT_ARCHIVES:-false}" = true ] && [ -n "$ARCHIVES" ]; then
  echo "== 9. Historical archives (runs for a while; logs /ecs/vega-v2-worker, prefix archives)"
  hold_state
  run_task vega-v2-archives
fi
# --- Alerts (alerts.yaml here, alerts-edge.yaml in us-east-1; README, Alerts) ---
# After the read API stack: the edge stack names its distribution. The addresses are never
# in the repository: SSM /vega/v2/alert-email, set once by the account owner, one address
# or two separated by a comma (two people run the service). Without it the topics have no
# subscription and the deploy goes on.
echo "== 10. Alerts: topic vega-v2-alerts and its alarms (here and in us-east-1)"
hold_state
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
watch_backfill=true; [ "$BACKFILL" = 0 ] && watch_backfill=false
watch_live=false; [ -n "${LIVE_PROVIDER:-}" ] && watch_live=true
stack vega-v2-alerts alerts.yaml --parameter-overrides AlertEmail="$alert_email" AlertEmail2="$alert_email2" WatchWorker="$watch_worker" WatchBackfill="$watch_backfill" WatchLive="$watch_live" \
  ${account_on[@]+"${account_on[@]}"}
stack vega-v2-alerts-edge alerts-edge.yaml --region us-east-1 --parameter-overrides AlertEmail="$alert_email" AlertEmail2="$alert_email2" \
  DistributionId="$(output vega-v2-api DistributionId)" ApiDomain="${media#https://}"
# --- end of alerts ---
# --- Account API (VI-38): last, so that its failure leaves everything else deployed. It imports
# the database's security group (step 1) and its store connects as the login the migrate task set
# (step 5). Secrets reach the stack as NoEcho parameters, as the read API's URL does (step 8).
if [ "$ACCOUNT" = on ]; then
  echo "== 11. Account API: front and store (stack vega-v2-account)"
  hold_state
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
# The deployment as served (FAILURE_MODES_OPTIMISATIONS.md, GH202): the release the distribution serves and /api/health,
# the worker and the backfill on the task definitions just deployed. Each check runs whatever the other answers; a
# failure ends the run without "done" once step 12 has run too. Everything above stays deployed. The home's personal
# read is step 12's alone.
echo "== 11b. The deployment as served: the read API's release, /api/health, the worker and the backfill"
release=${key#releases/v2-api/}; release=${release%.zip}
checks=ok
node infra/aws/verify-deploy.mjs "$media" --release "$release" \
  --services "vega-v2-worker=$COUNT@$(output vega-v2-worker WorkerTaskDefinition),vega-v2-backfill=$BACKFILL@$(output vega-v2-worker BackfillTaskDefinition)" || checks=failed
# The home's personal read, as the site asks it, for a followed club, player and both, through the distribution
# (FAILURE_MODES_OPTIMISATIONS.md, GH220.3): each answer 200, private, naming what it was asked to follow. Last, so that
# a failure leaves everything above deployed; the run then ends here, without "done".
echo "== 12. The home's personal read (a club, a player, both)"
node infra/aws/smoke-favourites.mjs "$media" ${SMOKE_TEAM:+--team "$SMOKE_TEAM"} ${SMOKE_PLAYER:+--player "$SMOKE_PLAYER"}
[ "$checks" = ok ] || { echo "deploy: FAILED the checks of step 11b above: everything is deployed; the run ends without done" >&2; exit 1; }
release_state --done
echo "done"

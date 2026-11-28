# Vega on AWS

Three CloudFormation stacks, one per block of the backend, plus the live stack (`live.yaml`) and the roles of the deployment workflow (`deploy-roles.yaml`) (doc « Vega Sport — schéma v2 », section Backend v2). The deployed resources keep the names they were created with (`vega-v2-…`, `/vega/v2/…`, `V2_…`, the database `vega_v2`): the code no longer uses that name, and renaming a stack, a bucket or a database means replacing it.

| Stack | Template | Contents |
|---|---|---|
| `vega-v2-database` | `database.yaml` | private PostgreSQL 18 (`vega-football-db-postgres`, database `vega_v2`, `db.t4g.medium` since 2026-11-09, gp3 20→100 GB, encrypted, 7-day backups, deletion protection, snapshot on delete), master password managed by Secrets Manager, security groups of the worker and the API |
| `vega-v2-worker` | `worker.yaml` | ECR repository, ECS cluster, the always-on worker service (Fargate ARM 0.5 vCPU / 4 GB since 2026-11-13, one task), the `vega-v2-backfill` service (1 vCPU / 2 GB, one task while history is collected, none after), the on-demand `vega-v2-migrate` task definition, the private bucket of the image copies (`vega-v2-media-…`, written only under `data/sources/v2/images/` by the worker's task role), and the private release bucket (`vega-v2-releases-…`: the function packages, and the pinned archive sources under `data/sources/`) |
| `vega-v2-api` | `api.yaml` | the read API Lambda (Node 24 ARM, `backend/api`), its signed Function URL and its own CloudFront distribution; the distribution also serves the image copies at `data/*` from the media bucket (origin access control, bucket policy limited to this distribution) and `api/ops/*`, the status page's read, uncached |
| `vega-v2-waf` (us-east-1) | `waf.yaml` | the distribution's web ACL: per-address request limits, counting or blocking (VI-35, below) |

Account 361769570630, region us-east-2, AWS CLI profile `statarena`, default VPC `vpc-08e400afa07fc1812` and its three subnets. The subnets route to an internet gateway: the worker gets a public IP for outbound HTTPS (sources, ECR, logs) and no inbound port; no NAT gateway is needed. The database is not publicly accessible: only the worker and API security groups reach it on 5432.

## Database roles

`backend/sql/017_roles.sql` creates three group roles; the migration task creates one login per group:

| Login | Group | Rights |
|---|---|---|
| `vega_owner` (RDS master) | — | owns the schemas; applies migrations |
| `vega_v2_collect` | `vega_collect` | writes `core` and `ops`; no access to `agg`; creates partitions through the owner's functions |
| `vega_v2_calc` | `vega_calc` | reads `core`, writes `agg`, `ops.dirty_scopes`, `ops.resource_versions` |
| `vega_v2_read` | `vega_read` | reads the `api` schema only (the API also sets `role=vega_read` on each connection) |

## Deployment

`deploy.sh` is the whole deployment: the same script runs from the **Deploy** workflow (`.github/workflows/deploy.yml`, manual, role `vega-v2-deploy`) and from a workstation. Every step only creates or changes `vega-v2-*` resources and the base `vega-football-db-postgres`. It deploys the commit it is given (`IMAGE_TAG`, by default `HEAD`) from a clean export of that commit: uncommitted changes in the checkout are not deployed, and editing the checkout while it runs changes nothing:

0. the account API's preflight (VI-38): without SSM `/vega/v2/account-deploy` set to `on`, one line and nothing of the account below; with it, every prerequisite is checked before anything changes, the account steps run (`Account=true` on the database, worker and alerts stacks, the account secrets at step 2, `backend/account/sql` and the login at step 4) and the stack `vega-v2-account` comes last, after the alerts (`backend/account/DEPLOYMENT.md`); then the roles' grants (`DeployGrants` of `vega-v2-deploy-roles`, below) and the Deploy's own state (`s3://vega-v2-deploy-state-<account>-us-east-2/state.json`, the roles stack's bucket, `deploy_state.py`: the run that deploys, the counts it saved when it stopped the services or a first install's target, the migrate task it asked for; another run's state stops this one before anything changes, whatever its age, unless that run is known dead: below, Takeover and first install), then each stack's operation in progress awaited and that migrate task settled;
0b. PannaData's login (GH278, `backend/panna/README.md`): without SSM `/vega/v2/panna-deploy`, one line and nothing of it below; set to `off`, `Panna=false` on the worker and alerts stacks (the migrate task no longer gets the login's password, so a rollback stays done; the secrets stay in SSM); set to `on`, `ci/secrets.sh` creates `/vega/v2/password-panna` and `/vega/v2/panna-database-url` at step 2, the migrate task gets `V2_PANNA_PASSWORD` (`Panna=true` on the worker stack) and so applies `backend/panna/sql` and sets the login `vega_v2_panna` (4 connections) at step 4, and the connections alarm counts them (`Panna=true` on the alerts stack). Nothing of the loader is deployed: it runs outside AWS. Another value than `on` or `off` stops the Deploy before anything changes;
1. database stack (about 10 minutes the first time);
2. secrets, created once in SSM SecureStrings (`ci/secrets.sh`): three random login passwords, the status page's key, the PitchAPI key, and the connection URLs built from the database endpoint. Values go through mode-0600 files, never the command line or the log;
3. the worker image, before anything stops (FAILURE_MODES_OPTIMISATIONS.md, GH157/GH158): its tag is its identity (`image_identity.py`: the platform, the Dockerfile, its `.dockerignore` and every file of the build context as BuildKit exports it), not the commit; reused when the registry holds it (no build, no push), built and pushed when it answers `ImageNotFoundException`; any other answer stops the Deploy with nothing stopped. A first install creates the worker stack with both services at 0 first (the repository and the buckets);
4. migrations and logins, the candidate image's `vega-v2-migrate` task: when the worker stack's template is the candidate's (`TemplateDigest`), the tasks take the candidate's image alone (`TaskImageTag`, the previous template: the services untouched) and `python -m vega.migrate --online` applies every pending migration marked `-- vega:online` while the worker and the backfill collect; a pending unmarked one (exit 3), another template, or services an earlier Deploy left stopped: the counts are saved, both services stopped by the previous template, the candidate's template and image applied at 0, then the full migrate. A base holding a migration the image does not know (an older commit) stops the Deploy with nothing changed (exit 4). On a failure, services stopped whose template and image had not changed are restored at once; after a migration started, they stay stopped and the next Deploy restores the saved counts once its migrations succeed;
5. the worker (`WORKER_DESIRED_COUNT` 0 or 1; `keep`, the workflow's default, or unset: the count a Deploy saved when it stopped it, else the stack's, else 1 on a first install) and the backfill on the image, its secrets' revision (`SecretsRevision`, the versions of the SSM parameters they read: a rotation replaces their tasks once) and its template, one update: no replacement when nothing of them changed;
6. live stack (`live.yaml`, the worker's image for the ingestor): the live tables, the AppSync Events API and its browser key (renewed for 360 days on each deploy), the `GET /live/matches/{id}` function and the EventBridge schedule that starts the ingestor every 15 minutes (`--until-idle`: it exits at once without a match within 30 minutes, follows the day's matches to the last otherwise, and a second start finds the lease taken), off unless `LIVE_PROVIDER` names an adapter;
7. read API package, uploaded under `releases/v2-api/` of the release bucket;
8. read API stack; on the first deployment a second pass sets `MediaBaseUrl` once the distribution's domain is known; 8b. the distribution's access logs (us-east-1, GH149);
9. with `IMPORT_ARCHIVES=true`, the historical archive import (`vega-v2-archives`), which reads the pinned sources under `data/sources/` of the release bucket (`openfootball/`, `engsoccerdata/`, `worldclub/`; another bucket with `ARCHIVE_SOURCES_BUCKET`), read only: whole seasons up to 2020/2021, then only the competitions PitchAPI has no edition of that season. A re-import writes only what differs.

### One-time setup (commands to run, each changes AWS or GitHub)

```sh
aws login --profile statarena
```

```sh
aws cloudformation deploy --profile statarena --region us-east-2 --stack-name vega-v2-deploy-roles --template-file infra/aws/deploy-roles.yaml --capabilities CAPABILITY_NAMED_IAM
```

First, before any Deploy: the roles, and the bucket of the Deploy's state (`vega-v2-deploy-state-<account>-us-east-2`, Takeover and first install below). Nothing else of the setup needs a Deploy first: the commands below run on a fresh account as on a deployed one.

The database size of the doc (« Volume » : 4 GB once measured; on 2026-11-09 the 1 GB instance ran out of memory twice with the archives and the backfill), set once by the account owner, then kept by every deploy:

```bash
aws cloudformation deploy --profile statarena --region us-east-2 --stack-name vega-v2-database --template-file infra/aws/database.yaml --parameter-overrides InstanceClass=db.t4g.medium --no-fail-on-empty-changeset
```

```sh
gh api -X PUT repos/VegaInteligence/Vega-Sport/environments/v2-production
```

`deploy-roles.yaml` creates `vega-v2-deploy` (assumable only by the **Deploy** workflow of this repository, in the `v2-production` environment, through the existing GitHub OIDC provider) and `vega-v2-cloudformation` (the service role CloudFormation uses, limited to the `vega-v2-*` resources). Both trusts name the workflow: after renaming a workflow, deploy this stack again before the workflow runs.

It also creates `vega-v2-pilot`, assumable only by the **Isolated pilot** workflow run from `main` (`refs/heads/main`), which reads `/vega/v2/pitchapi-pilot-key` and nothing else (FAILURE_MODES_OPTIMISATIONS.md, GH194). That parameter is the pilot's own PitchAPI key, with its own quota if the provider's plan gives one, never a copy of the worker's `/vega/v2/pitchapi-key`; without it the pilot stops before any provider call. The owner creates it once and deploys this stack (the Deploy workflow cannot), from the Mac:

```sh
aws ssm put-parameter --profile statarena --region us-east-2 --name /vega/v2/pitchapi-pilot-key --type SecureString --value file://<file holding the pilot key>
```

Delete that file once the parameter is written. Until this stack is deployed, the role in AWS keeps its trust of every `claude/v2-*` branch and its read of the worker's key, though no workflow of this repository asks for it any more.

A stack the workflow has changed once keeps `vega-v2-cloudformation` as its role: later changes use it from a workstation too, where the script passes no role. A template change that needs a permission the role lacks therefore stops both paths, and its rollback fails the same way (the live stack on 10 November 2026: the role could not renew the browser key). Add the permission to `deploy-roles.yaml` and deploy that stack first; `aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::361769570630:role/vega-v2-cloudformation --action-names … --resource-arns …` tells beforehand (an action that takes no resource answers only when asked with `*`). A stack left in `UPDATE_ROLLBACK_FAILED` is recovered, once the role is right, with `aws cloudformation continue-update-rollback --stack-name <stack>`.

A run is checked on what it deployed, not on its colour: its log ends with `done`, and `aws lambda get-function-configuration --function-name vega-v2-api --query LastModified` gives the time of the run. Its last step (12) reads the home's personal read for a followed club, a followed player and both, through the distribution (`infra/aws/smoke-favourites.mjs`, FAILURE_MODES_OPTIMISATIONS.md, GH220.3): whom it follows (the home's player of the week and the team of his match, else the top of its leaders and his club, else the same in the season before; `SMOKE_TEAM=t_… SMOKE_PLAYER=p_…` to name them), then one line per read, each 200, private, the club and the player found where the read puts them. The manifest or the home unavailable, malformed or unreachable, an answer missing what was followed, or seasons without a player to follow: the run ends there, everything above deployed, without `done`. The only `skipped`: a base that holds no season yet, as `/api/health` confirms (503 `pending`).

#### Spend alerts (`budget.yaml`, stack `vega-v2-budget`)

The owner deploys it once with his own credentials (the workflow's roles have no billing permission, and `deploy.sh` never touches it): a monthly cost budget of $120 (the estimate below is $76–81) that mails at 50, 80 and 100 % of the actual spend and when the forecast passes 100 %, and Cost Anomaly Detection that mails once a day an anomaly of $10 or more. Budgets without actions and anomaly detection are free. The address is a parameter, never in the repository. The account allows one services anomaly monitor, and Cost Explorer may have created one already: list it first, and pass its ARN if there is one.

```sh
aws ce get-anomaly-monitors --profile statarena --query "AnomalyMonitors[?MonitorDimension=='SERVICE'].MonitorArn" --output text
```

```sh
aws cloudformation deploy --profile statarena --region us-east-2 --stack-name vega-v2-budget --template-file infra/aws/budget.yaml --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset --parameter-overrides AlertEmail=<address> AlertEmail2=<second address, empty if none> Revision=<number, see below> ExistingServiceMonitorArn=<ARN printed above, empty if none>
```

Changing who receives the mails: a budget's notifications cannot be edited in place, and CloudFormation cannot replace a budget that keeps its name, so the name ends with a number (`vega-v2-monthly-<Revision>`). Run the command again with the new addresses and raise `Revision` by one (the template's default is 2; the budget created on 23 November 2026 is `vega-v2-monthly`, without a number): the budget is created again under the new name and the old one is deleted. Nothing is lost: the spend is read from the account. Without a new `Revision` the update fails and rolls back, and the recipients stay as they were.

Optional, off by default: `LiveSchedulerRoleName=<the live stack's SchedulerRole>` (`aws cloudformation describe-stack-resource --stack-name vega-v2-live --logical-resource-id SchedulerRole --query StackResourceDetail.PhysicalResourceId`) makes the budget deny, at 100 %, the start of new live ingestor tasks; nothing that serves the site stops. Reverse it with `aws budgets execute-budget-action --execution-type REVERSE_BUDGET_ACTION`. `AlertTopicArn=<vega-v2-alerts>` also sends the budget mails to that topic, once its policy lets `budgets.amazonaws.com` publish.

### Deploy

From a workstation:

```sh
AWS_PROFILE=statarena PITCHAPI_API_KEY_FILE=<file holding the key> bash infra/aws/deploy.sh
```

Then, from GitHub: `gh workflow run "Deploy"` (`-f worker_desired_count=1` or `=0` sets the worker; the default, `keep`, keeps its count). The migration task's log line `migrations applied=N total=M logins=…` shows 63 migrations (65 with `V2_VECTOR=1`). The backfill is a second service, `vega-v2-backfill`, of one task or none: `BACKFILL_DESIRED_COUNT=1 bash infra/aws/deploy.sh` turns it on, `=0` turns it off, and a deploy without the variable keeps what it has. ECS starts its task again whenever it stops, on the image of the last deploy. It waits when its lane is empty and does not stop by itself: set it to 0 once `ops.collection_progress` shows history collected.

A database restart (memory recovery, resize) does not stop a task: every connection sees a lost database within a minute (`store.CONNECTION`), and the worker and the backfill reconnect by themselves (`database lost error=… retry_in=N` in the log) for up to 30 minutes. After that the task exits with an error and ECS starts it again, the worker's and the backfill's alike.

A deploy stops the worker and the backfill only for a migration that is not marked `-- vega:online`, a worker template that changed, or services an earlier Deploy left stopped: neither runs code older than a migration that needs them stopped. A migration is marked when the code of the previous Deploy keeps working while and after it applies (additive only: new tables, views or functions, or ones redefined with the same columns); unmarked is the safe default. (Until 10 November 2026 the backfill was a task run by hand, which kept the image it was started with and had to be stopped before a deploy and run again after it.)

The worker image keeps what its build resolved by itself (Debian's `nodejs`, pip's unpinned dependencies of `boto3`) until one of its inputs changes. To take newer ones, change `ARG VEGA_DEPS_REFRESH` in `backend/Dockerfile` (or its base image's digest): the next Deploy builds a new image and replaces the worker's and the backfill's tasks once. apt's and pip's layers read that argument, so a builder that holds them in its cache runs them again; a comment would not (a comment is in no layer's cache key).

At the end (step 11b, `verify-deploy.mjs`, GH202), before step 12: the release the distribution serves through `/api/health` (its `release`, the package's SHA-256, at most 24 tries 5 s apart), the worker and the backfill on the task definitions just deployed (desired, running, one deployment, `COMPLETED`; 30 tries 10 s apart). It asks nothing else: the home's personal read is step 12's probe's alone (`smoke-favourites.mjs`). A failure ends the run without `done` once step 12 has run.

Step 11c (`smoke-public-reads.mjs`, GH257) checks the same release directly on the read function. A synchronous
Invoke sends a Function URL GET event without a validator. It checks health, the 2026/2027 substitutions of Lille and
Brentford, and the Lille profile. The workflow logs the status, body size, wall time, handler time, SQL time and
query count. The three dataset reads each need a 200 with the requested club's data, SQL time at most 3 s, and
handler time at most 5 s. Invoke is limited to 15 s and one attempt per request. There is no cache invalidation.
A fresh installation that creates the database can skip the dataset reads when the origin confirms release, pending
health and publication 0. The distribution's release and readiness checks and the favourites probe still run.

If this installation uses another dataset, set both repository variables `V2_PUBLIC_SMOKE_SEASON` (a season such as
`2026/2027`) and `V2_PUBLIC_SMOKE_TEAMS` (two distinct team IDs separated by a comma). Choose clubs whose season shows a
nonempty decisive-substitute list. These variables are `SMOKE_PUBLIC_SEASON` and `SMOKE_PUBLIC_TEAMS` in a workstation's
shell. A missing case in a populated database fails visibly, so the workflow cannot pass on an empty body or a 404.
To run only the probe from that shell, with the Deploy role's scoped access or the owner's:

```sh
node infra/aws/smoke-public-reads.mjs --release <the deployed release sha256>
```

CI exercises more public readers through the real handler and the disposable PostgreSQL database. The
`public-reads-evidence` artifact holds the scenario outcomes, captured SQL and actual plans before and after adding
unrelated populations, and the paths, status codes and timings exercised by the shared contract tests. The origin
probes cover a small sample after release. A direct Invoke does not flush PostgreSQL buffers.

### Takeover and first install (FAILURE_MODES_OPTIMISATIONS.md GH157.3)

One run deploys at a time: the one holding `s3://vega-v2-deploy-state-<account>-us-east-2/state.json`, the one object of a private, versioned bucket the roles stack creates (One-time setup), so that a first install takes the same lock as any Deploy, before anything is created. Another run's state is never taken over for its age (a suspended workstation, a stalled job wake up), nor on a word alone: a Deploy takes it over when GitHub says that run's attempt `completed` (the workflow's token, `actions: read`; a hosted runner's machine is gone with its job), or, for a workstation's run (`host:<host>:<pid>:<token>`, the host being its short name and a digest of its machine identity, `python3 infra/aws/run_lock.py host`; a machine without one, or with a placeholder, deploys from GitHub Actions only), once its lock is found in this machine's lock directory and free: the run holds from its start a lock that every command it starts inherits (`/tmp/vega-deploy-<token>.lock`, `DEPLOY_LOCK_DIR`, `infra/aws/run_lock.py`; the empty file stays once the run ends), so a shell killed alone while its `aws cloudformation deploy` goes on (its change set created, then executed) still holds it. A lock not found there — the run of another machine (of any name, a clone), this machine's before a restart or a cleaning of /tmp — or a name without a token proves nothing: the owner attests the run dead once its processes are known gone (the machine off or restarted; or the run's shell and every command it started, `aws` among them, stopped), then runs the Deploy:

```sh
python3 infra/aws/deploy_state.py abandon --bucket vega-v2-deploy-state-361769570630-us-east-2 --holder '<the name the Deploy printed>' --reason '<what was checked>'
```

(with the owner's credentials, `AWS_PROFILE=statarena`). It is refused for a GitHub run and for a run whose lock is in the lock directory of the machine it runs on (held: the run lives; free: the Deploy takes it over itself), and a Deploy never takes an attested run over while its lock is held where that Deploy runs. Before its first change, a run awaits each stack's operation in progress (`REVIEW_IN_PROGRESS`, a creating change set never executed, is none), deletes no change set, and settles the migrate task its state names.

A migrate task is in the state before it is asked for (its token as `startedBy` and `clientToken`, the worker stack's exact `MigrationTaskDefinition`, the command, the security group) and until ECS says it stopped (up to six rounds of ten minutes, `MIGRATE_WAIT_ROUNDS`). A refusal of its very first request (`failures`, a rejected request) clears it. An answer never received leaves it, and so does a refusal after one (or of a later run's replay, an IAM refusal included): it proves nothing of the first request, which may have started a task. The next Deploy replays the same request (ECS returns the task it created, or creates it once) within an hour of its asking (`MIGRATE_REPLAY_WINDOW`). `DescribeTasks` answering `MISSING` within an hour of the task's ARN is a task not visible yet, awaited like a running one; later it is one ECS has forgotten (it keeps a stopped task an hour at least): with no migrate task running, its outcome is unknown and the run's own migrations reconcile the base's journal before any service starts. Past the window with no task listed under its token, nothing is guessed: the Deploy stops and names the owner's entry, once ECS is checked. ListTasks takes `startedBy` only as its sole filter (and lists running tasks then): the family's stopped tasks, then those of them under that token, else the task's log (`/ecs/vega-v2-worker`, stream `migrate/migrate/<task id>`, 30 days) once ECS has forgotten it:

```sh
aws ecs list-tasks --cluster vega-v2 --family vega-v2-migrate --desired-status STOPPED --query taskArns --output text
aws ecs describe-tasks --cluster vega-v2 --tasks <those ARNs, 100 at most> --query "tasks[?startedBy=='<token>'].[taskArn,lastStatus,containers[0].exitCode]" --output text
python3 infra/aws/deploy_state.py resolve-migrate --bucket vega-v2-deploy-state-361769570630-us-east-2 --token <token> --none --reason '<what was checked>'   # or --arn <its task>
```

Never two migrate tasks at once, never a service started on an unknown outcome: services stopped for a migration start once the run's own migrations succeed, and on a failure they are restored only when the worker stack, nothing in progress on it, still holds the image and template they ran.

A first install is one where the worker stack and the repository are both missing; the release bucket missing beside either stops the Deploy, nothing changed (the owner restores it). Its target counts (worker 1, or `WORKER_DESIRED_COUNT`; backfill 0, or `BACKFILL_DESIRED_COUNT`) are saved in the state before anything is created: a first install that fails later is finished by the next Deploy with them. Prerequisites, the owner's: the stack `vega-v2-deploy-roles` (its grants and the state's bucket), GitHub's OIDC provider, the PitchAPI key; the Deploy creates the rest. The stacks take the commands of this README as they did (the base's first sizing, the web ACL's keys and mode, the read API's web ACL detached in an emergency): no parameter of the Deploy's is asked of them.

### The Deploy's grants (owner, once, before the next Deploy)

The batch of 26 November 2026 needs new grants and a bucket: the roles stack creates `vega-v2-deploy-state-<account>-<region>` (the Deploy's state); the deploy role reads and writes its `state.json` alone, deploys `vega-v2-edge-logs` (us-east-1), asks whether the repository and the release bucket exist (`ecr:DescribeRepositories`, `s3:ListBucket` on that bucket) and lists the cluster's tasks; the CloudFormation role creates the edge logs' delivery and saved queries (us-east-1), the RDS log group, the dashboard, the Contributor Insights rule and the EventBridge rules of the alarms as their handlers do (their tags, the rules' targets), and may do to the two buckets what AWS's handlers do (the managed policy `vega-v2-cloudformation-buckets`). `backend/tests/test_deploy_grants.py` checks each call of the Deploy against the deploy role, and the buckets' grants against AWS's handler schemas (not against AWS itself). GH257 adds only `lambda:InvokeFunction` on the unqualified ARN of `vega-v2-api` to the Deploy role. The owner applies
`infra/aws/deploy-roles.yaml` using the One-time setup command before the next Deploy. The workflow's preflight
requires `DeployGrants` to read `2` before making changes.

The worker collects whatever fails around the collection: the planner, the calculator, the image copies and the daily pass log their error and the loop goes on (`planner error=…`, `calculator error=…`, `media error=…`, `daily step=<step> error=… retry_at=…`). A step of the daily pass that failed (`analyze`, `archives`, `due`, `sources`, `elo`, `season <id>`) is tried again an hour later, not at the next round. An error of ours shows as `WORKER_<CLASS>@<file>:<line>`, a database error as `DATABASE_<sqlstate>`.

The deployed worker runs its side work in a child process (`--side-work process`): the daily pass (statistics of the partitioned tables, archive counts, sources, the Elo of every match, each due season's models) and the image copies. The collection never waits for it, and a child that ends, whatever ends it, is started again an hour later: `side process started pid=…`, `side process exit=<code> restart_in=3600` (a negative code is the signal that killed it; `-9` with the task at its memory limit is the kernel, which kills the child first: it logs `side work oom_victim=True` when it starts). The player ranking holds a season's appearances in memory: the worker task has 2 GB for it, the most a quarter vCPU takes. A season that does not fit shows as a child killed at each hourly attempt, with the collection untouched. Without the option (`--side-work inline`, the default: tests, the pilot, a local run) the side work runs in the loop, and no job is taken while a daily pass runs.

The backfill's planner keeps its lane short: each minute it adds at most 2,000 jobs (the most recent finished matches that lack a family), and none while the lane still holds 2,000 pending ones (`planner.plan_backfill`). The lane's size says nothing about what is left: `ops.collection_progress` does (expected, done, empty and failed per edition and family). Until 10 November 2026 the planner added 2,000 jobs a minute whatever the lane held: 949,000 jobs were queued, each claim sorted them all (0.4 s before every request) and each planning round read every match (up to 35 s a minute), so the task fetched about 1,200 jobs an hour instead of the 7,200 its pace allows. Migration 054 gives the claim an index in its own order (`fetch_jobs_claim`).

The worker and the backfill share the provider key and its pace (one call every 0.5 s). After a 429 a task keeps at least 1 s between its calls, then returns to 0.5 s once ten minutes have passed without another 429 (`pitchapi.RECOVER_AFTER`): the backfill runs at about half its pace while the worker collects a large batch (the player profiles after a new season's calendars), and at its full pace the rest of the time.

### The read API's connections

Three numbers go together, and `backend/tests/test_api_capacity.py` fails when they part:

- the function runs at most 32 copies at once (`ReservedConcurrency` in `api.yaml`, passed by `deploy.sh` as `API_COPIES`); a request beyond them is refused by Lambda (429) and the site asks again;
- each copy keeps one connection (`api-index.mjs`, pool size 1), and asks the base to close its session after two minutes idle (`idle_session_timeout`): a copy that sleeps is frozen, so the pool's own idle limit never runs;
- the login `vega_v2_read` allows 68 connections (`vega/migrate.py`): two generations of copies, since a deploy leaves the old ones beside the new ones for those two minutes, plus four.

To let more copies run, change the three together, in that order of deploy steps (the migrations set the login before the API stack changes). The instance (db.t4g.medium) gives about 400 connections; its two processors are what the copies share. If the function is throttled (`Throttles` of `vega-v2-api` in CloudWatch) while the base's processors are idle, raise the numbers; if the base is the limit, the answer is fewer calls (longer cache) or RDS Proxy, not more copies.

Until 20 November 2026 the login allowed 12 connections and the function had no limit of its own: the account ran at most 10 functions when that was written, then 1000. At 19 copies the base refused the thirteenth connection (`read failed 53300 <path>` in the function's log, a 503 `DATA_UNAVAILABLE` on every route, VI-33).

When the function fails or cannot be reached, the distribution answers with the copy it holds for up to a day (`stale-if-error=86400`, set by `transport.mjs` on every public answer that does not say otherwise), within the cache policy's `MaxTTL` (until GH145 the 60 s ceiling cut it; a live match's policy still leaves no time past its 2 s, see below). `/api/health` and `/api/ops/*` are never kept: they say what the function says now.

The distribution keeps an answer fresh as long as it says (`s-maxage`; FAILURE_MODES_OPTIMISATIONS.md, GH145): the cache policy `vega-v2-api` cuts nothing the read API says (`MaxTTL: 31536000`, `DefaultTTL: 0`: an answer without freshness is not kept); `/api/league-history` keeps its own behaviour and policy (`vega-v2-api-league-history`, `MaxTTL: 3600`; GH137); `/live/config` has its own behaviour and policy (`vega-v2-live-config`, `MaxTTL: 60`); a live match keeps `vega-v2-live` (`MaxTTL: 2`). Errors and `no-store` answers are kept by no cache. A personal answer (`private, max-age=0, must-revalidate`) is kept by no shared cache, the distribution included; the visitor's own browser may store it but asks again before each reuse. Until GH145 every API answer was cut to 60 s and `/live/config` to 2 s.

Past its freshness an answer may still be served from the expired copy (AWS's documentation of expiration, "Serving stale (expired) content"; not observed here), within the policy's `MaxTTL`: the home reads for up to 300 s while the distribution asks the function again (`stale-while-revalidate=300`), and any public API answer for up to a day when the function answers 500–599 or cannot be reached (`stale-if-error=86400`, added by `transport.mjs`). Until GH145 the 60 s ceiling cut both windows. A live match state says `s-maxage=2, stale-if-error=86400`, and its policy's `MaxTTL: 2` still leaves no time past those 2 s: a failing live function shows as an error within seconds, never as a score a minute old. That is why `/live/config` has a policy of its own instead of a higher ceiling on `live/*`.

What a point of presence may hold after a correction or a release: the copy made before it, fresh until its `s-maxage` ends (60 s for most reads; 300 s for the profiles and similarities, the nations, the player form and Europe; 3600 s for `/api/status`, the World Cup archive, the archives' details and `/api/league-history`; a day for an `/api/assets` redirection), then expired within the windows above. An invalidation of the route's paths removes the distribution's copies sooner (the owner, from the Mac; here an archived season):

```sh
aws cloudfront create-invalidation --profile statarena --paths '/api/league-history*' --distribution-id "$(aws cloudformation describe-stacks --profile statarena --region us-east-2 --stack-name vega-v2-api --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)"
```

An invalidation never reaches a browser's own copy. Most answers say `max-age=0` (the browser asks again, through the distribution), but `/api/status` says `max-age=3600` and an `/api/assets` redirection `max-age=86400`: browsers keep those whatever the distribution holds (as before GH145, which changes the distribution only). A change they must show sooner needs another address (a path, or a query parameter the site sends). When a kept copy is revalidated, a 304 depends on the route's validator: one that hashes the built body (`catalog-v1`, `support-v1`, `profile-v1`, `nations-v1`, `player-form-v1`, `worldcup-v1`, `archive-details-v1`, `match-display-`, `match-lineups-`) confirms only the same bytes; `/api/league-history`'s names the release; one made of a data version alone (`core-v3`, `compact-v2`, `versioned-`, `archive-v2`, `search-v2`, `match-v1`, `players-profile-`) can confirm a body of a former shape after a release, unless the release changes the version string it hashes (as `manifestShape` does) or the paths are invalidated.

The function answers the revalidations of `/api/league-history` with the digest of its four reads, in one statement, without building the answer. The share of requests the distribution answers by itself is measured on its access logs (GH149, `edge-cache-report.mjs`), not set by these ceilings.

The function logs one JSON record per request it receives. `path` omits query parameters. Only requests that reach the
function appear here. `connect` marks any successful connection opening. `reconnect` marks an opening after the pool's first.
`dbOpens` and `dbReopens` count individual openings, including those on retries. The `db` duration includes connection
setup, waiting and query execution. Run these queries in CloudWatch Logs Insights on `/aws/lambda/vega-v2-api`.

```
filter request = "read" | stats count(*) as calls, sum(conditional) as revalidations, avg(ms), avg(db) by path | sort calls desc
```

Use the same origin logs to choose further cold-read scenarios from actual traffic. This groups 5xx responses and
unconditional reads beyond the SQL budget by their existing route family (GH204).

```
filter request = "read"
| stats count(*) as calls, sum(if(status >= 500 and status < 600, 1, 0)) as errors,
    sum(if(conditional = false and db > 3000, 1, 0)) as over_sql_budget, pct(db, 95) as p95_sql_ms by route
| sort errors desc, over_sql_budget desc
```

After deploying GH140, run the following query over a busy and a quiet period. For each route, divide the number of
successful requests with `reconnect=true` by all successful requests that ran SQL. A failed parallel read can log its
response while a sibling is still waiting for a connection, so the query uses completed 2xx and 3xx responses.

```
filter request = "read" and ispresent(connect) and queries > 0 and status >= 200 and status < 400
| stats count(*) as requests, sum(dbOpens) as opens, sum(dbReopens) as reopens by route, connect, reconnect
| sort route asc
```

<!-- BEGIN VI-35 web ACL -->
### Countries refused

hugo's decision of 25 November 2026: North Korea (`KP`) only, for now. The distribution refuses it with a 403 (`Restrictions.GeoRestriction` in `api.yaml`, free, no web ACL rule; test `backend/tests/test_api_geo_block.py`). The site on Vercel has the same rule in the project's firewall (custom rule « Pays refusés », `geo_country` equals `KP`, action deny), set in the Vercel dashboard, not in this repository. Adding a country = both places, on a new decision.

### Per-address limit of the distribution (web ACL, VI-35)

Until VI-35 the distribution had no web ACL: one address asking reads the cache does not hold could take the 32 copies, and every other visitor got 429s. `waf.yaml` (stack `vega-v2-waf`, **us-east-1**: a web ACL of CloudFront scope exists only there) is attached by `deploy.sh` (step 7b, then `WebAclArn` of `vega-v2-api`). It sees every request before the cache, cache hits included, and counts per viewer address over the last 5 minutes:

| Rule | Counts | Limit | Action |
|---|---|---|---|
| `vega-v2-api-probe-500` | every path but `/data/` | 500 | count, always |
| `vega-v2-api-probe-3000` | every path but `/data/` | 3000 | count, always |
| `vega-v2-api-per-ip` | every path but `/data/` | `ApiLimit` (1500) | `Mode` |
| `vega-v2-all-per-ip` | every path, image copies included | `AllLimit` (6000) | `Mode` |

`Mode=Count` (the default, and the first week) only counts the requests over a limit; `Mode=Block` answers them `429` (JSON `RATE_LIMITED`, `Retry-After: 60`, open CORS, `no-store`) until the address's rate falls back under the limit (usually within 30 s of that). The site's clients do not retry an answer that asks for more than 2 s.

**The site's server is exempt.** Its own reads (the home's initial reads, the reports) leave from Vercel's few shared addresses for every visitor; it sends `X-Vega-Edge-Key`, and a request whose header equals the key exactly is left out of every count. The key is the SSM SecureString `/vega/v2/edge-key` (created once by `ci/secrets.sh`, passed as `SiteKey`); the Vercel project holds it as `VEGA_API_EDGE_KEY` (Production, sensitive, never `NEXT_PUBLIC_`). Without it on either side there is no exemption, and nothing else changes. The site's `/api` proxy never sends it. The status page (`/api/ops/*`, a few reads a minute) and search engines are counted like any address, far under the limits. Whoever holds the key escapes the limit (as everyone did before VI-35): rotate it.

Rotate the key (no moment without a valid key):

```sh
old=$(aws ssm get-parameter --name /vega/v2/edge-key --with-decryption --query Parameter.Value --output text)
aws cloudformation deploy --region us-east-1 --stack-name vega-v2-waf --template-file infra/aws/waf.yaml --no-fail-on-empty-changeset --parameter-overrides PreviousSiteKey="$old"
openssl rand -hex 32 | tr -d '\n' > key && aws ssm put-parameter --name /vega/v2/edge-key --type SecureString --overwrite --value file://key && rm key
bash infra/aws/deploy.sh   # SiteKey = the new key, PreviousSiteKey kept
# Vercel: VEGA_API_EDGE_KEY = the new key, redeploy the site; then drop the old key:
aws cloudformation deploy --region us-east-1 --stack-name vega-v2-waf --template-file infra/aws/waf.yaml --no-fail-on-empty-changeset --parameter-overrides PreviousSiteKey=
```

**Reading the counts.** Metrics are in CloudWatch, us-east-1, namespace `AWS/WAFV2`, dimensions `WebACL=vega-v2-api` and `Rule=<rule>` (`aws cloudwatch list-metrics --region us-east-1 --namespace AWS/WAFV2` lists them): `CountedRequests` in count mode, `BlockedRequests` in block mode, `AllowedRequests` on the rule `ALL`. A week's requests over each limit:

```sh
for rule in vega-v2-api-probe-500 vega-v2-api-per-ip vega-v2-api-probe-3000 vega-v2-all-per-ip; do
  echo "$rule $(aws cloudwatch get-metric-statistics --region us-east-1 --namespace AWS/WAFV2 --metric-name CountedRequests \
    --dimensions Name=WebACL,Value=vega-v2-api Name=Rule,Value=$rule --start-time "$(date -u -d '-7 days' +%FT%TZ)" \
    --end-time "$(date -u +%FT%TZ)" --period 604800 --statistics Sum --query 'Datapoints[0].Sum' --output text)"
done
```

Who is over a limit now, and what they asked (samples of the last 3 hours):

```sh
id=$(aws wafv2 list-web-acls --region us-east-1 --scope CLOUDFRONT --query "WebACLs[?Name=='vega-v2-api'].Id" --output text)
aws wafv2 get-rate-based-statement-managed-keys --region us-east-1 --scope CLOUDFRONT --web-acl-name vega-v2-api --web-acl-id "$id" --rule-name vega-v2-api-per-ip
aws wafv2 get-sampled-requests --region us-east-1 --scope CLOUDFRONT --web-acl-arn "$(aws cloudformation describe-stacks --region us-east-1 --stack-name vega-v2-waf --query "Stacks[0].Outputs[?OutputKey=='WebAclArn'].OutputValue" --output text)" \
  --rule-metric-name vega-v2-api-per-ip --time-window StartTime=$(date -u -d '-3 hours' +%s),EndTime=$(date -u +%s) --max-items 500
```

**Choosing the limit.** A page asks the API about 10 to 75 times when cold (its reads, plus one `/api/assets` per image not yet resolved; the copies under `/data/` are not counted), far less once the browser holds the images (a day). 1500 in 5 minutes is twenty cold heavy pages, or a visitor opening a page every 10 seconds for 5 minutes with a few sharing one address. After a week in count mode: if `vega-v2-api-per-ip` counted nothing from people (samples: browser user agents, home or mobile networks), keep it and block; if it did, raise `ApiLimit` above them (`vega-v2-api-probe-3000` says whether 3000 would do). `vega-v2-api-probe-500` says how close ordinary visitors come. A change of a limit resets the counts for up to a minute.

**Blocking, and back.** Block (only this stack changes; the next `deploy.sh` keeps it):

```sh
aws cloudformation deploy --region us-east-1 --stack-name vega-v2-waf --template-file infra/aws/waf.yaml --no-fail-on-empty-changeset --parameter-overrides Mode=Block
```

`Mode=Count` the same way is the way back (a minute or so). `WAF_MODE=Block|Count bash infra/aws/deploy.sh` does the same within a full deploy. To detach the web ACL from the distribution altogether (the distribution then behaves as before VI-35; the next `deploy.sh` attaches it again):

```sh
aws cloudformation update-stack --stack-name vega-v2-api --use-previous-template --capabilities CAPABILITY_IAM --parameters ParameterKey=WebAclArn,ParameterValue= \
  ParameterKey=ReleaseKey,UsePreviousValue=true ParameterKey=ReadDatabaseUrl,UsePreviousValue=true ParameterKey=OpsKey,UsePreviousValue=true \
  ParameterKey=MediaBaseUrl,UsePreviousValue=true ParameterKey=ReservedConcurrency,UsePreviousValue=true
```

The end-to-end check, once blocking is on (from a workstation: it gets that address limited for a few minutes): `CONFIRM_RATE_LIMIT_E2E=1 VEGA_API_EDGE_KEY=<SSM value> node tests/e2e/rate-limit.e2e.mjs https://dngp6kh9jx2bl.cloudfront.net <evidence dir>`.

Cost: $5 a month for the web ACL, $1 per rule (4), $0.60 per million requests inspected, cache hits included.
<!-- END VI-35 web ACL -->

### Import test: one full season and one archive season

After the first deploy, `import-test.sh` loads one complete league season through the backfill task and one archive season through the archive task, then reads them back through the read API (match families, season loader, clubs, standings, power rankings, archive):

```bash
AWS_PROFILE=statarena bash infra/aws/import-test.sh
```

Defaults: Ligue 1 (`LEAGUE=l_3FJFUl`), 2025/2026 (`SEASON=2025`), archive `ARCHIVE_SEASON=2019/2020`. With PitchAPI's free plan at one call every 0.5 s, a 306-match season (13 families each) takes about 40 minutes. The worker service computes the aggregates and, within a day, the levels, similarities and power rankings of the backfilled season (it now runs once for a season never computed). It writes only to `vega-football-db-postgres`.

### The base's statements, Performance Insights and its log (GH171)

Migration 179 creates `pg_stat_statements` in `vega_v2` (the module is preloaded since the base was created) and the view `ops.statement_stats`: per normalized statement, the login that ran it, its command, calls, rows, times and blocks, never its text; the owner reads it, no login of the code does. The group (`database.yaml`) records the statements inside the functions, never a role's DDL, and keeps bound values and rows' values (`DETAIL`) out of the log; all of it applies without a restart (`shared_preload_libraries` is unchanged, no `auto_explain`). The migrate task sets the logins' passwords as verifiers computed by libpq, never in clear text. Performance Insights keeps 7 days (free, Database Insights standard); the PostgreSQL log goes to `/aws/rds/instance/vega-football-db-postgres/postgresql`, 14 days (FAILURE_MODES_OPTIMISATIONS.md, GH171). After the Deploy that carries them, from the Mac:

```sh
aws rds describe-db-instances --profile statarena --region us-east-2 --db-instance-identifier vega-football-db-postgres \
  --query 'DBInstances[0].{insights:PerformanceInsightsEnabled,retention:PerformanceInsightsRetentionPeriod,mode:DatabaseInsightsMode,logs:EnabledCloudwatchLogsExports,group:DBParameterGroups[0].ParameterApplyStatus}'
aws rds describe-db-parameters --profile statarena --region us-east-2 --source user \
  --db-parameter-group-name "$(aws rds describe-db-instances --profile statarena --region us-east-2 --db-instance-identifier vega-football-db-postgres --query 'DBInstances[0].DBParameterGroups[0].DBParameterGroupName' --output text)" \
  --query "Parameters[].[ParameterName,ParameterValue,ApplyType]" --output table
aws logs describe-log-groups --profile statarena --region us-east-2 --log-group-name-prefix /aws/rds/instance/vega-football-db-postgres --query 'logGroups[].[logGroupName,retentionInDays]'
```

Expected: insights `true`, retention 7, mode `standard`, logs `["postgresql"]`, group `in-sync` (a `pending-reboot` would mean a static parameter changed: none does); the group's values as `database.yaml` writes them; the log group at 14 days. The heaviest statements, as the owner, in `vega_v2`: `SELECT login, command, calls, total_ms, mean_ms, shared_blks_read FROM ops.statement_stats ORDER BY total_ms DESC LIMIT 20;` (a statement's text, when needed, by its `queryid` in `pg_stat_statements`).

### The distribution's access logs and the cache by family (GH149)

Stack `vega-v2-edge-logs` (`edge-logs.yaml`, us-east-1, step 8b): CloudFront's standard logging v2 into the log group `vega-v2-api-access` (14 days). The function `vega-v2-api-family` (`api.yaml`, viewer request, on every behaviour but `data/*`) writes each request's family in `viewer-request-log-data`: its route with each identifier written `id` (`read.player`, `matches.id.summary`), `other` for any other path; it changes nothing of the request. A record holds the family, the behaviour, the method, the status, the three result types, the times and the bytes: never an address, a path, a query, a cookie, an agent, a referer, a request id or a country. The cache by family over a window (hits, refresh hits, misses, errors, shares of the GET and HEAD answers below 400, bytes, p50 and p95; the probe `health`, `ops.status`, `media`, `other` and `unlogged` apart):

```sh
AWS_PROFILE=statarena node infra/aws/edge-cache-report.mjs --live --from 2026-11-27T00:00:00Z --to 2026-12-04T00:00:00Z
```

It runs the saved queries `vega-v2/api-cache-by-family`, `vega-v2/api-latency-by-family`, `vega-v2/api-latency-other` and `vega-v2/api-latency-media` (CloudWatch Logs Insights, us-east-1); `--records <file>` folds records exported as JSON lines the same way, with the same families (`data/*` is `media`; a record the function did not label, `-`, is `unlogged`; a value outside the function's form is `other`; all three apart). The window is `[--from, --to)` in milliseconds both ways: `--live` asks Logs Insights for the whole seconds that cover it and filters each query on `toMillis(@timestamp)`; a record without the family field is read `-` (`coalesce`). The next route of #137 / #145 (a lighter validator, a longer edge time) is chosen from real counts: the origin's 24-hour count of revalidations already named `/api/matchdays` (FAILURE_MODES_OPTIMISATIONS.md GH137M); these counts by family can name the next ones over whatever window suffices (a week is one possibility, not a condition). A longer edge time also needs the route's freshness to be established. Check after the Deploy: `aws logs describe-deliveries --region us-east-1 --profile statarena` (the delivery of source `vega-v2-api-access`, its fields) and the group's first records (`aws logs tail vega-v2-api-access --region us-east-1 --profile statarena --since 10m`).

## Alerts

On 20 November 2026 the API refused every read for hours (VI-33) and no one was told: the database's three alarms notified no one. Since 23 November every alarm notifies the topic `vega-v2-alerts` of its region, of the alarm and of the return to normal (OK), by e-mail. `backend/tests/test_alerts.py` fails when an alarm loses its action, a threshold leaves the number it comes from, a name no longer matches the stack that creates it, or a filter pattern no longer recognises the line the handler writes.

Two stacks, deployed by `deploy.sh` (step 10, after the read API stack):

- `vega-v2-alerts` (`alerts.yaml`, us-east-2): the topic (export `vega-v2-alerts-topic`), the function's, the base's and the worker's alarms, and two metric filters on `/aws/lambda/vega-v2-api` (namespace `Vega/Api`). The base's alarms were in `database.yaml` until then: the first deploy removes them there (step 1) and creates them here (step 10), the same names.
- `vega-v2-alerts-edge` (`alerts-edge.yaml`, us-east-1): CloudFront and Route 53 metrics exist only there, and an alarm notifies only a topic of its own region, so it has its own `vega-v2-alerts` topic and subscription. It watches the distribution and probes `/api/health` from outside.

| Alarm | Rings when | Do |
|---|---|---|
| `vega-v2-api-unreachable` (us-east-1) | `/api/health` failed 3 minutes in a row from outside (Route 53 health check `vega-v2-api-health`, 3 regions, every 30 s); it reads `api.publication`, so a base that refuses is a failure too | `curl -i https://<ApiOrigin>/api/health`; a 503 `DATA_UNAVAILABLE`: the function's log (`read failed <code>`), then the base; no answer: the distribution and the function |
| `vega-v2-api-db-refused` | 5 reads or more in five minutes the base refused or could not take (`read failed` 53xxx, 57P01–03, 08xxx, 28xxx, ECONNREFUSED, ETIMEDOUT, ENOTFOUND) | 53300: the read login is full (The read API's connections; `SELECT count(*) FROM pg_stat_activity WHERE usename = 'vega_v2_read'`); 57P03: the base is restarting (RDS events); 28xxx: the login's password and `/vega/v2/read-database-url` differ |
| `vega-v2-api-5xx` | the function answered 10 errors or more in each of two five-minute periods | Logs Insights on the function's log: `filter status >= 500 \| stats count(*) by path` |
| `vega-v2-api-edge-5xx` (us-east-1) | 5 % or more of the distribution's answers were 5xx, two five-minute periods in a row of at least 100 requests each | the same; errors the distribution covered with its copy (`stale-if-error`) are not counted here |
| `vega-v2-api-errors` | the function failed (crash, timeout, memory) 5 times or more in 2 of 3 five-minute periods; a 503 is not one | the function's log, `Task timed out` or the error's stack |
| `vega-v2-api-throttles` | Lambda refused 20 requests or more, two periods in a row: all 32 copies busy | The read API's connections: raise the copies only while the base's processors are idle |
| `vega-v2-api-copies` | 29 of the 32 copies (90 %) ran at once for 15 minutes | the same, before the refusals |
| `vega-v2-api-slow` | the slowest tenth of the answers took 20 s or more (80 % of the 25 s limit) for 15 minutes; a statement stops at 8 s, so they wait on something else | the base's CPU and connections, the `ms` and `db` of the request lines |
| `vega-v2-db-low-memory`, `vega-v2-db-low-storage`, `vega-v2-db-high-cpu` | as before (under 300 MB freeable for 15 minutes, under 3 GB free, over 90 % CPU for 30 minutes) | memory: the backfill and the archives (9 November 2026); storage grows by itself up to `MaxAllocatedStorage` |
| `vega-v2-db-connections` | more than 88 connections for 15 minutes: the three logins' 78 (`vega/migrate.py`) plus 10 for the owner | `SELECT usename, count(*) FROM pg_stat_activity GROUP BY 1`: a session of the owner left open |
| `vega-v2-worker-down` | no task of `vega-v2-worker` ran for 15 minutes (its CPU metric stops when no task runs; no Container Insights needed) | `aws ecs describe-services --cluster vega-v2 --services vega-v2-worker` (events, stopped reason) and `/ecs/vega-v2-worker`. Absent when the deploy sets `WORKER_DESIRED_COUNT=0` |
| `vega-v2-api-p95` (GH204) | the slowest twentieth of the function's answers took 3 s or more for 30 minutes | a slowing long before `vega-v2-api-slow`: the dashboard's p95 by route, then `ops.statement_stats` (GH171) |
| `vega-v2-api-route-5xx` (GH204) | one route answered 2 errors (5xx) or more in each of 3 five-minute periods (Contributor Insights rule `vega-v2-api-route-5xx` over the request lines' `route`) | the rule names the route (CloudWatch, Contributor Insights): a route failing for its visitors while the function's total stays low (GH #220) |
| `vega-v2-worker-restarts`, `vega-v2-backfill-restarts` (GH204) | a task of the service stopped by its container or failed to start 3 times or more in 30 minutes (EventBridge rules `vega-v2-*-stops`); a deploy, a lowered count, a hand stop are not counted | `aws ecs describe-services --cluster vega-v2 --services <service>` (events, stopped reason), its log; absent while the service is meant to be off |
| `vega-v2-backfill-down` (GH204) | no task of `vega-v2-backfill` for 15 minutes while the Deploy set it to 1 | as the worker's; absent once `BACKFILL_DESIRED_COUNT=0` |
| `vega-v2-live-read-errors` | `vega-v2-live-read` failed 5 times or more in 2 of 3 periods | only once `LIVE_PROVIDER` is set: until then the live circuit has no alarm and costs nothing |

Missing data counts as normal (no request, no alarm), except for the probe, the worker and the backfill meant to run, whose silence is the failure. The dashboard `vega-v2` (CloudWatch, us-east-2) shows what they watch on one page: the function, the routes in 5xx and each route's p95, the services and their abnormal stops, the base, the distribution (us-east-1) and the alarms. Counts, not rates, on the function: a single error at night among three requests rings nothing; the probe sees an outage without traffic.

### The address

Never in the repository: the SSM parameter `/vega/v2/alert-email` (us-east-2), set once by the account owner: one address, or two separated by a comma (two people run the service; a third is not subscribed and the deploy says so). Without it the deploy logs `alerts: no SSM parameter /vega/v2/alert-email` and goes on; the alarms still change state in CloudWatch.

```sh
aws ssm put-parameter --profile statarena --region us-east-2 --name /vega/v2/alert-email --type String --overwrite --value '<address>[,<second address>]'
```

The next deploy subscribes each address to both topics: AWS sends each address two e-mails « AWS Notification - Subscription Confirmation », one per region; nothing is delivered to an address until it has followed each of its links. Check: `aws sns list-subscriptions-by-topic --region us-east-2 --topic-arn arn:aws:sns:us-east-2:361769570630:vega-v2-alerts` (and `us-east-1`): `PendingConfirmation` until then. Changing an address replaces its subscriptions (two new confirmations for that address); adding the second one leaves the first one's alone.

### Testing an alarm

```sh
aws cloudwatch set-alarm-state --profile statarena --region us-east-2 --alarm-name vega-v2-api-5xx --state-value ALARM --state-reason "test"
```

The e-mail arrives within a minute; the alarm goes back to OK at its next evaluation (a second e-mail). `--region us-east-1` for `vega-v2-api-unreachable` and `vega-v2-api-edge-5xx`. A filter pattern is tried against a real line without changing anything:

```sh
aws logs test-metric-filter --profile statarena --region us-east-2 \
  --filter-pattern "$(aws logs describe-metric-filters --profile statarena --region us-east-2 --log-group-name /aws/lambda/vega-v2-api --query "metricFilters[?metricTransformations[0].metricName=='DatabaseRefused'].filterPattern" --output text)" \
  --log-event-messages "$(printf '2026-11-20T21:04:05.123Z\tid\tERROR\tread failed 53300 /api/health')"
```

### Cost

About $3–5 a month: 11 alarms in us-east-2 (12 once the live circuit runs) and 2 in us-east-1, one of them on two metrics ($0.10 per alarm metric, the first 10 free), the two filter metrics ($0.30 each, within the 10 free custom metrics), the HTTPS health check ($0.50 + $1.00 for HTTPS, or $0.75 + $2.00 if a distribution does not count as an AWS endpoint), the probe's requests through the distribution and the function (about half a million a month, around $1), SNS e-mail (the first 1,000 a month free).

## Status page

The private status page (repository VegaInteligence/Vega-Status, its own Vercel project) reads `GET /api/ops/status`: the jobs of the last and next 24 hours, the queue, the watched matches, the source runs, the model runs, the provider calls per hour and the data warnings, from the `api.ops_*` views (`backend/sql/043_ops_status.sql`, `backend/sql/050_ops_status_reads.sql`, `backend/sql/051_ops_followed_matches.sql`). Its job queries are bounded by the indexes of `ops.fetch_jobs`; a failed read is logged as `read failed <code> <path>`.

- The key is the SSM SecureString `/vega/v2/ops-key` (random, created once by `ci/secrets.sh`). `deploy.sh` passes it to the function as `V2_OPS_KEY` (stack parameter `OpsKey`). Without it the route answers 404; with a wrong `X-Vega-Ops-Key` header, 401.
- CloudFront's `api/ops/*` behaviour uses the managed CachingDisabled policy and forwards only `X-Vega-Ops-Key` (the function adapter drops `Authorization`, which the origin access control signs).
- The Vercel project needs `VEGA_API_ORIGIN` (this stack's `ApiOrigin`) and `VEGA_OPS_KEY` (the SSM value) in Production.

## Continuous integration

| Workflow | When | What |
|---|---|---|
| `ci.yml` (CI) | every change to `backend`, `infra/aws`, the site or its tests; a pull request or a branch push runs only the jobs its files can break (`backend/ci/changed_suites.py`), main and a manual run run everything | every Python and API suite (seven parts side by side: python-1/2 and deploy-1..4 balanced by measured time, `backend/ci/durations.json`, and api) on a disposable PostgreSQL 18 with pgvector (the engine of `vega-football-db-postgres`), `cfn-lint` of the stacks, the worker image built natively on linux/arm64 and its tools started, the read API package, the site's tests and its build; no secret, no AWS access |
| `pilot.yml` (Isolated pilot) | by hand only, from `main` | real PitchAPI data into a throwaway PostgreSQL 18: the pilot collection (1 to 306 matches, 1 by default; the four old regression fixtures on request), then 0 to 700 worker jobs on the real J−1..J+7 calendars and the other sources, at 0.5 s and within a budget of attempts per command; its own key `/vega/v2/pitchapi-pilot-key` (role `vega-v2-pilot`, never the worker's key); only measurements leave the runner |
| `deploy.yml` (Deploy) | by hand, environment `v2-production` | `deploy.sh` with the `vega-v2-deploy` role |

## History: the move from the previous backend

The base (`vega-football-db-postgres`) was filled from the sources themselves; the previous database was never copied. Before the move, a parity tool read the same requests from both APIs. Its first run (2026-11-09, Ligue 1 2025/2026, the only fully collected season then) found match, stats, events and shots identical. The differences kept on purpose, all richer here or raw source data the base does not store:

- club and player reads carry `power` (the power ranking);
- a club's `country` is its league's when the source gives none (before: null), and a fixture keeps its round name;
- line-ups name players as their profile does, accents included ("Gerónimo Rulli"; before: the line-up's unaccented spelling);
- the competition catalogue has no `is_free` (a plan flag of the provider) and lists competitions by name;
- UEFA ranking rows rebuild only the `sourceRow` fields the site reads (teams still playing, season points), not the whole raw row;
- `metrics` of the actor reads is empty (the site has its own labels).

**Done on 10 November 2026**, on the owner's decision, before the backfill had finished (the site shows what the base holds while it runs):

- The site reads this API since 15:31 UTC. A first switch at 15:10 was put back six minutes later: the manifest said `storage: "aws-relational-v2"`, and the site turns its compact reads on for `"aws-relational"` only, so it loaded whole seasons page by page. The manifest now declares what the routes serve (`backend/api/src/routes/system.mjs`).
- The scheduled workflows of the old path were disabled that day, then deleted from the repository with the old backend's code (Collect football, Build serving tables, Validate production, Inspect database schema, Vega v2 collection on the existing RDS, Verify ingestion).
- The stack `statarena-backend` is deleted (the API function and its distribution `d317dq37z1tacb.cloudfront.net`).
- `statarena-postgres` is deleted; its final snapshot is `statarena-final-20261110` (64 GB).
- The old bucket `statarena-football-333rosky-70db6e5f` had `_migration/`, `data/_migration/`, `data/staging/`, `data/computed/` and `data/raw/` emptied that day; `data/sources/` (the old pipeline's provider responses and source files) stayed, for the archive import, until the bucket's deletion on 11 November (below).
- The stack `statarena-backend-actions` is deleted; the GitHub OIDC provider it had created is kept (the deploy and pilot roles sign in through it).
- The API and live functions take their packages from their own release bucket (`vega-v2-releases-…`); until the repository's clean-up of 10 November they took them from the old one (`statarena-backend-releases-…`).
- The pinned archive sources the import reads (52 files) were copied into the release bucket on 11 November 2026, identical file for file; nothing of the stack read the old bucket after that (checked that day on the deployed stacks, task definitions, functions, parameters and roles), and the owner deleted it the same day with what was left in it: the old pipeline's raw provider responses and its ranking and matchday source files. No bucket of the old name is left.
- Kept on purpose until the backfill has finished: the final snapshot `statarena-final-20261110`.
- Not served yet: `/api/player-market-values` (the player page's value card answers "Données indisponibles").

## Cost (on-demand, us-east-2, before free tier; check in the AWS pricing calculator)

| Item | Approx. per month |
|---|---|
| RDS `db.t4g.medium` single-AZ | ~$47 |
| gp3 20 GB, backups within the free allocation | ~$2.5 |
| Secrets Manager (managed master secret) | $0.40 |
| Fargate ARM 0.5 vCPU / 4 GB, always on (the worker; 0.25 vCPU / 2 GB and ~$11 until 2026-11-13) | ~$22 |
| Public IPv4 of the worker task | ~$3.6 |
| ECR, CloudWatch Logs (30 days), Lambda, CloudFront, S3 image copies (a few GB) | usage-based, a few dollars |
| Live: DynamoDB on demand, AppSync Events, the live read function | nothing without a live provider; per match and viewer once one runs |
| Live ingestor (Fargate ARM, like the worker) | ~$7 once started, 0 until a provider is chosen |
| **Total** | **≈ $76–81** |

The backfill task (1 vCPU / 2 GB) costs about $1 a day while it runs. No NAT gateway, load balancer, provisioned concurrency or reserved instance.

## Rollback

Each stack is independent. Setting `DesiredCount=0` stops the worker without data loss. Deleting `vega-v2-database` is refused while deletion protection is on, and leaves a final snapshot when it is off. There is no old path to go back to since 10 November 2026: its base exists only as the snapshot `statarena-final-20261110`.

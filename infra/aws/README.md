# Vega on AWS

Three CloudFormation stacks, one per block of the backend, plus the live stack (`live.yaml`) and the roles of the deployment workflow (`deploy-roles.yaml`) (doc « Vega Sport — schéma v2 », section Backend v2). The deployed resources keep the names they were created with (`vega-v2-…`, `/vega/v2/…`, `V2_…`, the database `vega_v2`): the code no longer uses that name, and renaming a stack, a bucket or a database means replacing it.

| Stack | Template | Contents |
|---|---|---|
| `vega-v2-database` | `database.yaml` | private PostgreSQL 18 (`vega-football-db-postgres`, database `vega_v2`, `db.t4g.medium` since 2026-11-09, gp3 20→100 GB, encrypted, 7-day backups, deletion protection, snapshot on delete), master password managed by Secrets Manager, security groups of the worker and the API |
| `vega-v2-worker` | `worker.yaml` | ECR repository, ECS cluster, the always-on worker service (Fargate ARM 0.5 vCPU / 4 GB since 2026-11-13, one task), the `vega-v2-backfill` service (1 vCPU / 2 GB, one task while history is collected, none after), the on-demand `vega-v2-migrate` task definition, the private bucket of the image copies (`vega-v2-media-…`, written only under `data/sources/v2/images/` by the worker's task role), and the private release bucket (`vega-v2-releases-…`: the function packages, and the pinned archive sources under `data/sources/`) |
| `vega-v2-api` | `api.yaml` | the read API Lambda (Node 24 ARM, `backend/api`), its signed Function URL and its own CloudFront distribution; the distribution also serves the image copies at `data/*` from the media bucket (origin access control, bucket policy limited to this distribution) and `api/ops/*`, the status page's read, uncached |

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

1. database stack (about 10 minutes the first time);
2. secrets, created once in SSM SecureStrings (`ci/secrets.sh`): three random login passwords, the status page's key, the PitchAPI key, and the connection URLs built from the database endpoint. Values go through mode-0600 files, never the command line or the log;
3. worker stack with the worker and the backfill stopped (it creates the ECR repository, the task definitions and the two buckets);
4. worker image (linux/arm64, tagged with the git SHA, pushed once);
5. migrations and logins, as the one-off `vega-v2-migrate` task (the script stops if it fails);
6. worker start (`WORKER_DESIRED_COUNT`, 1 by default);
6b. live stack (`live.yaml`): the live tables, the AppSync Events API and its browser key (renewed for 360 days on each deploy), the `GET /live/matches/{id}` function and the EventBridge schedule that starts the ingestor every 15 minutes (`--until-idle`: it exits at once without a match within 30 minutes, follows the day's matches to the last otherwise, and a second start finds the lease taken), off unless `LIVE_PROVIDER` names an adapter;
7. read API package, uploaded under `releases/v2-api/` of the release bucket;
8. read API stack; on the first deployment a second pass sets `MediaBaseUrl` once the distribution's domain is known;
9. with `IMPORT_ARCHIVES=true`, the historical archive import (`vega-v2-archives`), which reads the pinned sources under `data/sources/` of the release bucket (`openfootball/`, `engsoccerdata/`, `worldclub/`; another bucket with `ARCHIVE_SOURCES_BUCKET`), read only: whole seasons up to 2020/2021, then only the competitions PitchAPI has no edition of that season. A re-import writes only what differs.

### One-time setup (commands to run, each changes AWS or GitHub)

```sh
aws login --profile statarena
```

```sh
aws cloudformation deploy --profile statarena --region us-east-2 --stack-name vega-v2-deploy-roles --template-file infra/aws/deploy-roles.yaml --capabilities CAPABILITY_NAMED_IAM
```

The database size of the doc (« Volume » : 4 GB once measured; on 2026-11-09 the 1 GB instance ran out of memory twice with the archives and the backfill), set once by the account owner, then kept by every deploy:

```bash
aws cloudformation deploy --profile statarena --region us-east-2 --stack-name vega-v2-database --template-file infra/aws/database.yaml --parameter-overrides InstanceClass=db.t4g.medium --no-fail-on-empty-changeset
```

```sh
gh api -X PUT repos/VegaInteligence/Vega-Sport/environments/v2-production
```

`deploy-roles.yaml` creates `vega-v2-deploy` (assumable only by the **Deploy** workflow of this repository, in the `v2-production` environment, through the existing GitHub OIDC provider) and `vega-v2-cloudformation` (the service role CloudFormation uses, limited to the `vega-v2-*` resources). Both trusts name the workflow: after renaming a workflow, deploy this stack again before the workflow runs.

A stack the workflow has changed once keeps `vega-v2-cloudformation` as its role: later changes use it from a workstation too, where the script passes no role. A template change that needs a permission the role lacks therefore stops both paths, and its rollback fails the same way (the live stack on 10 November 2026: the role could not renew the browser key). Add the permission to `deploy-roles.yaml` and deploy that stack first; `aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::361769570630:role/vega-v2-cloudformation --action-names … --resource-arns …` tells beforehand (an action that takes no resource answers only when asked with `*`). A stack left in `UPDATE_ROLLBACK_FAILED` is recovered, once the role is right, with `aws cloudformation continue-update-rollback --stack-name <stack>`.

A run is checked on what it deployed, not on its colour: its log ends with `done`, and `aws lambda get-function-configuration --function-name vega-v2-api --query LastModified` gives the time of the run.

#### Spend alerts (`budget.yaml`, stack `vega-v2-budget`)

The owner deploys it once with his own credentials (the workflow's roles have no billing permission, and `deploy.sh` never touches it): a monthly cost budget of $120 (the estimate below is $76–81) that mails at 50, 80 and 100 % of the actual spend and when the forecast passes 100 %, and Cost Anomaly Detection that mails once a day an anomaly of $10 or more. Budgets without actions and anomaly detection are free. The address is a parameter, never in the repository. The account allows one services anomaly monitor, and Cost Explorer may have created one already: list it first, and pass its ARN if there is one.

```sh
aws ce get-anomaly-monitors --profile statarena --query "AnomalyMonitors[?MonitorDimension=='SERVICE'].MonitorArn" --output text
```

```sh
aws cloudformation deploy --profile statarena --region us-east-2 --stack-name vega-v2-budget --template-file infra/aws/budget.yaml --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset --parameter-overrides AlertEmail=<address> ExistingServiceMonitorArn=<ARN printed above, empty if none>
```

Optional, off by default: `LiveSchedulerRoleName=<the live stack's SchedulerRole>` (`aws cloudformation describe-stack-resource --stack-name vega-v2-live --logical-resource-id SchedulerRole --query StackResourceDetail.PhysicalResourceId`) makes the budget deny, at 100 %, the start of new live ingestor tasks; nothing that serves the site stops. Reverse it with `aws budgets execute-budget-action --execution-type REVERSE_BUDGET_ACTION`. `AlertTopicArn=<vega-v2-alerts>` also sends the budget mails to that topic, once its policy lets `budgets.amazonaws.com` publish.

### Deploy

From a workstation:

```sh
AWS_PROFILE=statarena PITCHAPI_API_KEY_FILE=<file holding the key> bash infra/aws/deploy.sh
```

Then, from GitHub: `gh workflow run "Deploy" -f worker_desired_count=1`. The migration task's log line `migrations applied=N total=M logins=…` shows 63 migrations (65 with `V2_VECTOR=1`). The backfill is a second service, `vega-v2-backfill`, of one task or none: `BACKFILL_DESIRED_COUNT=1 bash infra/aws/deploy.sh` turns it on, `=0` turns it off, and a deploy without the variable keeps what it has. ECS starts its task again whenever it stops, on the image of the last deploy. It waits when its lane is empty and does not stop by itself: set it to 0 once `ops.collection_progress` shows history collected.

A database restart (memory recovery, resize) does not stop a task: every connection sees a lost database within a minute (`store.CONNECTION`), and the worker and the backfill reconnect by themselves (`database lost error=… retry_in=N` in the log) for up to 30 minutes. After that the task exits with an error and ECS starts it again, the worker's and the backfill's alike.

A deploy stops the worker and the backfill before the migrations and starts both again on the new image: neither keeps code older than the base it writes to. (Until 10 November 2026 the backfill was a task run by hand, which kept the image it was started with and had to be stopped before a deploy and run again after it.)

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

When the function fails or cannot be reached, the distribution answers with the copy it holds for up to a day (`stale-if-error=86400`, set by `transport.mjs` on every public answer that does not say otherwise). `/api/health` and `/api/ops/*` are never kept: they say what the function says now.

The function logs one line per request it receives (`{"request":"read","path":…,"status":…,"ms":…,"db":…,"queries":…,"conditional":…}`, the path without its query). Reads the distribution answers by itself leave none: the lines are the calls that reached the function. In CloudWatch Logs Insights, on `/aws/lambda/vega-v2-api`:

```
filter request = "read" | stats count(*) as calls, sum(conditional) as revalidations, avg(ms), avg(db) by path | sort calls desc
```

### Import test: one full season and one archive season

After the first deploy, `import-test.sh` loads one complete league season through the backfill task and one archive season through the archive task, then reads them back through the read API (match families, season loader, clubs, standings, power rankings, archive):

```bash
AWS_PROFILE=statarena bash infra/aws/import-test.sh
```

Defaults: Ligue 1 (`LEAGUE=l_3FJFUl`), 2025/2026 (`SEASON=2025`), archive `ARCHIVE_SEASON=2019/2020`. With PitchAPI's free plan at one call every 0.5 s, a 306-match season (13 families each) takes about 40 minutes. The worker service computes the aggregates and, within a day, the levels, similarities and power rankings of the backfilled season (it now runs once for a season never computed). It writes only to `vega-football-db-postgres`.

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
| `vega-v2-live-read-errors` | `vega-v2-live-read` failed 5 times or more in 2 of 3 periods | only once `LIVE_PROVIDER` is set: until then the live circuit has no alarm and costs nothing |

Missing data counts as normal (no request, no alarm), except for the probe and the worker, whose silence is the failure. Counts, not rates, on the function: a single error at night among three requests rings nothing; the probe sees an outage without traffic.

### The address

Never in the repository: the SSM parameter `/vega/v2/alert-email` (us-east-2), set once by the account owner. Without it the deploy logs `alerts: no SSM parameter /vega/v2/alert-email` and goes on; the alarms still change state in CloudWatch.

```sh
aws ssm put-parameter --profile statarena --region us-east-2 --name /vega/v2/alert-email --type String --value '<address>'
```

The next deploy subscribes it to both topics: AWS sends two e-mails « AWS Notification - Subscription Confirmation », one per region; nothing is delivered until each link is followed. Check: `aws sns list-subscriptions-by-topic --region us-east-2 --topic-arn arn:aws:sns:us-east-2:361769570630:vega-v2-alerts` (and `us-east-1`): `PendingConfirmation` until then. Changing the parameter replaces the subscriptions (two new confirmations).

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
| `ci.yml` (CI) | every change to `backend`, `infra/aws`, the site or its tests | every Python and API suite on a disposable PostgreSQL 18 with pgvector (the engine of `vega-football-db-postgres`), `cfn-lint` of the stacks, the worker image built natively on linux/arm64 and its tools started, the read API package, the site's tests and its build; no secret, no AWS access |
| `pilot.yml` (Isolated pilot) | `backend` changes, or by hand | real PitchAPI data into a throwaway PostgreSQL 18: the pilot collection, then 700 worker jobs on the real J−1..J+7 calendars and the other sources; only measurements leave the runner |
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

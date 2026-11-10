# Vega on AWS

Three CloudFormation stacks, one per block of the backend, plus the live stack (`live.yaml`) and the roles of the deployment workflow (`deploy-roles.yaml`) (doc « Vega Sport — schéma v2 », section Backend v2). The deployed resources keep the names they were created with (`vega-v2-…`, `/vega/v2/…`, `V2_…`, the database `vega_v2`): the code no longer uses that name, and renaming a stack, a bucket or a database means replacing it.

| Stack | Template | Contents |
|---|---|---|
| `vega-v2-database` | `database.yaml` | private PostgreSQL 18 (`vega-football-db-postgres`, database `vega_v2`, `db.t4g.medium` since 2026-11-09, gp3 20→100 GB, encrypted, 7-day backups, deletion protection, snapshot on delete), master password managed by Secrets Manager, security groups of the worker and the API |
| `vega-v2-worker` | `worker.yaml` | ECR repository, ECS cluster, the always-on worker service (Fargate ARM 0.25 vCPU / 2 GB, one task), the `vega-v2-backfill` service (1 vCPU / 2 GB, one task while history is collected, none after), the on-demand `vega-v2-migrate` task definition, the private bucket of the image copies (`vega-v2-media-…`, written only under `data/sources/v2/images/` by the worker's task role), and the private release bucket (`vega-v2-releases-…`: the function packages, and the pinned archive sources under `data/sources/`) |
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

The account runs at most 10 Lambdas concurrently: `ReservedConcurrency` stays 0 and the pool size 1 until the quota is raised.

### Import test: one full season and one archive season

After the first deploy, `import-test.sh` loads one complete league season through the backfill task and one archive season through the archive task, then reads them back through the read API (match families, season loader, clubs, standings, power rankings, archive):

```bash
AWS_PROFILE=statarena bash infra/aws/import-test.sh
```

Defaults: Ligue 1 (`LEAGUE=l_3FJFUl`), 2025/2026 (`SEASON=2025`), archive `ARCHIVE_SEASON=2019/2020`. With PitchAPI's free plan at one call every 0.5 s, a 306-match season (13 families each) takes about 40 minutes. The worker service computes the aggregates and, within a day, the levels, similarities and power rankings of the backfilled season (it now runs once for a season never computed). It writes only to `vega-football-db-postgres`.

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
- The old bucket `statarena-football-333rosky-70db6e5f` keeps `data/sources/` (the archive import reads it); `_migration/`, `data/_migration/`, `data/staging/`, `data/computed/` and `data/raw/` are emptied.
- The stack `statarena-backend-actions` is deleted; the GitHub OIDC provider it had created is kept (the deploy and pilot roles sign in through it).
- The API and live functions take their packages from their own release bucket (`vega-v2-releases-…`); until the repository's clean-up of 10 November they took them from the old one (`statarena-backend-releases-…`).
- The pinned archive sources the import reads (52 files) were copied into the release bucket on 11 November 2026, identical file for file; nothing of the stack reads the old bucket `statarena-football-333rosky-70db6e5f` any more.
- Kept on purpose until the backfill has finished: the final snapshot `statarena-final-20261110`.
- Not served yet: `/api/player-market-values` (the player page's value card answers "Données indisponibles").

## Cost (on-demand, us-east-2, before free tier; check in the AWS pricing calculator)

| Item | Approx. per month |
|---|---|
| RDS `db.t4g.medium` single-AZ | ~$47 |
| gp3 20 GB, backups within the free allocation | ~$2.5 |
| Secrets Manager (managed master secret) | $0.40 |
| Fargate ARM 0.25 vCPU / 2 GB, always on (the worker) | ~$11 |
| Public IPv4 of the worker task | ~$3.6 |
| ECR, CloudWatch Logs (30 days), Lambda, CloudFront, S3 image copies (a few GB) | usage-based, a few dollars |
| Live: DynamoDB on demand, AppSync Events, the live read function | nothing without a live provider; per match and viewer once one runs |
| Live ingestor (Fargate ARM, like the worker) | ~$7 once started, 0 until a provider is chosen |
| **Total** | **≈ $65–70** |

The backfill task (1 vCPU / 2 GB) costs about $1 a day while it runs. No NAT gateway, load balancer, provisioned concurrency or reserved instance.

## Rollback

Each stack is independent. Setting `DesiredCount=0` stops the worker without data loss. Deleting `vega-v2-database` is refused while deletion protection is on, and leaves a final snapshot when it is off. There is no old path to go back to since 10 November 2026: its base exists only as the snapshot `statarena-final-20261110`.

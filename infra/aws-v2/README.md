# Vega v2 on AWS

Three CloudFormation stacks, one per block of the v2 backend, plus the roles of the deployment workflow (`deploy-roles.yaml`) (doc « Vega Sport — schéma v2 », section Backend v2). They live next to the current backend and change nothing of it: the `statarena-postgres` instance, its security group, the `statarena-backend` Lambda and distribution, and the GitHub ingestion workflows keep running until the cutover is complete.

| Stack | Template | Contents |
|---|---|---|
| `vega-v2-database` | `database.yaml` | private PostgreSQL 18 (`vega-football-db-postgres`, database `vega_v2`, `db.t4g.micro`, gp3 20→100 GB, encrypted, 7-day backups, deletion protection, snapshot on delete), master password managed by Secrets Manager, security groups of the worker and the API |
| `vega-v2-worker` | `worker.yaml` | ECR repository, ECS cluster, the always-on worker service (Fargate ARM 0.25 vCPU / 0.5 GB, one task), the on-demand `vega-v2-backfill` and `vega-v2-migrate` task definitions, and the private bucket of the image copies (`vega-v2-media-…`, written only under `data/sources/v2/images/` by the worker's task role) |
| `vega-v2-api` | `api.yaml` | the read API Lambda (Node 24 ARM, `v2/api`), its signed Function URL and its own CloudFront distribution (same policies as the current API); the distribution also serves the image copies at `data/*` from the media bucket (origin access control, bucket policy limited to this distribution) and `api/ops/*`, the status page's read, uncached |

Account 361769570630, region us-east-2, AWS CLI profile `statarena`, default VPC `vpc-08e400afa07fc1812` and its three subnets. The subnets route to an internet gateway: the worker gets a public IP for outbound HTTPS (sources, ECR, logs) and no inbound port; no NAT gateway is needed. The database is not publicly accessible: only the worker and API security groups reach it on 5432.

## Database roles

`v2/sql/017_roles.sql` creates three group roles; the migration task creates one login per group:

| Login | Group | Rights |
|---|---|---|
| `vega_owner` (RDS master) | — | owns the schemas; applies migrations |
| `vega_v2_collect` | `vega_collect` | writes `core` and `ops`; no access to `agg`; creates partitions through the owner's functions |
| `vega_v2_calc` | `vega_calc` | reads `core`, writes `agg`, `ops.dirty_scopes`, `ops.resource_versions` |
| `vega_v2_read` | `vega_read` | reads the `api` schema only (the API also sets `role=vega_read` on each connection) |

## Deployment

`deploy.sh` is the whole deployment: the same script runs from the **Vega v2 deploy** workflow (`.github/workflows/v2-deploy.yml`, manual, role `vega-v2-deploy`) and from a workstation. Every step only creates or changes `vega-v2-*` resources and the second base `vega-football-db-postgres`:

1. database stack (about 10 minutes the first time);
2. secrets, created once in SSM SecureStrings (`ci/secrets.sh`): three random login passwords, the status page's key, the PitchAPI key, and the connection URLs built from the database endpoint. Values go through mode-0600 files, never the command line or the log;
3. worker stack with the worker stopped (it creates the ECR repository and the task definitions);
4. worker image (linux/arm64, tagged with the git SHA, pushed once);
5. migrations and logins, as the one-off `vega-v2-migrate` task (the script stops if it fails);
6. worker start (`WORKER_DESIRED_COUNT`, 1 by default);
6b. live stack (`live.yaml`): the live tables, the AppSync Events API and its browser key (renewed for 360 days on each deploy), the `GET /live/matches/{id}` function and the EventBridge schedule that starts the ingestor every 15 minutes (`--until-idle`: it exits at once without a match within 30 minutes, follows the day's matches to the last otherwise, and a second start finds the lease taken), off unless `LIVE_PROVIDER` names an adapter;
7. read API package, uploaded under `releases/v2-api/`;
8. read API stack; on the first deployment a second pass sets `MediaBaseUrl` once the distribution's domain is known;
9. with `IMPORT_ARCHIVES=true` and `ARCHIVE_SOURCES_BUCKET`, the historical archive import (`vega-v2-archives`), which reads main's pinned sources under `data/sources/` read only.

### One-time setup (commands to run, each changes AWS or GitHub)

```sh
aws login --profile statarena
```

```sh
aws cloudformation deploy --profile statarena --region us-east-2 --stack-name vega-v2-deploy-roles --template-file infra/aws-v2/deploy-roles.yaml --capabilities CAPABILITY_NAMED_IAM
```

The database size of the doc (« Volume » : 4 GB once measured; on 2026-11-09 the 1 GB instance ran out of memory twice with the archives and the backfill), set once by the account owner, then kept by every deploy:

```bash
aws cloudformation deploy --profile statarena --region us-east-2 --stack-name vega-v2-database --template-file infra/aws-v2/database.yaml --parameter-overrides InstanceClass=db.t4g.medium --no-fail-on-empty-changeset
```

```sh
gh api -X PUT repos/VegaInteligence/Vega-Sport/environments/v2-production
```

`deploy-roles.yaml` creates `vega-v2-deploy` (assumable only by the **Vega v2 deploy** workflow of this repository, in the `v2-production` environment, through the existing GitHub OIDC provider) and `vega-v2-cloudformation` (the service role CloudFormation uses, limited to the v2 resources). Optional: `gh variable set V2_ARCHIVE_SOURCES_BUCKET --body <main's data bucket>` for the archive import.

### Deploy

From a workstation, before the workflow is on `main` (a manual workflow can only be started once it is on the default branch):

```sh
AWS_PROFILE=statarena PITCHAPI_API_KEY_FILE=<file holding the key> bash infra/aws-v2/deploy.sh
```

Then, from GitHub: `gh workflow run "Vega v2 deploy" -f worker_desired_count=1`. The migration task's log line `migrations applied=N total=M logins=…` shows 43 migrations (45 with `V2_VECTOR=1`). The backfill runs on demand, for days, and stops by itself when its lane is empty: `aws ecs run-task … --task-definition vega-v2-backfill` with the network configuration `deploy.sh` uses.

A database restart (memory recovery, resize) does not stop a task: every connection sees a lost database within a minute (`store.CONNECTION`), and the worker and the backfill reconnect by themselves (`database lost error=… retry_in=N` in the log) for up to 30 minutes. After that the task exits with an error: ECS starts the worker service's task again, the backfill has to be run again by hand.

A running backfill keeps the image it was started with: `deploy.sh` stops and restarts only the worker service. After a deploy whose migration changes what the calculator reads (`calculator error=DATABASE_42703` in the backfill's log), stop the backfill task and run it again; it resumes from what is still missing.

The account runs at most 10 Lambdas concurrently and the current API needs them: `ReservedConcurrency` stays 0 and the pool size 1 until the quota is raised.

### Import test: one full season and one archive season

After the first deploy, `import-test.sh` loads one complete league season through the backfill task and one archive season through the archive task, then reads them back through the v2 API (match families, season loader, clubs, standings, power rankings, archive):

```bash
AWS_PROFILE=statarena ARCHIVE_SOURCES_BUCKET=<main's data bucket> bash infra/aws-v2/import-test.sh
```

Defaults: Ligue 1 (`LEAGUE=l_3FJFUl`), 2025/2026 (`SEASON=2025`), archive `ARCHIVE_SEASON=2019/2020`. With PitchAPI's free plan at one call every 0.5 s, a 306-match season (13 families each) takes about 40 minutes. The worker service computes the aggregates and, within a day, the levels, similarities and power rankings of the backfilled season (it now runs once for a season never computed). It writes only to `vega-football-db-postgres`.

## Status page

The private status page (repository VegaInteligence/Vega-Status, its own Vercel project) reads `GET /api/ops/status`: the jobs of the last and next 24 hours, the queue, the watched matches, the source runs, the model runs, the provider calls per hour and the data warnings, from the `api.ops_*` views (`v2/sql/043_ops_status.sql`, `v2/sql/050_ops_status_reads.sql`). Its job queries are bounded by the indexes of `ops.fetch_jobs`; a failed read is logged as `v2 read failed <code> <path>`.

- The key is the SSM SecureString `/vega/v2/ops-key` (random, created once by `ci/secrets.sh`). `deploy.sh` passes it to the function as `V2_OPS_KEY` (stack parameter `OpsKey`). Without it the route answers 404; with a wrong `X-Vega-Ops-Key` header, 401.
- CloudFront's `api/ops/*` behaviour uses the managed CachingDisabled policy and forwards only `X-Vega-Ops-Key` (the function adapter drops `Authorization`, which the origin access control signs).
- The Vercel project needs `VEGA_API_ORIGIN` (this stack's `ApiOrigin`) and `VEGA_OPS_KEY` (the SSM value) in Production.

## Continuous integration

| Workflow | When | What |
|---|---|---|
| `v2-ci.yml` (Vega v2 CI) | every change to v2, `infra/aws-v2` or the main code v2 reuses | every Python and API suite on a disposable PostgreSQL 18 with pgvector (the engine of `vega-football-db-postgres`), `cfn-lint` of the stacks, the worker image built natively on linux/arm64 and its tools started, the read API package; no secret, no AWS access |
| `vega-v2-pilot.yml` | v2 changes, or by hand | real PitchAPI data into a throwaway PostgreSQL 18: the pilot collection, then 700 worker jobs on the real J−1..J+7 calendars and the other sources; only measurements leave the runner |
| `v2-deploy.yml` (Vega v2 deploy) | by hand, environment `v2-production` | `deploy.sh` with the `vega-v2-deploy` role |

`docs/verification/aws-actions-20261104/verify.py` (run by **Verify ingestion**) checks these rules: CI read-only without secrets on PostgreSQL 18, deploy manual only with OIDC, its own role and only the provider key.

## Parity and cutover

v2 is a second base (`vega-football-db-postgres`) filled from the sources themselves: the current RDS is never copied. The move happens once v2 holds everything, in four steps:

1. **Backfill everything.** Run the backfill task without bounds; it reads every edition since 2021/2022 and stops by itself:

   ```sh
   aws ecs run-task --profile statarena --region us-east-2 --cluster vega-v2 --task-definition vega-v2-backfill --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[subnet-0233a9567335f56ce,subnet-04c9af303f55d9718,subnet-0e72516f361932c15],securityGroups=[<WorkerSecurityGroup of vega-v2-database>],assignPublicIp=ENABLED}"
   ```

   Then import every archive season with `IMPORT_ARCHIVES=true ARCHIVE_SOURCES_BUCKET=<bucket> bash infra/aws-v2/deploy.sh`.
2. **Parity.** `v2/api/parity.mjs` reads each current path from the current API and the same request under its v2 route (the site's own mapping, `v2-routes.js`), and lists every difference outside publication metadata and the gaps each route documents:

   ```sh
   node v2/api/parity.mjs --legacy https://d317dq37z1tacb.cloudfront.net --v2 https://<vega-v2-api distribution> paths.txt
   ```

   First run, 2026-11-09, on Ligue 1 2025/2026 (the only fully collected season then): match, stats, events and shots identical. Fixed from it: the player list's statement timeout and the club goal times (counted from the shot map, as main). Differences kept on purpose, all richer on the v2 side or raw source data v2 does not store:
   - club and player reads carry `power` (the power ranking);
   - a club's `country` is its league's when the source gives none (main: null), and a fixture keeps its round name;
   - line-ups name players as their profile does, accents included ("Gerónimo Rulli"; main repeats the line-up's unaccented spelling);
   - the competition catalogue has no `is_free` (a plan flag of the provider) and lists competitions by name;
   - UEFA ranking rows rebuild only the `sourceRow` fields the site reads (teams still playing, season points), not the whole raw row;
   - `metrics` of the actor reads is empty (the site has its own labels).

3. **Switch the site.** In the site's Vercel project, set `NEXT_PUBLIC_API_ORIGIN` to the v2 distribution (`ApiOrigin` output of `vega-v2-api`) and `NEXT_PUBLIC_API_SCHEMA=v2`, then redeploy. Every read goes to its v2 route (`dashboard/frontend/src/services/v2-routes.js`): the provider proxy becomes `/api/matches/{id}[/…]`, `/api/competitions`, `/api/players/{id}` and `/api/teams/{id}`, club facts and stadiums are read by club id, cups by Vega id, schedules as fixture pages, and the Ballon d'Or slots show the player power ranking. Rolling back is removing the two variables and redeploying.
4. **Retire the old path, with explicit consent only.** Stop the GitHub ingestion workflows, then, separately, the current backend and the RDS `statarena-postgres` (a final snapshot first). Nothing here deletes them.

## Cost (on-demand, us-east-2, before free tier; check in the AWS pricing calculator)

| Item | Approx. per month |
|---|---|
| RDS `db.t4g.micro` single-AZ | ~$12 |
| gp3 20 GB, backups within the free allocation | ~$2.5 |
| Secrets Manager (managed master secret) | $0.40 |
| Fargate ARM 0.25 vCPU / 0.5 GB, always on | ~$7 |
| Public IPv4 of the worker task | ~$3.6 |
| ECR, CloudWatch Logs (30 days), Lambda, CloudFront, S3 image copies (a few GB) | usage-based, a few dollars |
| Live: DynamoDB on demand, AppSync Events, the live read function | nothing without a live provider; per match and viewer once one runs |
| Live ingestor (Fargate ARM, like the worker) | ~$7 once started, 0 until a provider is chosen |
| **Total** | **≈ $25–30** |

The backfill task costs the same rate as the worker while it runs. No NAT gateway, load balancer, provisioned concurrency or reserved instance.

## Rollback

Each stack is independent. Setting `DesiredCount=0` stops the worker without data loss. Deleting `vega-v2-database` is refused while deletion protection is on, and leaves a final snapshot when it is off. Nothing here touches the current production path.

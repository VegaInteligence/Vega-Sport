# Vega v2 on AWS

Three CloudFormation stacks, one per block of the v2 backend (doc « Vega Sport — schéma v2 », section Backend v2). They live next to the current backend and change nothing of it: the `statarena-postgres` instance, its security group, the `statarena-backend` Lambda and distribution, and the GitHub ingestion workflows keep running until the cutover is complete.

| Stack | Template | Contents |
|---|---|---|
| `vega-v2-database` | `database.yaml` | private PostgreSQL 18 (`vega-v2-postgres`, `db.t4g.micro`, gp3 20→100 GB, encrypted, 7-day backups, deletion protection, snapshot on delete), master password managed by Secrets Manager, security groups of the worker and the API |
| `vega-v2-worker` | `worker.yaml` | ECR repository, ECS cluster, the always-on worker service (Fargate ARM 0.25 vCPU / 0.5 GB, one task), the on-demand `vega-v2-backfill` and `vega-v2-migrate` task definitions, and the private bucket of the image copies (`vega-v2-media-…`, written only under `data/sources/v2/images/` by the worker's task role) |
| `vega-v2-api` | `api.yaml` | the read API Lambda (Node 24 ARM, `v2/api`), its signed Function URL and its own CloudFront distribution (same policies as the current API); the distribution also serves the image copies at `data/*` from the media bucket (origin access control, bucket policy limited to this distribution) |

Account 361769570630, region us-east-2, AWS CLI profile `statarena`, default VPC `vpc-08e400afa07fc1812` and its three subnets. The subnets route to an internet gateway: the worker gets a public IP for outbound HTTPS (sources, ECR, logs) and no inbound port; no NAT gateway is needed. The database is not publicly accessible: only the worker and API security groups reach it on 5432.

## Database roles

`v2/sql/017_roles.sql` creates three group roles; the migration task creates one login per group:

| Login | Group | Rights |
|---|---|---|
| `vega_owner` (RDS master) | — | owns the schemas; applies migrations |
| `vega_v2_collect` | `vega_collect` | writes `core` and `ops`; no access to `agg`; creates partitions through the owner's functions |
| `vega_v2_calc` | `vega_calc` | reads `core`, writes `agg`, `ops.dirty_scopes`, `ops.resource_versions` |
| `vega_v2_read` | `vega_read` | reads the `api` schema only (the API also sets `role=vega_read` on each connection) |

## Deployment (each command that changes AWS is marked)

Validation is read-only:

```sh
for t in database worker api; do aws cloudformation validate-template --profile statarena --region us-east-2 --template-body file://infra/aws-v2/$t.yaml; done
```

1. **Changes AWS.** Database stack (about 10 minutes):

   ```sh
   aws cloudformation deploy --profile statarena --region us-east-2 --stack-name vega-v2-database --template-file infra/aws-v2/database.yaml --no-execute-changeset
   ```

   Review the change set in the console or with `describe-change-set`, then execute it.

2. **Changes AWS.** Three random passwords and the source key, as SSM SecureStrings. Type them through a file, never on the command line or in shell history: `/vega/v2/password-collect`, `/vega/v2/password-calc`, `/vega/v2/password-read`, `/vega/v2/pitchapi-key`. Then the two worker URLs, built from the stack's `DatabaseEndpoint` output: `/vega/v2/collect-database-url` and `/vega/v2/calc-database-url`, as `postgresql://vega_v2_collect:<password>@<endpoint>:5432/vega_v2?sslmode=verify-full&sslrootcert=/app/rds-ca.pem` (percent-encode the password).

3. **Changes AWS.** Worker image and stack. Build from the repository root, then push with the git SHA as the immutable tag:

   ```sh
   docker build --platform linux/arm64 -f v2/Dockerfile -t vega-v2-worker:$(git rev-parse HEAD) .
   aws cloudformation deploy --profile statarena --region us-east-2 --stack-name vega-v2-worker --template-file infra/aws-v2/worker.yaml --capabilities CAPABILITY_IAM --parameter-overrides ImageTag=$(git rev-parse HEAD) DesiredCount=0 --no-execute-changeset
   ```

   The first deployment creates the ECR repository with `DesiredCount=0`; push the image (`aws ecr get-login-password | docker login …`, `docker push`), then continue.

4. **Changes the v2 database.** Migrations and logins, as a one-off task in the VPC:

   ```sh
   aws ecs run-task --profile statarena --region us-east-2 --cluster vega-v2 --launch-type FARGATE --task-definition vega-v2-migrate --network-configuration 'awsvpcConfiguration={subnets=[subnet-0233a9567335f56ce],securityGroups=[<WorkerSecurityGroup>],assignPublicIp=ENABLED}'
   ```

   Its log line `migrations applied=N total=M logins=…` must show 15 migrations (17 with `V2_VECTOR=1`).

5. **Changes AWS.** Start the worker: redeploy the worker stack with `DesiredCount=1`. It plans every minute, collects, and recalculates. Watch `/ecs/vega-v2-worker` and, from the API once deployed, the `ops.v_freshness` and `ops.v_backlog` views.

6. **Changes AWS.** Backfill (days, stops by itself when the backfill lane is empty): `aws ecs run-task … --task-definition vega-v2-backfill` with the same network configuration.

   **Changes the v2 database.** Historical archives (1871/1872 to 2020/2021): redeploy the worker stack with `ArchiveSourcesBucket=<main's data bucket>` (the task role may only read `data/sources/openfootball/`, `engsoccerdata/` and `worldclub/` there), then `aws ecs run-task … --task-definition vega-v2-archives` with the same network configuration. It runs main's archive builders and `shared/archive.js` on those pinned files and replaces each archive season; running it again changes nothing unless the sources changed.

7. **Changes AWS.** Read API. Build the ZIP, upload it to the existing release bucket under `releases/v2-api/`, then create the stack with the read URL as a NoEcho parameter passed from a mode-0600 file (as the current backend does):

   ```sh
   python3 infra/aws-v2/package_api.py /tmp/vega-v2-api-releases
   aws s3 cp /tmp/vega-v2-api-releases/<sha256>.zip s3://statarena-backend-releases-361769570630-us-east-2/releases/v2-api/<sha256>.zip --profile statarena
   aws cloudformation deploy --profile statarena --region us-east-2 --stack-name vega-v2-api --template-file infra/aws-v2/api.yaml --capabilities CAPABILITY_IAM --parameter-overrides ReleaseKey=releases/v2-api/<sha256>.zip ReadDatabaseUrl=<from file> --no-execute-changeset
   ```

   The account runs at most 10 Lambdas concurrently and the current API needs them: keep `ReservedConcurrency=0` and pool size 1 until the quota is raised.

8. **Changes AWS.** Media map. The distribution's domain is known only once the stack exists: redeploy `vega-v2-api` with `MediaBaseUrl=https://<ApiOrigin domain>/` (same other parameters). Until then `media=1` answers with an empty `media` map and the site shows the provider images, as it does today for an image not yet copied.

## Parity and cutover

`v2/api/parity.mjs` reads the same paths from both APIs and lists every difference (publication metadata excepted):

```sh
node v2/api/parity.mjs --legacy https://d317dq37z1tacb.cloudfront.net --v2 https://<vega-v2-api distribution> paths.txt
```

Cutover goes route family by route family, only once its parity is clean and the backfill covers its seasons: in the current distribution (`infra/aws-backend/backend.yaml`), add the v2 Function URL as a second origin (with its own OAC) and one cache behavior per path pattern served by v2 (today `/api/read/home*`, `/api/read/clubs*`, `/api/read/players*`, `/api/read/player*`, `/api/read/club*`, `/api/read/performance*`, `/api/read/discipline*`, `/api/fixtures*`, `/api/matches/*`, `/api/standings*`, `/api/matchdays*`, `/api/search*`, `/api/read/archive*`, `/api/archives/index*`, `/api/rankings/*`, `/api/club-links*`, `/api/club-wikidata*`, `/api/coach-portrait*`, `/api/stadium*`, `/api/open-cups*`, `/api/openligadb*`, `/api/nations-results*`, `/api/cup-snapshot*`, and `data/sources/v2/*` for the image copies). Rolling back a family is removing its behavior. The manifest stays on the current API until every compact read is on v2; `/api/dashboard/manifest` on v2 already says which reads it serves (`capabilities.compactReads`). The GitHub ingestion workflows stop only at the end.

## Cost (on-demand, us-east-2, before free tier; check in the AWS pricing calculator)

| Item | Approx. per month |
|---|---|
| RDS `db.t4g.micro` single-AZ | ~$12 |
| gp3 20 GB, backups within the free allocation | ~$2.5 |
| Secrets Manager (managed master secret) | $0.40 |
| Fargate ARM 0.25 vCPU / 0.5 GB, always on | ~$7 |
| Public IPv4 of the worker task | ~$3.6 |
| ECR, CloudWatch Logs (30 days), Lambda, CloudFront, S3 image copies (a few GB) | usage-based, a few dollars |
| **Total** | **≈ $25–30** |

The backfill task costs the same rate as the worker while it runs. No NAT gateway, load balancer, provisioned concurrency or reserved instance.

## Rollback

Each stack is independent. Setting `DesiredCount=0` stops the worker without data loss. Deleting `vega-v2-database` is refused while deletion protection is on, and leaves a final snapshot when it is off. Nothing here touches the current production path.

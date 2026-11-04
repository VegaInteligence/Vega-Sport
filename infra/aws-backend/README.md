# StatArena AWS backend

A dedicated CloudFront distribution signs requests to a private Lambda Function URL. The Node 24 ARM function handles the existing Web Request/Response application, inside the three existing RDS VPC subnets. No NAT, API Gateway, RDS proxy, SSM/Secrets Manager endpoint, new database, restart or public database rule is needed. The only change touching an existing network resource is a separate inbound TCP 5432 rule granting the new Lambda SG access to the existing RDS SG. The function SG permits only outbound 5432 to that SG. No S3 credentials or S3 read permissions are granted to the application. The existing public asset distribution remains entirely separate.

## Release commands

From the repository root with the locked dashboard dependencies installed (`cd dashboard && bun install --frozen-lockfile`), Bun, Python 3.9+, AWS CLI v2 and Node 24 on PATH. Set `BUILD_NODE` to the Node 24 executable if `node` refers to another version. Account 361769570630, region us-east-2, AWS CLI profile statarena. The helper checks account, RDS network identity, resource ownership tags, and the current account limit before deployment. Example:

```sh
export PYTHONDONTWRITEBYTECODE=1
node infra/aws-backend/transport-e2e.mjs
python3 infra/aws-backend/release.py dry-run
python3 infra/aws-backend/package.py /tmp/statarena-backend-releases
```

Dry run is read-only against AWS. It validates both CloudFormation templates, checks infrastructure identity, builds the ZIP, and runs the actual packaged app's offline invalid-asset request. The output of package.py is a SHA-256-named ZIP. Validate the relational application and largest production responses before selecting that exact artifact. The dry run does not prove Lambda OAC, VPC, RDS credentials, IAM write permission, data parity, quotas for CloudFront, or public deployment.

The following commands **change AWS**. Bootstrap creates a separate retained, encrypted, private S3 release bucket. Prepare uploads only this exact code ZIP, then creates an unexecuted CloudFormation change set; it prints a sanitized resource list. Replace the sample placeholder paths/names with those printed by the preceding commands. Deploying the stack makes a new public read API available; switching the browser origin is a separate release.

```sh
python3 infra/aws-backend/release.py bootstrap
python3 infra/aws-backend/release.py prepare /tmp/statarena-backend-releases/<full-sha256>.zip
python3 infra/aws-backend/release.py execute release-<UTC-timestamp>-<sha12>
python3 infra/aws-backend/release.py status
```

The URL is deliberately inaccessible without a signature even while CloudFront is being created. Wait for CREATE_COMPLETE or UPDATE_COMPLETE and for its distribution to be Deployed. Test the returned public ApiOrigin, never the friend's asset distribution. Use a real stable endpoint that returns ETag and positive s-maxage:

```sh
python3 infra/aws-backend/public-smoke.py '/actual-cacheable-api-path?actual=query' /tmp/statarena-public-smoke.json
```

The smoke checks unsigned origin rejection, public health, GET/HEAD/304, CORS preflight, repeat CDN hit, body hash and unsupported methods. It records actual status, elapsed time, edge request IDs, relevant headers and expectations. In addition, validate source data, browser direct requests across production routes, SQL/pool load, migration parity, and body/edge freshness ceilings using the project's relational acceptance suite. No public smoke run before creation constitutes production acceptance. For an app rollback, prepare the previously verified ZIP and review/execute its new change set. This does not roll back a database schema. Disable or redirect frontend traffic independently if acceptance fails; no RDS deletion or restore is part of this rollout.

## Operational constraints

- Existing SSM SecureString `/statarena/app/rds-runtime` must contain the expected host, database (`statarena_prod`), username and password. The operator reads it just in time, constructs a percent-encoded database URL, passes a mode-0600 file through a mode-0700 temporary directory to a NoEcho CFN parameter, and removes it on exit. Never use CLI debug, CLI history recording, shell tracing or print complete Lambda/CloudFormation configurations. Lambda encrypts environment variables at rest; operators with authorized GetFunctionConfiguration access can still read the runtime URL. A changed SSM password requires a fresh deployment. SSM is not accessed from the VPC. The public regional CA is bundled and loaded before the application imports; never disable certificate verification.
- The target AWS account currently caps total regional concurrent Lambda executions at ten. AWS requires leaving 100 unreserved to set an explicit reservation. Pool size one per execution environment bounds active concurrent database work to the current quota; frozen/replaced environments can retain idle DB connections beyond ten, so monitor actual sessions, idle timeouts and cold starts. A future automatic quota increase changes this bound even without a new deployment. Monitor the regional quota and DB connection count; before traffic growth set an explicit reserved maximum in the stack and adapt the preflight. No paid quota/plan change is requested.
- CloudFront caches by path, all query parameters, normalized content codings and no cookies. Min/default TTL zero respects origin no-store and s-maxage; edge TTL caps at 60 seconds. Origin stale-if-error=0 prevents stale fallback after expiration; error-cache TTL zero. The origin sets max-age=0/must-revalidate for mutable browser results or no-store for transient/error states; the viewer headers policy deliberately preserves that distinction and exposes validators to cross-origin clients. The distribution accepts GET, HEAD and OPTIONS only. Origin health/errors are not cached if the application returns no-store. Do not enable caching of dirty/partial partition results. For stable committed versions use distinct version queries, not arbitrary cache-busting.
- Function URL uses buffered payloads; the limit applies to the entire serialized response including header JSON, escaping and base64. Gzip is negotiated for text/JSON >=1KiB; an existing gzip body is passed byte for byte. Oversized bodies get 502/no-store and are never truncated. Keep bounded relational pages below 1–2 MiB before compression; audit legacy routes for oversized payloads before cutover. Do not use streaming as an assumed escape from the buffered limit for this VPC design.
- Deployment principal requires AWS CloudFormation change-set/create/update/describe/execute/wait access, SSM GetParameter/KMS decrypt if applicable, scoped S3 bucket + object/policy/encryption/ownership operations, EC2 describe/network and SG operations, Lambda function/URL/resource-policy operations, CloudFront distribution/cache/origin/response-policy/OAC operations, logs group/retention operations, IAM role/policy/tag/PassRole permissions. The service's deploy role is distinct from the runtime role. Runtime IAM permits only logging and Lambda-managed network interfaces; it explicitly denies EC2 API use by function code. The application must separately enforce read-only SQL/least privilege and choose only the normalized serving schema. No table creation, backfill, privilege grant, data writer or database config is present in this stack.
- Costs are usage-based Lambda, CloudFront, logs, private release ZIP storage and existing RDS. No provisioned concurrency, NAT, load balancer, monthly paid CloudFront plan or database instance purchase. The stack does not attach a billing contract or change free-tier status; AWS can charge beyond allowances.

CloudFront [Lambda OAC and both scoped permissions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html), [CloudFormation permission conditions](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-permission.html), [conditional reads and error expiry](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html); Lambda [Function URL payload format](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html), [managed Node runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html), [buffered/streamed limits and VPC restrictions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html), [regional concurrency reservation rules](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html).

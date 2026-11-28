# PannaData fixture index refresh

The macOS workflow is off unless the repository variable `PANNA_DAILY_ENABLED` is explicitly set to `true`. Manual preflight needs no AWS permissions. It reports the source pin and cutoff without opening a database connection. The scheduled job and manual refresh cover only `opta_fixtures.parquet` and use the same ingestion lock and ledger as the fixture loader. This run does not publish canonical facts, load events or cover the full PannaData catalog.

## Deploy after review

- Apply Panna migration 005. Create the `vega_panna_fixture_daily` login with one connection, no memberships and no elevated privileges, then apply `fixture-login-grants.sql`. Put the credential in the exact SSM parameter named in the IAM policy. Its DSN must target the private RDS host with `sslmode=verify-full`. Scope CMK permissions to this parameter if needed.
- Deploy `bridge.yml` with the private RDS endpoint, approved ARM64 image digest and existing ECR execution role. Use the existing approved network route for RDS and AWS control plane. The bridge runs for at most 30 minutes and receives only the PostgreSQL stream.
- Package `launcher.py` as `launcher.handler` in a Lambda ZIP with only this file, Python 3.12 or later, 100-second timeout and reserved concurrency of one. Name it `vega-v2-panna-daily-launcher` and point the `live` alias at the reviewed version. Set `TASK_DEFINITION` to the exact task revision and `BRIDGE_NETWORK` to the reviewed ECS awsvpc configuration. Fill the three exact ARN placeholders in the Lambda policy. The OIDC role calls the alias and has no direct ECS launch permission.
- Create the main-only `v2-panna-refresh` environment, set `PANNA_REFRESH_ROLE_ARN`, `PANNA_BRIDGE_LAUNCHER` and `PANNA_RDS_HOST` there, and apply the exact WebIdentity trust and GitHub permission policies. Leave the repository enable variable unset during provisioning and preflight.
- Exercise the dedicated OIDC and SSM path against a scoped environment before setting the enable variable for production. Confirm the correct bridge/document can start a TLS session and the same role cannot run other tasks, start sessions on ordinary tasks, choose another destination or use a shell document. Check cleanup after cancellation and hard runner loss. A no-task result is an observation, while the container TTL independently bounds the lifetime.

On a validation target, dispatch a refresh with a pinned source generation, capture the RDS run receipt and read back the resulting counts. Replay with the same generation and as-of date and expect zero new data rows. Observe the first automatic run while the operator's Mac is offline. No production workflow activation or cloud smoke has been performed.

## Local verification

Run `PYTHONPATH=backend python infra/aws/panna/daily.py` from the repository root after installing `backend/panna/requirements.txt`. A frozen manifest can be passed to preflight with `--manifest`. For a manifest containing no assets, expect exit 1 and `ASSET_MISSING`. For the recorded 27-field release generation, the probe found 111,584 eligible, 152,507 historical and 6,104 deferred fixtures at 2026-11-28. Local PostgreSQL 18.3 verification with the dedicated SQL grants found 111,584 base rows and 5,547 extension rows, with zero writes on replay. Hosted runtime, IAM scope and scheduling remain to be verified.

The refresh uses 10,000-row chunks, a 420-second loader budget, and periodic RDS storage and CPU guards. The 1 GiB storage allowance is an initial proposal pending target measurements. The fixture CLI does not enforce a per-second row rate. Keep larger and unsupported assets outside this job until their loaders and runtime bounds are verified.

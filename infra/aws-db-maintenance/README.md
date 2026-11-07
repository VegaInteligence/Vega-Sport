# Private database migration worker

This temporary Lambda runs reviewed SQL inside the existing private database
network. It has no HTTP endpoint and requires an authenticated IAM invocation.
Delete its CloudFormation stack and the restored validation database after the
verified rollout. Retain the pre-migration snapshot and operation receipts.

The ordinary stage/read-only worker accepts only an operation name, its SHA-256 digest and bounded bind
values. SQL, credentials, database endpoints and roles cannot be supplied by an
invocation. The SQL manifest is bundled into an immutable, content-addressed
release. Every operation names its allowed target (`stage`, `prod`), mode,
parameter count, statement timeout and maximum result count. Production writes
also require the explicit `AllowWrites` stack setting. Read operations use a
read-only transaction even on a worker enabled for writes.

Database configuration comes from the existing secure deployment mechanism via
a `NoEcho` CloudFormation parameter. The database name, expected hostname and
existing role are verified before connecting, and TLS verifies the RDS CA and
hostname. Do not save secrets or signed upload URLs in operation manifests,
receipts, commits or logs.

## One-time administrator bootstrap

The separate `bootstrap.mjs` entry point is restricted to the reviewed
`bootstrap-consolidation` operation on the exact production host. Use it only
when the read-only privilege preflight proves that the migration namespaces or
`pg_trgm` are missing and the ingestion role cannot create them. Its manifest
contains no general query or migration operations.

Build it with `package.py OPERATIONS.json RELEASE_DIRECTORY --bootstrap` and use
a separate `vega-db-refactor-bootstrap-YYYYMMDD` stack. `DatabaseConfig` contains
only host, database and the fixed administrator username; a password in this
configuration is rejected. The authorized operator obtains the existing secret
just before the IAM invocation and passes it only as the invocation's `password`
field. Never print or save the invocation payload. The handler accepts no SQL,
endpoint, role or bind values from the invocation; it acquires the publication
lease, performs the fixed bootstrap in a transaction, returns a small receipt,
and clears its credential references. There is no HTTP URL, SSM permission or
credential in the Lambda environment or CloudFormation parameters. Delete this
separate stack immediately after verifying the prerequisite schemas and grants.

The ordinary migration worker's interface remains unchanged: it never accepts
invocation-supplied credentials, endpoints, roles or SQL. All subsequent
publication and consolidation operations use the existing ingestion role.

## Expiring production ingestion

Use the separate `transient-ingest.mjs` entrypoint for privileged production
maintenance. Build with `--transient-ingest` and create a temporary
`vega-db-refactor-ingest-YYYYMMDD` stack. Its database configuration contains only
the fixed production hostname, port 5432, `statarena_prod` and username
`statarena_ingest`. A password in that configuration is rejected. Keep the
ordinary production runtime worker read-only; its configuration need not change.

The manifest has format `vega.transient-ingest.v1`, absolute `issuedAt` and
`expiresAt` timestamps, and the reviewed operation map. Its validity must be
positive and no longer than four hours. Packaging rejects invalid, future or
expired windows; the deployed handler independently checks the immutable
window on every invocation. Targets must be exactly `["prod"]`. The admin-only
bootstrap and schema-authorization operations cannot enter this release.

The IAM-authorized operator obtains the existing ingestion credential just
before invocation and supplies it in the `password` field, alongside the fixed
operation name, its digest and bounded bind values. Construct this payload only
in memory; do not print it, write it to an invocation file or place its password
in an environment variable. The handler verifies the actual database/user after
connecting. It passes connection data explicitly to the common maintenance
engine; it never puts the credential in `process.env`.

The common engine preserves the existing migration journal, publication leases,
bounded copy/verification checkpoints and explicit cutover/rollback operations.
Transient work has a 45-second total query budget and also stops before release
expiry. Every database statement receives a bounded server and client timeout;
archive refresh and VACUUM use the same expiry guard. An expired transaction
cannot begin a new batch or commit. Cleanup can still roll back and release a
session lease after expiry. Responses omit database error messages, and client,
connection and invocation password references are cleared when the call ends.

`worker.yaml` gives this separate function no SSM access, HTTP endpoint or public
function URL. Its environment and CloudFormation parameters hold metadata only.
The explicit `AllowWrites` flag is still required for write operations; expiry
is enforced independently of that flag. Extending the window requires a freshly
reviewed manifest and new content-addressed release. After the operation window,
delete the temporary stack and retain only password-free receipts and hashes.

## Expiring administrator transfer operations

The independent `admin-transfers.mjs` entrypoint uses the same metadata-only
configuration and transient credential pattern with the existing
`statarena_admin` role. Build with `--transient-admin-transfers`, manifest format
`vega.transient-admin-transfers.v1` and the same four-hour maximum window. Use a
separate `vega-db-refactor-admin-transfers-YYYYMMDD` stack and delete it after the
verified owner batch. This does not widen the bootstrap handler's single action.

Only four literal SQL operations are accepted: `transfer-owner-preflight` with
an explicit boolean; `transfer-authorize` with exactly the two reviewed owners;
`transfer-archive` with the original admin-owned preflight; and
`transfer-rollback` with its exact archival receipt. The administrator batch is
limited to `neon_delta_documents` and `neon_delta_queue`. Preflight performs no
archive or authorization automatically. Review and retain its canonical JSON,
then explicitly pass that unmodified receipt to a separate write invocation.
The 026 functions recheck counts, object identities, ACLs, catalogue fingerprints
and blockers under locks; the handler never refreshes a stale receipt to make
it pass. The remaining eight tables use their existing ingestion owner.

## Build and review

Install the repository's dashboard dependencies and make Bun and Node available.
Build a supplied, reviewed manifest:

```bash
python3 infra/aws-db-maintenance/package.py OPERATIONS.json RELEASE_DIRECTORY
```

The output names the ZIP by the SHA-256 of its bytes and returns the per-operation
digests. Upload those exact bytes to the private release bucket, verify the S3
checksum and update `ReleaseKey`. Check Lambda's `CodeSha256`, update status and
configured target before invoking an operation. Never print the secret-bearing
environment or stack parameter values when checking a deployment.

An operation entry has this shape:

```json
{
  "sql": "SELECT current_database() AS database, current_user AS role",
  "values": [],
  "parameters": 0,
  "mode": "read",
  "targets": ["stage", "prod"],
  "timeoutMs": 5000,
  "maxRows": 1
}
```

Wrap entries in `{"version":1,"operations":{"identity":OPERATION}}`. A migration
operation also supplies `migration: {version: "NNN_name.sql", digest: "SHA256"}`.
The worker takes the existing publisher advisory lease, verifies the exact SQL
digest and records it in `statarena_app.worker_schema` in the same transaction.
An already-applied matching migration is a no-op; a changed digest is an error.

Only resumable migration functions returning `progress.complete` may use
`repeat: "progress.complete"`. Each batch commits separately, and the worker
stops starting repeat batches after 35 seconds, with a 45-second total query
budget. This also keeps the response inside an AWS client's 60-second read
timeout, preventing overlapping transport retries. A failure reports the number
of committed batches; retrying uses the database-owned checkpoint. Reads and
migrations cannot use this repeat mode. Invocation success requires the JSON
response's `ok` field, not merely Lambda's HTTP status.

## Preserve receipt JSON exactly

Replay approval and rollback receipts from the canonical Lambda response JSON.
Some API-tool structured envelopes omit null-valued object fields; for example,
an ACL of `null` can disappear when a receipt is reconstructed from that envelope.
The archive preflight correctly rejects that changed receipt. Keep the raw JSON
response as a string, or pass the parsed native receipt between operations inside
one invocation script without round-tripping it through the tool envelope. Save
the canonical JSON with every explicit null intact. Do not remove receipt fields,
invent replacement ACLs, or weaken the database's exact equality checks to make a
transport-altered receipt pass.

## Profiling the actual application SQL

```bash
node infra/aws-db-maintenance/capture-reads.mjs REPO OUTPUT.json LABEL
```

This intercepts the backend's injected SQL reader without opening a connection
and emits fixed `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` operations. An optional
`VEGA_MANIFEST_PATH` points to a saved public manifest for the real default
European player-directory scope. Review the generated operations before adding
them to a deployment manifest. Capture a fixed deployed checkout for baseline
comparisons and the candidate checkout for the new plans.

Use the database procedure in
[DB_REFACTOR_OPERATIONS.md](../../dashboard/scripts/DB_REFACTOR_OPERATIONS.md) for
full-copy, parity, activation and reverse-copy rollback. The worker is transport
for that procedure; it does not replace its integrity or acceptance gates.

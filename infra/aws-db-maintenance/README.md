# Private database migration worker

This temporary Lambda runs reviewed SQL inside the existing private database
network. It has no HTTP endpoint and requires an authenticated IAM invocation.
Delete its CloudFormation stack and the restored validation database after the
verified rollout. Retain the pre-migration snapshot and operation receipts.

The worker accepts only an operation name, its SHA-256 digest and bounded bind
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

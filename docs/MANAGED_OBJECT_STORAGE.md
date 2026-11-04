# AWS migration preparation

This branch prepares the migration; it is not a record of a completed cutover. Keep the production catalog and football data in Neon until the destination and application have been verified.

## Architecture

- PostgreSQL 18 on Amazon RDS holds the existing `statarena` schema, catalog and indexed projections. The browser never connects to it directly.
- `statarena.current_file_documents` exposes indexed JSON, JSONL, CSV, text, SQLite rows and structured archive members as `jsonb`. The original S3 bytes are retained. The view joins source checksums so an older version cannot be served as current. Images and other binary files retain their searchable metadata in `statarena.objects`.
- Original files remain under their existing `data/...` keys in a private S3 bucket. Runtime credentials need only read access; collectors need read/write access.
- A CloudFront distribution with origin access control reads the private bucket. Associate `dashboard/scripts/cloudfront-public-files.js` with the viewer-request event and the AWS managed `CORS-and-SecurityHeadersPolicy`. The function exposes only the same content-addressed public paths handled by the application.
- After verification, set `STATARENA_EXTERNAL_STORAGE=1` and `STATARENA_CLOUDFRONT_URL=https://<distribution>.cloudfront.net`. Immutable file GETs redirect to CloudFront with `no-store`; mutable files and API responses retain their existing handling. CloudFront and browser caches can retain the immutable target. Vercel bandwidth still applies to HTML, API responses and files that remain proxied.
- Keep the existing `NEON_DATABASE_URL` and `NEON_STORAGE_*` variable names for compatibility, but point them to RDS and the new S3 bucket. `STATARENA_DATABASE_CA_PEM` must contain the RDS regional root bundle for the Vercel runtime; hostname and certificate verification remain enabled. GitHub ingestion workflows use the bundled Ohio RDS CA when external storage is enabled. The connection URLs for Python and PostgreSQL tools must specify `sslmode=verify-full`.
- Set `STATARENA_SQL_DOCUMENTS=1` for the AWS collectors after the document schema is installed. A changed structured file updates its catalog row and SQL documents in one database transaction. A managed backfill indexes existing files and records parse errors for review.

The CloudFront Pro flat-rate plan is an explicit subscription; creating a distribution alone does not activate it. Wait for the plan to be active before sending production traffic. Confirm its CORS response and private-bucket origin access using an actual browser and the AWS console before enabling redirects.

## Copy and verification

1. Check that the source database and object storage are readable.
2. Provision and verify RDS PostgreSQL 18 and a private S3 bucket in `us-east-2`. Use separate read and write roles, a tested TLS connection and an appropriate connection strategy for Vercel. Ensure the AWS writer can list, read and write the destination bucket: without `ListBucket`, AWS may return 403 for missing keys.
3. Stop concurrent publishers for the final sync. Export PostgreSQL using version 18 client tools and a direct Neon connection, restore without source ownership or grants, then recreate the application roles. Compare row counts, schema/indexes, key references and selected query results. Do not put credentials in commands, logs, commits or reports.
4. Run `dashboard/scripts/copy_object_storage.py` with a source read-only `NEON_DATABASE_URL`, `SOURCE_STORAGE_ENDPOINT`, `SOURCE_STORAGE_BUCKET`, `SOURCE_STORAGE_REGION`, `SOURCE_STORAGE_ACCESS_KEY_ID`, `SOURCE_STORAGE_SECRET_ACCESS_KEY` and corresponding `TARGET_STORAGE_*` values. Set `TARGET_STORAGE_PATH_STYLE=0` for standard virtual-hosted S3 access. It checks the source size and SHA-256, uploads each original key, reads it back and checks size and SHA-256. Reruns skip objects already matching. `--verify-only` performs a destination verification.
5. With publishers still stopped, rerun the copy and catalog verification against the final source snapshot. Test a browser through CloudFront, direct S3 denial, mutable-file reads, TLS and representative site/API queries. Then switch the Vercel runtime and all GitHub ingestion secrets and variables together. Restart the scheduled workflows and verify both reads and writes on the destination.
6. Retain Neon and its data until the completed copy, application, collectors and rollback path are checked. Cancel temporary paid services only after the migration is complete and their remaining billing terms are verified.

Recount the source before migration. One destination PUT plus verification reads is needed for each file; retries and request charges are additional.

Neon retains its default ingestion limits of 900 MB SQL and 4.75 GB objects. External storage has no inherited Neon limits; set `STATARENA_SQL_LIMIT_BYTES` to a suitable threshold for provisioned RDS capacity, leaving room for indexes, maintenance and growth. Optionally set `STATARENA_OBJECT_LIMIT_BYTES` if an object-storage limit is desired.

## Example SQL

```sql
-- Matches involving a club, using the existing structured fixture data.
SELECT id, day, body->'home_team' AS home_team, body->'away_team' AS away_team
FROM statarena.fixtures
WHERE body->'home_team'->>'id' = 't_example'
   OR body->'away_team'->>'id' = 't_example';

-- Content of a specific JSON or CSV file (archive members have virtual paths).
SELECT document_path, format, document
FROM statarena.current_file_documents
WHERE source_path = 'raw/example.json.gz';
```

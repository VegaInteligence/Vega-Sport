# StatArena data in Neon

The application reads football records only through its same-origin backend. PostgreSQL provides indexed object metadata, endpoint responses, fixture selectors and small supplemental projections. Private Neon Object Storage contains the original `data/raw`, `data/computed` and `data/sources` tree and newly ingested objects. No data directory is needed to build or run the application.

## Runtime

Configure the variables in `dashboard/.env.example` on the server. Use the pooled `statarena_runtime` connection and the read-only storage credential; never use the ingestion role or a Pitch key on Vercel. The `/api/pitchapi/...` path is a compatibility URL served from Neon; it performs no upstream provider requests. Images, including homepage SVG logos, pass through `/api/assets` and read private Neon objects.

The runtime has a three-connection pool, statement/query timeouts, bounded caches, coalesced concurrent loads, SHA-256 verification, HTTP ETags and immutable caching for content-addressed files. Mutable indexes have short cache lifetimes. Vercel functions run in `cle1`, near the Neon database in Ohio. Missing data yields a recorded unavailable response; no disk, GitHub or provider fallback exists.

Maps and interactive official stadium embeds retain their existing external rendering services. Their football/stadium metadata and image previews come from Neon.

## Ingestion

Only the Daily Sync and Historical Backfill workflows collect provider data. They need `PITCHAPI_API_KEY`, `NEON_INGEST_DATABASE_URL` (direct writer connection), `NEON_STORAGE_ENDPOINT`, `NEON_INGEST_STORAGE_ACCESS_KEY_ID` and `NEON_INGEST_STORAGE_SECRET_ACCESS_KEY` in GitHub secrets. Runtime and ingestion credentials are distinct.

Unique `(endpoint, params)` and fixture IDs prevent logical duplicates. Identical payloads share content-addressed objects. Historical jobs reuse existing archived observations and discover their dependent resources before making new API requests. Leases resume interruptions; a PostgreSQL advisory lock and shared Actions concurrency serialize collection and publication. 403/404 responses are recorded and skipped, 401 stops collection, and 429/5xx have bounded retries. An unavailable new response cannot overwrite a previously successful response. Incremental normalization retains existing successful observations and publishes catalog/manifests atomically. Previous mutable manifests are retained as versioned objects.

`statarena.state` stores current run receipts and discovery cursors. `ingest_failures` records gaps; `jobs` contains outstanding work. `dirty_partitions` tracks views awaiting publication. Collection pauses before configured SQL/object capacity limits rather than deleting source data. Completion of a bounded run does not establish exhaustive worldwide coverage.

Supplemental results, standings, club and stadium facts are refreshed in Actions and stored as projections. Unresolved identities and source refusals stay unavailable. External image failures remain queued for later retry.

Daily Sync runs a full refresh at 22:35 UTC and a shorter morning refresh at 06:10 UTC. The latter discovers matches across all leagues and refreshes games kicked off between 14 hours and 135 minutes earlier; finished fixtures without a usable kickoff are retried when dated the previous day. This window covers the observed late MLS kickoffs while avoiding a second full inventory and prioritizing match and player data over ancillary endpoints. Supplemental records and honours remain on the full daily run. Both refreshes retry observations from previous runs even if they are less than six hours old and publish changed MLS and Saudi Pro League partitions before the general recent queue. GitHub Actions may delay a scheduled run, and newly scored goals can only be published after the upstream provider has supplied them.

Historical Backfill is scheduled at 00:15, 06:50, 12:15 and 18:15 UTC. The 18:15 run collects for at most 210 minutes, leaving time for publication and images before the full refresh. These buffers reduce contention but cannot guarantee that a delayed or long-running job will finish before the next refresh; all ingestion runs share a queue and retain their unfinished work.

Historical Backfill accepts an optional `priority_league` provider ID. It collects the indexed finished fixtures for that competition, starting with the newest season and match/player data, then publishes that league's changed partitions. The Saudi Pro League uses `l_0Lpz1f`; other leagues remain in the ordinary queue.

MLS (`l_0eg6C9`) uses calendar-year seasons such as `2026`. The dashboard groups those records in `2026/2027`; materialization publishes a fixture-query alias for that bucket using the original fixture rows, while preserving their native season values.

## Verification

With read-only production variables configured, run:

```sh
cd dashboard
bun run build
bun run verify
```

This launches the production server on an ephemeral port, performs HTTP E2E checks, and saves `outputs/neon-runtime/http-e2e.json` and `server.log`. Browser checks use `playwright-cli run-code --filename dashboard/scripts/verify_neon_browser.js` and `verify_neon_interactions.js` after opening the target origin.

For ingestion verification, create an isolated Neon branch with its private branch storage and writer credentials; run `verify_neon_ingestion.py` against a controlled local HTTP provider. Never point this fixture test at production. Set `NEON_TEST_BRANCH_ID`, and mark only the test database with `INSERT INTO statarena.state(name,value) VALUES ('validation_branch', 'true') ON CONFLICT(name) DO UPDATE SET value=excluded.value`. The test checks this marker and the matching branch storage endpoint before mutations, and retains a reproducible report.

Migration setup, complete catalog checks, EXPLAIN plans, outcomes, source hashes and cleanup receipts are in `docs/verification/neon-runtime-20261103/`. Source inventory backups are in private `data/raw/neon/migration-20261103/`. Additional local staging/collector files were backed up at their original keys; older local versions use `data/raw/neon/local-backup-20261103/` so the canonical source remains intact.

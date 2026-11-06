# Incremental publication and the first schema consolidation

This code targets the active `statarena_app` public read models. It does not enable
the separate Pro API, retire a source table, delete the ingestion backlog, or
change the collection schedules. Migrations 021 and 022 are additive.

## Core publication

`relational_core_delta.py` compares complete typed projections of each match with
the currently published partition. Every persisted core child, member order,
player identity, metric value and native scalar discriminator participates in
the comparison. Numeric equivalence is used only for fields already stored as
PostgreSQL `double precision`. Native shirt/position/raw-stat types stay distinct.

Only changed matches replace their derived children. Unchanged match,
appearance and fixture tuples remain in place. Newly absent matches/fixtures are
removed only within the supplied complete season/competition snapshot, matching
the prior full publisher's semantics. Cross-partition identity moves fail and
remain queued; they require an explicit coordinated publication.

Write envelopes are independent of season size:

- at most 32 changed matches and 4 MiB of typed JSON per match batch;
- at most 500 rows and 512 KiB of encoded input per core insert;
- at most 60,000 bound parameters per core insert;
- an oversized individual row or match fails without truncating its values.

Core inserts use bounded multi-row `INSERT` statements rather than creating and
copying a temporary table for each small delta. The separate native detail writer
keeps its existing bounded COPY protocol. This change reduces setup round trips
for small corrections; it does not claim a measured production latency gain.

All batches of one partition, metadata, source receipts, source-consumption
markers and publication generation share one transaction. A failure after an
earlier batch rolls back the entire partition. A new collection timestamp alone
uses the existing metadata-only receipt path; the public digest stays SHA-256
with its historical format. A re-read also recognizes unchanged typed facts
when that receipt is unavailable. The old full algorithm remains selectable
with `STATARENA_INCREMENTAL_CORE=0` as a code rollback; its writes now use the same
bounded insert helper.

This bounds SQL statement work, not the total elapsed duration or memory of a
partition. Source discovery and partition reconstruction still read the relevant
source inventory/current partition. Production timing, EXPLAIN plans and native
PostgreSQL transport must be checked after a permitted rollout. A heavy initial
backfill still performs more work than a one-match correction.

## Retry checkpoints

Migration 022 adds attempts, next/last attempt, safe error code and source stamp
to the existing `publication_jobs` table. A failed partition rolls back, remains
queued, and is deferred for 5 minutes, then exponentially up to 6 hours. It is
attempted at most once during the same worker run. The worker proceeds to other
eligible partitions and reports failed/deferred counts. Its process exits with
failure if any partition failed, even when independent partitions succeeded.

An unchanged source stamp preserves backoff; a new source or dirty watermark
resets it. Conditional updates cannot defer or consume a newer queued revision.
Only an exception class or SQLSTATE is stored, never a provider payload. A lost
connection aborts the process; an unavailable connection cannot safely write a
retry checkpoint. Catalog or global-source failures remain visible and are
retried by the next run using the existing receipts.

## Collection workflow

Daily 22:35 UTC and pulse 06:10 UTC schedules are retained. Optional supplemental,
honours, portrait and image steps have five-minute bounds and cannot prevent
publication of already committed source records. Optional failures are reported
after publication, so the job does not silently appear healthy. Publication is
also attempted after a partially failed collector when credentials were loaded.

Within the existing 330-minute job, collection is capped at 240 minutes; daily
and pulse defaults remain 60 and 25 minutes. Historical defaults to 240 minutes.
The final publisher gets a 45-minute budget and a 60-minute step cap, leaving
time for optional steps and setup. This reserves a publication opportunity after
source discovery; it does not increase the database statement timeout.
The separate manual publication workflow validates its budget at 1–100 minutes
inside the existing 120-minute job. Neither disabled legacy workflow is enabled
by these source changes.

## Lineup consolidation: expand, compare, switch, retain

Migration 021 creates `lineup_members`, a zero-copy `UNION ALL` view over the four
existing home/away × starter/substitute member tables. Its grain is
`(resource_id, side, role, record_no)`; order is `position` within the parent
sheet. Resource IDs retain the match, endpoint parameters, variant, source digest
and envelope/error provenance. Missing fields, explicit nulls, native values and
empty collections remain distinct. No backfill is needed for this facade and no
physical copy is made.

One member reconstruction function replaces four duplicated implementations in
the candidate public reader. The existing `detail_data_lineups` entry point is
not switched by installation. The original reader is retained as
`detail_data_lineups_legacy`; the candidate is `detail_data_lineups_unified`.
`lineup_consolidation.py` provides:

```sh
python dashboard/scripts/lineup_consolidation.py
python dashboard/scripts/lineup_consolidation.py --max-resources 500
python dashboard/scripts/lineup_consolidation.py --activate
python dashboard/scripts/lineup_consolidation.py --rollback
```

The default operation compares every resource, 128 per query, inside a
repeatable-read read-only transaction. A partial scan reports `complete=false`
and exits 2. Activation refuses a partial-scan option and repeats complete parity
under the publication lease in the same transaction as the function switch and
generation increment. Rollback restores the compatibility function; all source
tables and their contents remain present. Repeated switches to the current
wrapper are no-ops. The script accepts only the verified AWS ingestion context
or the disposable loopback test database.

The manual publication workflow's optional `lineup_reader` input exposes
`verify`, `unified` and `legacy`; its default `unchanged` leaves the public reader
alone. Use `schema_only=true` to install additive objects without processing
business data, then verify and activate in a separately reviewed run. This is
prepared code, not evidence that those steps have run on production.

This first stage simplifies the active read contract, not the physical table
count. Consolidating the four stores into one physical table, backfilling it,
comparing every resource and retiring any old table is a later, separately
validated migration. Its gates include full native-state and row/order parity,
all endpoint variants, constraints, runtime privileges, representative query
plans, write parity, replay and a tested rollback window. No DROP or destructive
contract phase is included here.

## Tests

The Python unit suites are:

```sh
PYTHONPATH=tests python -m unittest test_collection_plan test_core_delta test_publication_freshness test_tournament_publisher_aliases test_empty_year_aliases test_daily_refresh
```

With `TEST_DATABASE_URL` pointing to disposable loopback `vega_refactor_test`,
run the following SQL tests sequentially. Each creates its own application schema
and rolls back all fixtures and schema changes before exiting:

```sh
python tests/publication_metadata_postgres.py
python tests/core_delta_postgres.py
python tests/publication_retries_postgres.py
python tests/lineup_consolidation_postgres.py
```

The core test compares the old and new publishers over 70 matches, then checks a
single correction, metadata-only change, insertion, scoped removal and a failure
after the first batch. The lineup test compares 31 native response variants and
checks activation, idempotence, rollback and deliberate parity rejection. The
retry test exercises the real orchestrator with SQL checkpoints and an injected
partition failure. Local verification uses PostgreSQL 18.6 through PGlite 0.5.15;
native hosted PostgreSQL tests remain necessary for production rollout, notably
the unchanged detail COPY transport, privileges and concurrent reader behavior.

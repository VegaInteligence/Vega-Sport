# Exact archive pages at publication time

The former bounded HTTP route still reconstructed a complete results/goals season inside each cold API instance. The largest measured season, 2018/2019, transferred 8,311,565 bytes for 9,352 result matches and 15,258 goal events. Its first native query exceeded the 8-second statement budget; a warm query took 1.569 seconds. The operator receipt is `clone-route-audit-before-cutover.json`. Browser pagination alone could not remove that server work.

Migration `032_archive_read_projection.sql` adds two **derived, rebuildable** tables:

| Table | Purpose |
| --- | --- |
| `archive_read_editions` | One edition's exact whole-season summary, competition facets, merger revision and source fence. |
| `archive_read_matches` | One sorted merged match per row, normalized search fields, compact list data and that match's goal events. |

Canonical catalogue headers, records, source digests and original datasets remain unchanged. These tables bring the planned active physical publication schema from 54 to **56 tables** after the provider-store consolidation. They are distinct from the retained rollback tables and staging schemas.

## One merger and an atomic publication

`dashboard/shared/archive-projection.js` reuses `buildArchiveSeason` without changing its matching rules. The complete edition is still necessary to assign a goal group once, preserve day-offset/name matching, remove repeated events, resolve goal-only competition membership and keep the existing positional keys. This work now happens when sources change.

`publish_catalog` refreshes the affected archive editions in the same transaction as their canonical source publication. An index update refreshes only seasons whose expected-stream membership changed. Unchanged input and a matching projection retain their existing database row versions. If transformation or insertion fails, both the source change and derived rows roll back.

The fixed SQL interface lives in `dashboard/backend/services/archive-projection-model.json`. The Python publisher invokes `dashboard/scripts/archive_projection.mjs` over stdin for the pure transformation; the child process receives no database credentials and opens no database connection. The existing publisher runtime already supports Node for curated materialization.

## Public read contract

`GET /api/read/archive` keeps its existing parameters and response fields. A request reads current metadata and then at most 100 listing rows, or the first match for one positional detail key. It never invokes the full-source query, rebuilds a season, or falls back to that work after an error.

The summary and competition facets describe the entire merged edition. The pagination total describes the complete requested filter. An unfiltered count comes from the committed edition summary/facets; a text filter counts exact matches in the compact normalized search columns. The goal-player separator prevents a query from accidentally matching across two different players. Source `%` and `_` characters remain literal search characters.

The version covers merger revision, both source identities/digests/timestamps/statuses and expected source-stream membership. The bounded SQL statement verifies the live source fence again. A missing or stale projection returns 503. A stale caller-supplied version returns 409. A publication between metadata and page reads causes at most one coherent retry. A detail key is never silently remapped across versions.

Whole-edition summaries are not reconstructed from the returned page. List rows do not include all goals; a match detail returns only its own goals. HEAD/304 validates projection readiness, and detail HEAD/304 additionally verifies the first matching key and its goal availability.

## Backfill and release order

1. Install migration 032 as the existing application-schema owner and record its exact filename/SHA in the normal migration journal. Installation is additive and does not backfill or modify canonical rows.
2. Package the new publisher helper, fixed SQL model and shared merger dependencies. Keep normal publication limited to storage modes `legacy` and `active`.
3. Backfill distinct existing `archive-season` editions with the fixed maintenance operation below, one season per call. The SQL model's `list` query returns only season names. Confirm each edition is ready before activating the new public reader.
4. Verify native first-page, filtered-page and single-detail timings and payload sizes. Compare an exact full-edition merger result off the public request path when validating an existing edition. Local fixture evidence does not substitute for native cold-load measurements.
5. Deploy the bounded reader after backfill readiness. Future source publications update the projection automatically. A future merger revision requires the same explicit backfill before reader cutover.

### Fixed Node maintenance entrypoint

```js
import { refreshArchiveProjection } from "./dashboard/scripts/archive_projection.mjs";
const receipt = await refreshArchiveProjection(dedicatedClient, season, {
  maintenance: true,
});
```

The client must be a dedicated PostgreSQL client without an active transaction. The function owns BEGIN/COMMIT/ROLLBACK, validates the season, acquires publication lease `97813003` before the catalogue lock, and returns only a small receipt. Its total deadline reserves 44 seconds for work and one second for rollback. Before each fixed query or insertion batch it applies the remaining statement/read budget and a bounded lock timeout. Exhausting the budget aborts the replacement; a connection that cannot confirm rollback is closed. It accepts no SQL, filesystem path or caller-supplied source body. The operation is idempotent; `{force:true}` explicitly rebuilds an already current derived edition.

Explicit maintenance allows `legacy`, `backfill` and `active`, and rejects `rollback` and unknown modes. In a maintenance gap coordinated with the migration operator, it can prepare clone projections during backfill because it writes only the two unmapped derived tables. It checks that the complete consolidation control record is unchanged. No source header, source/compatibility relation, consolidated record store or proof checkpoint is modified.

The receipt reports season, readiness, version, changed status, exact match/goal counts and, when rebuilt, source-byte count. A source that is not completely published reports not-ready; it does not create an empty successful edition. The operator should retain the per-season receipts without returning whole source payloads through a tool response.

## Validation

`tests/relational-archives.test.mjs` compares paginated SQL results, complete filtered counts, facets and keyed detail against the original full catalogue merger. It also covers publication races, missing/stale projection rejection, source-identity/expected-stream fencing, duplicate events and cross-player search boundaries.

`tests/archive_projection_postgres.py` uses a fresh disposable loopback database. It exercises the real Python publisher and the real dedicated Node maintenance connection, including atomic rollback after an insertion failure, unchanged replay, source-header preservation, expected-stream changes and explicit maintenance-mode gates. A deadline test advances only the test process's monotonic clock after an actual inserted batch, then proves that the entire replacement rolls back to the prior rows. On native PostgreSQL the publisher uses actual COPY; only the local PGlite socket adapter substitutes INSERT transport while retaining PostgreSQL types, constraints and transactions.

The public-contract CI runner creates a separate disposable database for this fixture, because testing the maintenance entrypoint requires committed synthetic source rows. The fixture removes the schema it created and never accepts a production database address.

### Native stage canary, 7 November 2026

The reviewed stage worker (`5d1adec4ccf56e021618cd22bbac0ec4ff6e5687dca99ba93596fb2cd13d279f`) rebuilt 2018/2019 in 8.185 seconds of database work. The committed projection contains 10,219 merged matches and 15,258 goal events. Its receipt confirms that consolidation revision 582 was unchanged. This is a derived-table backfill measurement, separate from public request latency.

All ten reviewed native acceptance operations then succeeded:

| Read | PostgreSQL execution | Returned data |
| --- | ---: | --- |
| First page | 13.940 ms | 50 list rows, 16,061 bytes; exact total 10,219 and 205 pages. |
| Player-name filter | 23.521 ms | 13 matching rows; exact complete filtered total. |
| Single match detail | 2.923 ms | 709 bytes for the selected one-goal match. |
| Edition metadata | 3.235 ms | Current source fence and whole-edition summary/facets. |

The first-page, second-page and filtered-page comparisons all verified exact contents/order, complete filtered totals and page numbers against the committed merged projection. These plans ran immediately after the refresh and read zero physical blocks, so they establish native query behavior with warm database buffers, not physical-cold storage latency. End-to-end HTTP latency also includes the API connection and response work.

The operator receipts are `clone-archive-canary-refresh.json` and `clone-archive-canary-acceptance.json`. The initial inventory found 154 source editions; the canary made one ready. Remaining editions must be backfilled and their current fences verified before the new reader is activated. These receipts establish stage validation only.

## Recovery

An unsuccessful rebuild leaves the prior committed sources and projection intact. A stale projection remains unavailable until a successful refresh; the API does not display it as current. Reverting the public reader requires no canonical data rollback and no table deletion. The derived tables can be retained while diagnosing a deployment, then refreshed from unchanged canonical sources.

# Bounded player-rollup publication — 7 November 2026

## Problem and scope

RDS logs attribute the four SQLSTATE `57014` failures in scheduled publication run `42387487598` to `refresh_player_season_rollups(text,text,boolean)`: three to its cross-league ambiguity check and one to its rollup INSERT. The previous ambiguity query joined appearances to appearances and could perform a player/match bitmap lookup for every observation. A newly populated scope with stale statistics also reproduced seven nested-loop joins between per-player aggregates, even though each aggregate produces one row per player.

Migration `037_bounded_player_rollup_publication.sql` replaces only that function. Installation does not refresh data, build indexes, create tables, change grants or increase statement timeouts. The partition lock, digest fence, forced-refresh behavior and transaction boundary remain unchanged.

## Changes

The materialized source carries only fields consumed by the calculation. The aggregate expressions, filtering of null and nonfinite values, duplicate selection, identity ordering and JSON shape remain unchanged. The function disables nested-loop plans while combining the per-player aggregates. Its function-scoped setting is restored on return or failure.

The ambiguity check first selects distinct match IDs belonging to the target scope. For each match, a lateral query materializes that match's observations through the existing `app_appearances_match` index, then groups its players within the target season. An ambiguity exists only when the same player/match has observations in both the target league and another non-null league. Null player/match keys remain excluded; empty strings retain their former equality behavior. The inner materialization matters: without it, stale season estimates can choose a season-index scan again for every match.

Nested loops are enabled for this deliberately parameterized per-match check. The enclosing function setting still restores the caller's original value, including a caller that started with nested loops disabled. This avoids a whole-season aggregation and its memory/temp-file work on every published partition.

Python publication traces retain fixed stage names and elapsed intervals even when the database transaction rolls back. Success logs include cumulative stage timings; deferred-partition logs include the failed stage, its elapsed time and the same timing map. SQLSTATE `57014` is classified only from two exact known server messages. The only parsed SQL context is the known rollup function name plus a numeric line. No query text, arguments, source document or raw exception text is added to logs. These are Python stage intervals, including transport and rollback time, rather than server-only query timings.

## Validation

The disposable PostgreSQL fixture compares every rollup column, including generated columns, using native `record_send` bytes before and after the replacement. It covers duplicate observations, missing/nonfinite values, null and empty keys, multiple seasons, conflicting leagues, identity changes, empty scopes and fresh-digest no-ops. It verifies function/table OIDs, owners, ACLs, freshness flags and both caller planner settings. Failures injected before INSERT and after the ambiguity check roll back all replacement rows and retain the old digest.

The existing API rollup-vs-fact parity and numerical-boundary fixtures also run with migration 037. Real transaction tests verify continuation after a failed partition, receipt/generation rollback, safe failure logging and isolation of the next partition's trace. The incremental-core fixture verifies correction parity, bounded statement parameters, unchanged row identity and full rollback after an injected partial batch failure. The ordinary Python suite adds five trace-specific tests.

### Native restored-clone acceptance

The production-snapshot clone contained 20,042 observations and 831 rollups for `2025/2026`, `l_0ahLw8`. With both versions warm, the original refresh took **1,076 ms** and the final match-scoped function took **695 ms**. This is one paired observation, not a production percentile or a guarantee for every partition.

The final ambiguity probe took **42.104 ms** across **557 matches**, with **5,090 buffer hits** and **zero temporary I/O**. The binary rollup SHA-256 remained `d21f79b2d704df03c31646af7c0846d8234bfbf8e7142c2f39c27e106cec9b34`. Digest, ambiguity flags, generation 879, function OID/owner/ACL and the caller's planner setting were unchanged.

The [native acceptance record](../verification/rollup-publication-20261107/native-acceptance.json) retains the bounded query plan and state assertions. The [synthetic benchmark summary](../verification/rollup-publication-20261107/synthetic-benchmark.json) records the local fixture and measured candidate execution separately.

An earlier whole-season candidate timed out while lazily restored snapshot pages were cold. Once warm it completed, but it grouped 519,168 season observations. The final version avoids that scan. The original cold refresh's 26.491 seconds must not be compared with the final warm refresh as a performance gain.

### Reproducible synthetic check

`tests/benchmark_player_rollup_publication.mjs` seeds 110,000 analyzed background observations, then inserts an unanalysed 22,000-observation scope. It plans the original queries without running their potentially pathological loops and executes the candidate with a 15-second statement budget. It asserts 880 players, no nested-loop joins between the aggregate relations, and exactly 500 existing-index match probes covering 22,000 observations without temporary writes. All fixtures are rolled back.

Run against a fresh local disposable database named `vega_refactor_test` or `vega_rollup_publication_test`:

```bash
VEGA_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/vega_rollup_publication_test node tests/benchmark_player_rollup_publication.mjs
```

Set `VEGA_ROLLUP_BENCHMARK_EVIDENCE` to a local output path to retain full query plans. The benchmark is diagnostic, not an application latency SLO. The regular SQL parity and trace tests are registered in `tests/run_public_read_contracts.py`; the large synthetic benchmark is opt-in.

## Release behavior

The worker migration installer and the standalone core schema installer both apply 037 after the existing rollup definitions. Only future stale or explicitly forced scopes are refreshed; installation itself leaves existing publication facts and generation untouched. A deployment must still verify its actual installed function digest and observe completed publication transactions. Faster rollup refresh does not by itself prove that the catalogue backlog is drained or that every UI latency target is met.


## Individual-profile catalogue batches

The catalogue queue previously limited every transaction to four inputs. Individual player, team and league profiles use flat typed models; their fixed transaction, source-prefetch and COPY overhead can be amortized. The worker now admits a contiguous prefix of at most **16 individual profiles**, preserving queue order. Objects, collection endpoints such as `/players`, and mixed boundaries keep the existing **four-input** transaction size. No extra SQL query is needed to choose the size.

The slice still admits at most **40 inputs** or **30 seconds** of work before yielding to a partition, and respects the overall run deadline. A deadline stops admission between transactions; an admitted transaction still finishes or rolls back as a whole. Source spooling remains on disk, the catalogue writer retains its **64-record / 8 MiB group budget**, and storage headroom checks still run before and after publication. The larger flat-profile limit does not apply to archives or collection documents.

The [real-writer fixture](../verification/rollup-publication-20261107/catalog-profile-benchmark.json) activates the consolidated layout through its ordinary copy/parity gates, then publishes the same 40 profiles with limits 4, 16 and 32. Typed responses and source receipts agree exactly. Limit 16 needs **three batches, source streams and COPY groups** (`16+16+8`) instead of ten. This proves a **70% reduction in those fixed groups**, not a 70% production-throughput gain. The local PGlite bridge uses a batched INSERT adapter for COPY transport; its warm medians were 354 ms at 4, 127 ms at 16 and 92 ms at 32. The default remains 16. Native CI uses actual COPY.

Generation remains an atomic fence for each changed committed batch. Its final numeric value intentionally differs: ten changed batches increment it ten times; three changed batches increment it three times. No receipt or generation advance survives a failed batch. Transaction fixtures cover a later profile failure after a successful 16-input batch, the 40-input cap, the 30-second slice, the overall deadline, collection boundaries and continuation of healthy partitions. Production cadence must still be established from `catalog-published` receipts after deployment.

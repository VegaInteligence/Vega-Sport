# Navigation read audit — 2026-11-07

This audit covers the current AWS relational application. A bounded response is
not evidence of a fast query: the original player directory returned twenty
rows but aggregated and materialized an entire season first. First-page
navigation and explicitly requested cohort analysis are measured separately.

## Read paths and limits

| Page or action | Actual backend work | Response bound and freshness | Change / remaining measurement |
| --- | --- | --- | --- |
| Player directory / ranking | Combine publication-maintained `player_season_rollups` for the selected season and competition set; qualify and order the complete cohort before selecting a page; hydrate observations only for selected players. | At most 100 players, 1 MiB. Current publication and partition source watermarks are checked before origin-cache reuse. | Replaces the repeated season appearance aggregation. Unsupported match/date/starter/venue/result filters retain the exact fact reader. Stale or ambiguous projections also use facts. |
| Search bar | Name/alias candidates followed by indexed actor-season membership and latest-context probes. One-term searches do not read/normalize every appearance's team/league context. | Six players and four clubs, 32 KiB. Conditional requests and retained queries check the live publication singleton. | Avoids the previous whole-season appearance hash join. Name/context indexes and the final cold search plan need independent measurement; removing temp I/O alone did not prove an elapsed-time improvement. |
| Player profile and current-season history | Actor appearance index selects only that actor's match IDs. Summary mode retains typed appearance metrics and identities, omitting appearance extras, shots and other match details. | Up to 100 matches per summary page, 2 MiB. Complete-page assembly and generation fences precede season aggregation. | Reuses the current complete actor dataset for history instead of loading routes and the same season again. Full-match details and the exact comparison cohort are separate requests. |
| Club directory | Narrow match identity/date/team columns for directory counts; exact scored records when a ranking requests them. Page-only statistical hydration for analysis. | At most 100 clubs, 1 MiB, publication-safe origin cache. | No whole-fixture materialization for the ordinary name/count directory. |
| Club profile | Actor-scoped matches and fixtures; summary keeps team statistics and `teamStatsReliable` coverage. | Up to 100 matches per summary page, 2 MiB. Full appearances/shots are explicit detail reads. | Reliability flags must survive summary mode: otherwise the frontend would include excluded xG/possession observations. Below-fold club facts/ranking are deferred until visible. |
| Calendar and competition overview | Indexed fixture page with status/date/competition filters and keyset cursor; overview requests bounded recent/upcoming pages. | At most 100 fixtures, 2 MiB, generation-bound cursors. | Full calendar traversal is reserved for the matchday view or an explicitly required derived-standings fallback. |
| Competition standings | One `support_projection` root and its typed child rows, each selected by `projection_id`. | One competition and season. Digest-based conditional validation. | Standings start independently of calendar completion. No season appearances or global catalogue reconstruction are needed. |
| Cup edition | One selected competition/season's native or worker results/fixtures. | One semantic edition; existing compatibility routes retained. | Whole-edition information remains necessary for brackets. The unused global supplemental loader is no longer called by current page components. |
| Match overview | One match/fixture, its summary shots, selected team statistics, coverage and five leading players. | 256 KiB. Source-version-aware summary cache. | Default calendar navigation no longer fans out into 24 match-detail requests. |
| Match tabs / compatibility | One requested native family through `detail_response`; the complete all-family archive is a compatibility fallback. | Native family responses capped at 2 MiB, cached by committed family digest. | Summary/archive fallback occurs only for unsupported endpoints (404/405/501). A timeout, 503, network failure or abort no longer starts a heavier fallback chain. |
| Selected player performance | One selected appearance plus exact scoped peer counts; optional shots. | 256 KiB, publication-safe origin cache and record-existence-aware conditional validation. | The cold peer aggregation remains an explicit native measurement target. It does not block ordinary actor navigation. |
| Historical archives | Read one stored edition header and one indexed match page or detail. The publisher runs the exact legacy merge and stores its rows in two derived tables before committing a source change. Public reads never reconstruct a full source edition. | At most 100 list rows, 512 KiB. No goal arrays or raw source records in list responses. Results/goals identities, digests, timestamps, status and expected-stream membership fence pages and details. | Whole-edition counts, competition facets, goal-only matches, duplicate-key ordering and scorer search stay exact. Unready/stale projections return 503; goals load only for an explicit detail. |

The old archive-season and other compatibility endpoints remain available.
Advertising `boundedArchive` or an actor-summary capability never authorizes a
client to recover a transient error by downloading a complete season.

The first bounded archive implementation still scanned and merged a full edition
at a cold cache miss. Native measurements exposed an approximately 8.3 MB SQL
record and an 8-second timeout, so pagination alone was insufficient. Migration
032 moves that work into publication. Empty-query totals come from the exact
edition/competition summaries; filtered counts and rows use the selected
edition's stored listing fields. Detail reads use `(season, match_key, ordinal)`
and retain the original first-match rule when historical positional keys repeat.

## What was measured before the final release

These are SQL timings, not browser or CDN latency. Production and isolated
clone measurements must not be mixed into a single artificial benchmark.

| Probe | Observed SQL time | Interpretation |
| --- | ---: | --- |
| Production original all-scope player directory | 11,979 ms | Exceeded the runtime's 8-second SQL timeout; large temporary reads/writes. |
| Production narrowed fact-reader candidate | 8,434 ms | Smaller intermediate rows helped, but did not solve the default directory. |
| Production original broad `pa` search | 1,146 ms | Whole-season appearance hash join and temporary I/O. |
| Production lateral candidate before final indexing/search work | 1,223 ms | Temp I/O eliminated, but elapsed time was not improved in this measurement. |
| Production ordinary club directory | 99 ms | The default club SQL itself was not the multi-second navigation bottleneck. |
| Production actor read before summary mode | 127 ms | Frontend duplicate reads, detail fan-out and payload work needed attention. |
| Isolated native clone rollup all-scope plan | 249 ms | Verified `rollup_ready=true`, exact total 9,492 and 20 actual player records. |
| Isolated native clone rollup Europe plan | 111 ms | Verified nonempty exact total 2,151 and a full 20-player page. |
| Isolated native clone rollup after copy work evicted cached pages | 11,710 ms | A cold wide-heap scan took about 10,093 ms; three full scans read 20,414 blocks in total. The earlier warm result did not prove cold-read acceptance. |

The first captured all-scope rollup data read on the clone took 1,007 ms; the
subsequent analyzed plan took 249 ms. This distinction matters for cold reads.
The same clone's narrowed fact payload took approximately 30 seconds under its
observed conditions. Final native measurements must be repeated after the
numeric comparison-key correction and final search change.

### Cold directory storage and ordinary publication

Migration 030 keeps the existing rollup table and its publisher. Generated
scalar columns expose the identity/latest ordering keys and the four common
leaderboard metrics (goals, xG, assists and xA) to a covering index. The reader
selects identity/latest references during its existing aggregation, then reads
the full JSON observations only for the selected page. Search/position and
unusual metric filters retain their complete scoped inputs.

An index alone was insufficient: immediately after writes, PostgreSQL could
still choose a full heap scan. The migration therefore also narrows that heap.
It applies a 512-byte TOAST target and a guarded, one-time physical rewrite of
object-valued rollup metrics. Concatenating an empty object retains the existing
`jsonb_send` bytes; no canonical fact is rewritten. The lower storage target
then applies to ordinary future publication inserts. PostgreSQL documents that
changing this storage setting alone does not rewrite existing rows.
[PostgreSQL 18 storage parameters](https://www.postgresql.org/docs/18/sql-createtable.html)

In a **synthetic PostgreSQL 18.6 PGlite fixture**, 36,000 rollup rows occupied
18.46 MB of heap after this change, versus 57.6 MB before it. The candidate read
made one full heap scan instead of three, with zero all-visible pages and no
manual VACUUM. Its local elapsed time was 261 ms versus 381 ms, and 239 ms after
an ordinary update. These numbers establish the query/storage behavior;
they do not establish native latency or make visibility-map maintenance
optional. Native RDS cold-read measurements remain the acceptance gate. The migration
tests also force the unchanged 025 publisher to refresh after generated
columns are added and compare the full public results, ordering and payloads.

### Initial maintenance and ordinary publication

After migrations 030/031 commit, deployment must run ordinary
`VACUUM (ANALYZE)` on `appearances` and `player_season_rollups` through the fixed
maintenance operation before accepting native read measurements. The table
rewrites invalidate all-visible pages without necessarily incrementing the
ordinary insert/update counters enough to trigger autovacuum. This initial
step is therefore an operational requirement. It runs outside the migration
transaction and does not use `VACUUM FULL`.

Migration 034 sets maintenance thresholds only on those two tables and the
large catalogue/detail record stores. The smaller support store retains its
defaults. The migration retains the server's shared worker count,
cost budget, pause interval and freeze policy. A small match publication changes
only its own heap pages; the policy does not request a vacuum after every write.
Background maintenance remains asynchronous, so a freshly modified page can
still require a heap visibility check.

| Tables | Updated/deleted rows before vacuum | Insert threshold and scale | Changes before analyze |
| --- | --- | --- | --- |
| `appearances` | 500 + 1% of table rows | 500 + 0.5% of the unfrozen population | 250 + 0.2% of table rows |
| `player_season_rollups` | 200 + 1% | 200 + 1% of the unfrozen population | 100 + 1% |
| `catalog_records`, `detail_records` | 2,000 + 2% | 2,000 + 2% of the unfrozen population | 1,000 + 0.5% |

For the measured 373,395 appearances, the new dead-row and analyze thresholds
are approximately 4,234 and 997, respectively, instead of the defaults of
74,729 and 37,390. The source inventory places catalogue/detail at roughly
one/five million rows. Their larger fixed thresholds account for those row
populations and resource-replacement batches; support receives no arbitrary
large-table floor. The initial
copy still requires explicit statistics maintenance before plan acceptance;
changing thresholds alone is not evidence that a background worker has run.
Regression checks validate PostgreSQL's accepted relation options, idempotence,
unchanged row bytes/tuple locations, owners/grants, unrelated storage settings,
and unchanged server-wide settings.

PostgreSQL documents the threshold formulas and visibility-map behavior in its
[vacuum configuration](https://www.postgresql.org/docs/18/runtime-config-vacuum.html)
and [routine maintenance](https://www.postgresql.org/docs/18/routine-vacuuming.html)
references.

### Resumable copies and publication validation

Migration 028 filters binary-identical destination rows before INSERT during
forward and reverse copies. It still visits/counts every source key and keeps
all row/resource parity checks. Regression triggers confirm that unchanged
rows do not reach INSERT/UPDATE row triggers; changed values, signed zero,
metadata-array lower bounds and new/missing rows are still repaired.

Migration 033 retains those exact predicates and source checkpoints while
keeping each unchanged-row lookup correlated to its complete destination key.
The small `OFFSET 0` fence prevents a poorly estimated anti-join from repeatedly
scanning a wide destination materialization. Forward/reverse copy and safe
reapplication of 027/028/033 pass the complete seventy-three-check local SQL
fixture; this semantic proof is separate from native copy-throughput evidence.

Migration 029 retains all 112 per-kind validation expressions and existing
CHECK constraints while placing each expression in a cached PL/pgSQL branch.
The original and replacement functions agree on 3,588 valid/invalid outcomes,
including SQLSTATE errors. On the native clone's same 2,000-row rollback-only
probe, projection plus attribute validation fell from 1,132 ms to 78 ms; the
actual fully constrained INSERT fell from 2,680 ms to 435 ms. Function OIDs,
owners, grants, volatility and strictness remain unchanged. This improvement
does not depend on disabling validation, foreign keys or revision triggers.

## Numeric membership and ordering

Canonical facts and provider records are preserved. Derived floating-point
aggregations are not bitwise associative: summing per competition and then
combining sums can differ from one global sum by a few units in the last place.
Native first-page comparison found sixty numeric differences, a maximum
absolute difference of `3.552713678800501e-15`, and no differences in IDs, order,
counts, teams, scopes or nonnumeric metadata.

A tolerance alone cannot excuse a changed rank or qualification. An adversarial
seven-rating example (`6.4, 5.2, 5.3, 9.7, 7.6, 8.7, 9.6`) demonstrated that a
3+4 competition split could reverse a mathematical tie at 7.5. Both player
readers therefore use the same `comparisonNumberSql` helper:

- Derived numeric membership and ordering keys use twelve decimal places.
- Both the observed comparison key and requested numeric threshold use that
  precision. Values distinguishable at that precision remain ordered normally.
- Integer counts, rating-count tiebreakers and name/ID ordering remain exact.
- Stored facts, stored rollups and returned profile measurements stay unrounded.

Public payload comparisons require exact structure, null/coverage semantics,
IDs, counts, qualification and order. Derived float measurements use the tight
mixed bound `64 × Number.EPSILON × max(1, |actual|, |expected|)`. This is a read
projection acceptance rule, not permission to round or alter source data.

## Publication and failure behavior

A core publisher refreshes the changed partition's rollup after its final facts
and partition metadata, then increments the publication generation, all in the
same transaction. A reader checks every selected partition's source digest and
ambiguity guard and repeats that check in its payload snapshot. Unready
projections never become a successful empty directory.

Origin cache retention does not determine freshness. Player, club, actor and
performance cache hits check committed publication and coverage metadata.
Search checks the live generation. Home/discipline retain their independent
period/event validators rather than being put into a generation-only cache.

Archive freshness is independent of the core generation. An archive index that
advertises a missing results/goals stream yields 503 rather than a partial
successful edition. The source and projection commit together, and a failed
projection rolls back the source publication. Dedicated maintenance uses the
same merger under the storage/catalogue lock order and leaves migration control
unchanged. Conditional list requests need only metadata. Detail
HEAD/304 requests also establish that the match exists. A stale archive detail
cannot drop its version and reuse a positional match key: source reordering
could otherwise display another fixture's goals. The UI returns the user to a
new edition list instead.

## Verification and remaining evidence

The public contract runner includes the backend metrics, read-cache, rollup,
archive, discovery, actor, performance, compact player/club, home, discipline,
cursor and remote-match tests. The SQL tests exercise real PostgreSQL syntax
and compare public results to canonical/fact readers. The new numeric regression
covers the split-versus-single-partition tie, both sides of rating/xG thresholds,
meaningful near-ties, rating/goals/clinical ordering and page-two membership.
Club summary tests compare the frontend's exact aggregate with the full actor
response including an explicitly unreliable statistics observation.

Archive projection verification adds eight SQL/API cases and thirty
transactional checks. These cover exact merger parity, search boundaries,
publication races, missing projections, pinned detail keys, source/projection
rollback, a total maintenance deadline, cached SQL-plan rebinding across the
table-to-view switch and maintenance during the explicit backfill state. The native CI
runner gives this committing fixture its own disposable database. The 031
generated performance key is excluded from the reviewed positional appearance
protocol and named public records; unknown typed/generated fields still use the
generic named fallback, preserving zero/null values and future schema support.

Native acceptance still needs the final captured SQL, source and payload
hashes. Stored archive cold-load size/plan, explicit performance peer
aggregation, and complete user-visible cold/warm navigation should be reported
separately from the measured player-directory improvement. Exact analysis
cohorts remain deliberately complete and paginated; they are loaded on user
intent rather than during ordinary page navigation.

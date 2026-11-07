# Physical database consolidation and publication cutover

## Implemented target

Migration `023_consolidated_provider_records.sql` replaces **112 physical tables in the active publication schema with three constrained record stores**. The source mappings, migration, adapters and publication writers share one explicit model in `consolidated_model.py`. `consolidation-manifest.json` lists every affected table, parent, key and preserved column.

The production inventory on 6 November 2026 contained 161 physical tables in `statarena_app`. Migration 023 adds three stores and one migration-state table, then moves the 112 former stores out of the active schema during the verified cutover. The resulting active schema contains **53 tables**, **54 with migration 025's player-directory aggregate**, and **56 with migration 032's two exact archive read projections**. Compatibility views remain available for existing readers. Views contain no independent physical copy.

| Existing group | Physical tables replaced | Authoritative target |
| --- | ---: | --- |
| Provider catalogues, rankings, profiles, historical calendars | 62 | `statarena_app.catalog_records` |
| Supporting standings, honours, club, coach, venue and cup projections | 18 | `statarena_app.support_records` |
| Native non-metric match detail trees, including all four lineup member tables | 32 | `statarena_app.detail_records` |
| Canonical identity, fixture, match, appearance and shot facts; compact metrics; source headers; publication state | 49 retained | Their existing indexed relational tables |
| Migration state | 1 new | `statarena_app.consolidation_state` |
| Player directory aggregates | 1 new in 025 | `statarena_app.player_season_rollups` |
| Exact merged archive summaries and paginated matches | 2 new in 032 | `statarena_app.archive_read_editions`, `statarena_app.archive_read_matches` |

This is a reduction in the active physical publication model, not a claim that all 295 database tables become 56, or that the corresponding bytes have already been reclaimed. The former 112 tables are initially retained in `statarena_retired_v1`. Database size therefore increases during backfill. Final physical retirement is a separate, exact-manifest operation after restored-backup and post-cutover acceptance.

The two archive projections move the existing exact whole-season results/goals merger to publication time. Public archive requests read one bounded page or one match detail while retaining complete summaries, facets and filtered totals. They are updated atomically with source publications and are unavailable when their source fence is stale. See [archive backfill and release operations](../../docs/operations/ARCHIVE_READ_PROJECTION_20261107.md).

### What remains intentionally relational

Canonical `players`, `teams`, `competitions`, `matches`, `fixtures`, `appearances`, `shots` and their small membership/coverage/definition tables remain indexed facts. Native provider profiles are observations; they must not be merged into a canonical identity merely because names match. Existing player and half-period metric storage uses compact typed dictionaries, groups, members and overflow. Converting it back to one generic row per metric would increase rows and indexes and undo an existing useful compaction.

Public provider headers (`catalog_editions`, `support_projection`, `match_families`, `match_details`) remain the source of provenance, response status, independent parameter variants and committed source digests. No provider identifier, observation period or historical identity is rekeyed by this migration. The publication generation changes once at activation or rollback, invalidating existing generation-bound application caches.

## Preserved integrity and read contracts

Each record stores only the scalar attributes of one mapped provider node. A season, collection, lineup or complete match is never packed into a single unbounded JSON document. Child collections remain separate, ordered records. Each scalar record is limited to 8 MiB.

The database enforces:

- a resource-scoped primary key `(resource_id, record_kind, path)`;
- a foreign key to the unchanged provenance header, with cascading deletion;
- a self foreign key to the exact permitted parent kind and path;
- sibling order, unique mapped labels, root cardinality and nonnegative integer paths;
- the complete allowlisted field set, original scalar types and integer ranges;
- distinct missing-field and explicitly-null-group metadata;
- explicit IEEE-754 negative-zero metadata, avoiding JSONB's numeric normalization;
- bounded record sizes and no null path elements.

Typed views reconstruct the former SQL column contracts. They preserve column order when the original public relation name changes from table to view. Catalogue row-type functions are recreated against the new view types; existing dependent application views are rebound atomically. Ownership, grantees, privilege types and grant options are retained. A preflight rejects unmapped columns/types, external foreign keys/views, mixed table ownership and row-level-security tables; it never guesses how to migrate those dependencies.

Exact parity is checked in both directions over **every row**, not a sample or a row-count estimate. The evidence includes full typed JSON plus binary float and array representations. This detects changed float bits or unusual PostgreSQL array bounds that ordinary JSON equality would miss. Catalogue and match HTTP resources are also reconstructed and compared exhaustively. Supporting resources compare all ordered typed rows used by their deterministic existing decoder. Absent data, explicit null, false, zero, empty strings, collection order, source errors and parameter variants remain independent states.

## Ownership, deployment order and capacity

Run migration and cutover functions as the existing application-table owner (`statarena_ingest` in the current AWS deployment), or explicitly assume that role. Administrative bootstrap creates or grants `CREATE` and `USAGE` on `statarena_next` and `statarena_retired_v1` to that owner. The runtime reader role needs its preserved public-view privileges, not unrestricted access to all provider records. Mutation functions are security invoker and revoked from `PUBLIC`.

Migration 024 requires `pg_trgm`, bootstrapped by the RDS administrator if the ingest role cannot create extensions. Its name-normalization indexes match the actual search expression. It also indexes latest player appearances and home/away match traversal.

Deploy the new publisher code before entering maintenance. The materializer records each migration SHA-256 in `worker_schema` and rejects changed applied migration files. A private SQL deployment worker must record the same filename and digest when it applies a migration outside the materializer. Check 021 and 022 receipts before installing the ordered consolidation and read-performance migration set. Migration 026 only installs the separate transfer-archive operators described below; it never invokes them during publication.

Migration `027_nullable_consolidation_cursors.sql` must precede any cutover proof. Legal identity overrides can produce negative or zero resource IDs, including the minimum bigint; a starting cursor of zero would omit them from both copying and verification. The correction uses a NULL cursor to represent the entire initial range in mapped rows, consolidated candidates and native resource headers. It preserves function signatures, ownership and ACLs. Under the existing publication lease, its first application clears old copy/row/resource proof checkpoints and advances the control revision. Business rows remain intact; repeat the bounded copy and all parity passes. Reapplying the same correction preserves newly generated full-range proofs. The sealed 023 migration and generator remain unchanged.

Migration `028_skip_unchanged_consolidation_rows.sql` preserves exhaustive traversal while filtering already-identical destinations before `INSERT`. Both forward and reverse copies still visit and count every source key, copy missing or changed rows, and require the same complete parity receipts before cutover. Reverse-copy equality includes native array dimensions and bounds plus float wire bytes, so negative zero cannot be silently treated as positive zero. Skipped rows avoid unnecessary constraints, triggers, tuple rewrites and WAL. The correction preserves the installed function identity, ownership, ACLs and checkpoints; it does not relax a constraint or replace verification with sampling.

Migration `029_cached_attribute_validators.sql` retains each of the 112 attribute-validation expressions and dispatches them through cached PL/pgSQL branches. It changes execution cost, without changing the accepted fields, types or null states. Exact old/new function-body digests guard installation; function identities, privileges and immutability are preserved. Native acceptance profiles the same bounded source rows before and after this change, including an actual constrained insertion rolled back to a savepoint. Do not disable constraints to accelerate backfill.

Migration `033_bounded_consolidation_lookups.sql` keeps the unchanged-row checks correlated to each selected source key. An `OFFSET 0` optimization fence prevents PostgreSQL from materializing a large destination kind and comparing every batch row against that entire set when cardinality estimates are poor. The full typed and binary equality predicates, source traversal, checkpoints and constraints remain unchanged. The correction runs after the guarded 028 SQL templates are expanded, so reapplying earlier corrections remains safe. Refresh consolidated-store planner statistics after the full copy and before verification; this does not replace the exact parity gates.

All current publisher entry points acquire the existing publication lease and read the committed storage mode once per transaction. During backfill or reverse-copy maintenance they leave inputs queued. Any independently running older publisher, including an ad-hoc honours batch, must finish or update before cutover: an old `COPY` into a name that becomes a view cannot publish correctly.

The shared AWS storage budget is tied to the existing **64 GiB** allocation: a **48 GiB logical SQL ceiling** and a **2 GiB publication reserve**. `STATARENA_SQL_LIMIT_BYTES` and `STATARENA_SQL_RESERVE_BYTES` override those values. Collection, rematerialization and UEFA workflows pass both variables. The guard includes measured `pg_database_size` plus estimated publication growth and remains enabled. An 18 GiB database is permitted; a database above the reserved ceiling is blocked with measured sizes in the error. AWS `FreeStorageSpace`, WAL and temporary-file use remain separate operational checks; `pg_database_size` does not measure those.

## Bounded SQL interface

The SQL interface supports a private IAM-controlled database worker as well as the Python CLI. Each call commits independently. Use the manifest's parent-before-child order. Start with a row budget of 2,000, lower it if the native clone shows a statement approaching the operational time budget. The budget limits selected rows; deleting a stale parent can cascade through its descendants.

| Operation | SQL call | Completion condition |
| --- | --- | --- |
| Inspect | `SELECT statarena_app.consolidation_status()` | Control, progress, active/retired counts |
| Enter backfill maintenance | `SELECT statarena_app.consolidation_begin('backfill')` | Mode is `backfill` |
| Mirror one table | `SELECT statarena_app.consolidation_copy_batch('TABLE',2000)` | Repeat until `complete=true`, then next table |
| Compare one table | `SELECT statarena_app.consolidation_verify_batch('TABLE',2000)` | Repeat until complete for every table |
| Compare native resources | `SELECT statarena_app.consolidation_verify_resources('catalog',32)` | Repeat for `catalog`, `support`, `detail` |
| Activate | `SELECT statarena_app.consolidation_activate()` | Mode is `active`; one generation increment |
| Start reverse copy | `SELECT statarena_app.consolidation_begin('rollback')` | Mode is `rollback` |
| Reverse mirror/compare | The same copy/verify calls | Every table complete at one revision |
| Restore old physical contracts | `SELECT statarena_app.consolidation_rollback()` | Mode is `legacy`; post-cutover data retained |
| Recopy after a detected write | `SELECT statarena_app.consolidation_restart()` | Clears progress, retains all business data |
| Cancel maintenance | `SELECT statarena_app.consolidation_cancel()` | Restores the previously authoritative mode |

The copy has bounded stale-row pruning and upsert phases. Checkpoints commit with their copied rows, so retries resume without skipping data. All copies must finish before verification begins. Source tables, new stores and source headers carry statement-level revision triggers during maintenance. A write after a parity receipt invalidates that receipt. Activation locks the participating relations, rechecks the current revision and the complete proofs, then performs a short DDL transaction; it does not repeat a full data copy in one transaction.

Do not ignore a parity, type, capacity or ownership failure. Use `consolidation_cancel()` to resume the prior publication mode while investigating, or correct the proven issue and `consolidation_restart()` to rebuild all receipts. No partial proof authorizes activation. Do not edit 023 after its digest has been recorded; corrective changes require a new migration.

### Python orchestration

The CLI uses the same SQL functions and no separate migration algorithm:

```bash
python3 dashboard/scripts/schema_consolidation.py status
python3 dashboard/scripts/schema_consolidation.py begin --phase backfill --expected-host HOST --expected-database DATABASE
python3 dashboard/scripts/schema_consolidation.py copy --batch 2000 --expected-host HOST --expected-database DATABASE
python3 dashboard/scripts/schema_consolidation.py verify --expected-host HOST --expected-database DATABASE
python3 dashboard/scripts/schema_consolidation.py activate --expected-host HOST --expected-database DATABASE
```

`DATABASE_URL` supplies the credential through the existing deployment mechanism; do not put credentials in command arguments or receipts. Remote mutation requires TLS `sslmode=verify-full` and an explicit matching host/database. `--max-batches` bounds one invocation; rerunning resumes the checkpoints. `--receipt PATH` writes counts and control metadata, never source payloads.

## Rollback after new publication

The archived old tables are **not an immutable backup**. Their existing header foreign keys remain valid, so replacement of a catalogue or match header can remove corresponding archived rows through cascading deletion. Merely swapping old table names back after publication would lose new data.

The implemented rollback therefore mirrors the **current authoritative record stores** back into every old physical table, in parent order, pruning stale rows and restoring all new rows. It then performs the same exact typed/binary row comparison and checks the current revision before reversing the adapters. This path has a fixture that activates, publishes changed lineups/catalogue/support data through the new writers, reverse-copies, rolls back and continues publishing through the legacy writers. Run the same operation on the restored native PostgreSQL clone with full production data before production activation.

The database saves an exact `retirement_manifest` with relation names, original column order, owners, ACLs, row-type functions, dependent views and the verified revision. No function in this rollout drops physical source tables or uses `DROP CASCADE`. A later reviewed physical retirement must name only that manifest's archived objects and include restored-backup evidence. After final retirement, immediate SQL rollback is replaced by the documented snapshot/replay recovery procedure; that is a separate irreversible decision.

## Whole-database scope and retained data

The inventory's other schemas are explicitly accounted for:

| Schema/group | Existing physical tables | Role and disposition |
| --- | ---: | --- |
| `statarena_app` | 161 | Active publication model; 112 mapped sources consolidated, 49 retained, 7 justified additions including 025 and 032 |
| `statarena` | 27 | Source documents, object metadata, observations, ingestion queues and source-transfer history; current AWS import/materialization still consumes the live source groups |
| `football` | 65 | Separately implemented historical Pro model; inactive for current public serving, preserved pending explicit isolation of optional import/read tools |
| `ingest` | 23 | Pro lineage, revisions, reconciliation and import contracts; linked to the preserved Pro data |
| `analytics` | 10 | Pro publication generations and aggregate snapshots; linked to Pro data |
| `neon_auth` | 9 | Authentication; excluded from sports-data consolidation |

The 98 Pro tables contain real imported and published data. Repository evidence includes the real RDS transfer/publication receipts under `docs/verification/orion-pro-real-rds-transfer-20261105` and `docs/verification/orion-pro-real-publication-20261105`. The public deployment disables `STATARENA_PRO_API`, and scheduled collection/rematerialization workflows use the existing AWS source and publication model. Optional `orion_pro_*` operators and their historical contracts remain in the repository. Renaming those schemas without adapting those tools is not a completed migration. External jobs, sessions and permissions must be checked before a separate archival isolation operation.

Ten `statarena.neon_*` transfer captures have no references in the current application, collection scripts, infrastructure or workflows. Migration `026_legacy_transfer_archive.sql` installs explicit invoker-rights archival and rollback functions; installation does not move tables. After exact native preflight and source-schema owner authorization, the two existing owners can move their own batches into `statarena_legacy_transfer`, preserving all rows, OIDs and table ACLs without role-membership changes. This removes ten names from active staging but does not reduce the physical table count or reclaim their storage. The private operator must retain both owner receipts and verify the final union of all ten tables; production execution is not implied by the installed migration. See [the consumer audit and operating procedure](../../docs/operations/LEGACY_TRANSFER_ARCHIVE_20261107.md). Historical `raw/neon/...` S3 object paths do not imply use of these tables.

This migration does not merge identities by names, replace the source-document store with an unverified copy, or discard authentication, historical Pro observations or provenance to achieve an arbitrary table-count target.

## Verification

`tests/consolidation_postgres.py` requires a fresh disposable PostgreSQL database. It exercises every one of the 112 node kinds, numerical boundaries and signed zero, missing/null/empty states, rejection of unknown fields and invalid parent references, resumable progress, incomplete/stale-proof rejection, generation changes, post-cutover publisher writes and reverse-copy rollback. Migration generation must reproduce the checked-in SQL exactly.

The regular native PostgreSQL CI runner executes that test in a separate committed fixture database after the rollback-only public-read tests. Native PostgreSQL uses the actual psycopg COPY transport. PGlite tests use the same SQL functions and constraints but substitute INSERT transport because its socket COPY completion messages are incompatible with psycopg; they are useful local evidence, not a substitute for native COPY and full-data clone acceptance.

`tests/test_storage_budget.py` separately verifies that the current 18 GiB database can publish, that estimated growth and explicit overrides are honored, and that near-ceiling collection/publication remains blocked. Full and incremental publication refresh the player-directory aggregate within the same transaction before the generation advances. Migration 025's independent tests cover aggregate/fact parity and scope semantics.

### Numerical comparisons in the derived player aggregate

The source migration requires exact typed and binary equality. The player-directory
aggregate is a separate derived read model: adding floating-point values within
partitions and then across partitions can differ from a single fact aggregation
in its final floating-point bits. Native clone verification observed a maximum
absolute difference of `3.552713678800501e-15` in the first all-competition page,
with identical players, ordering, totals, coverage and publication metadata.
The original byte-exact comparison failure is retained in the operation evidence;
it must not be relabeled as an exact pass.

Derived-payload comparison permits at most
`64 * Number.EPSILON * max(1, abs(expected), abs(actual))` for floating aggregates.
Identifiers, integer counts, null states, coverage, page membership, ordering and
metadata remain exact. This tolerance never applies to the copied source records.

An adversarial fixture also showed that floating summation noise could reverse
two mathematically tied rankings. Both the fact and aggregate query now use the
same **12-decimal comparison keys** for derived numeric filters and ordering.
Stored observations and returned profile values remain unrounded. Integer
tiebreakers and the final name/identifier ordering remain exact. Tests cover
different partition splits, both sides of qualification thresholds, mathematical
ties, representable differences larger than the comparison precision, and
pagination across those ties.

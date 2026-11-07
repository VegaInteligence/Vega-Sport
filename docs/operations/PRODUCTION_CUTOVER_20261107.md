# Production database cutover — 7 November 2026

**The physical production cutover is accepted.** It committed at **08:05:32.376513 UTC**, leaving the database in **active mode at revision 8838**. The observed SQL operation took 862 ms; the worker reported 942 ms including its connection and processing overhead. These timings describe this cutover operation.

The [machine-readable acceptance record](../verification/db-refactor-20261107/native-production-cutover.json) contains the canonical counts, contract comparisons, code/model digests and receipt hashes. Completion of the adapted publisher, final HTTP acceptance and temporary-resource cleanup remain separate release gates.

## Gate before activation

The final production status was reviewed independently against the exact 112-kind storage manifest. Both reviewers used the canonical raw payload.

| Proof | Accepted result |
|---|---|
| Copy checkpoints | All 112 kinds complete |
| Exact typed/binary row verification | All 112 kinds complete at revision 8838 |
| Per-kind copy/verification counts | Identical for every mapped kind |
| Total rows | 7,838,886 copied and verified |
| Catalogue resource parity | 944 resources |
| Support resource parity | 1,989 resources |
| Detail resource parity | 204,857 resources |
| Total resource parity | 207,790 resources, complete at revision 8838 |
| Cursor contract | `null-start-v1` |
| Before-cutover physical layout | 168 app tables; zero retired provider tables |

The production counts were checked independently; they were not inferred from the earlier clone. The accepted [native clone roundtrip](NATIVE_ROUNDTRIP_20261107.md) established reversal, post-cutover data preservation and continued legacy publication for the same storage model.

Canonical gate receipts: `production-resource-status-010.json`, `production-resource-verify-063.json`, `production-forward-independent-review.json`, and `production-root-cutover-gate.json`. Activation is recorded in `production-native-activation.json`.

## Read contracts after activation

The actual `statarena_runtime` account, with worker writes disabled, returned a sample exactly equal to the before-cutover sample:

| Sample field | Before and after |
|---|---|
| Catalogue status | `null` |
| Lineup status | `200` |
| Lineup members | 40 |
| Honours available | `true` |
| Rollups readable | `true` |

The catalogue scalar remains null as it was in the baseline. Its preserved value is recorded explicitly; catalogue compatibility also has the independent relation and function checks below.

All **112 public compatibility views** match their retired source tables' column names/order, types, type modifiers, collations, owners and effective privileges, and are selectable by the runtime account. All **62 migrated row-type functions** match their normalized identities/definitions, owners and privileges and are executable by the runtime account. Both issue lists are empty. **No public app view remains bound to a retired physical table.**

Receipts: `production-runtime-contract-before-cutover.json`, `production-active-production-runtime-contract.json`, and `production-active-cutover-catalogue-contracts.json`.

## Physical inventory and retained data

| Schema group | Physical tables after cutover |
|---|---:|
| Active app model | 56 |
| Retired provider tables retained for reversal | 112 |
| Archived transfer captures | 10 |
| Source/ingestion schema | 17 |
| Authentication schema | 9 |
| Separate experimental schemas | 98 |
| **All schemas** | **302** |

The 56-table figure describes the active app model. The database-wide count includes retained historical and reversal structures. This cutover does not claim physical-table deletion or disk reclamation. The exact schema counts are in `production-active-schema-inventory.json`.

The retained **04:15 production snapshot** is the recovery point recorded in `production-pre-cutover-snapshot.json`. The earlier validation clone came from the separate **01:35 snapshot**. After subsequent publication, a safe rollback requires reverse copying the current consolidated records before switching back; the old retired tables alone do not represent the current data.

## Publication and derived-read readiness

The cutover advanced publication generation **293 → 294**. Immediately afterward, the queue still contained **390 partitions**, with the same oldest queued timestamp as before cutover. The cutover itself did not drain that backlog.

Post-cutover reads confirmed:

- **100 of 100 player-rollup partitions fresh**, with zero stale and zero ambiguous partitions.
- **154 of 154 archive editions ready**, with zero not-ready editions and **507,698 projected matches**.

Receipts: `production-publication-health-before-cutover.json`, `production-active-publication-health.json`, `production-active-rollup-readiness.json`, and `production-active-archive-projection-inventory.json`.

The adapted publisher workflow was **started at 08:09:14 UTC** on main commit `a34514589726d6f8770dbcb86a798bd76d6b0af7`: run **42354243225**, job **128348712643**. Its inputs are `schema_only=false`, `queue_all=false`, `minutes=100`, `batch=10`, and `lineup_reader=unchanged`. The start receipt is `production-adapted-publisher-started.json`; it does not establish publisher completion.

## Code and model

| Artifact | SHA-256 or model digest |
|---|---|
| Storage model | `395de5ecf4c7e0546561c612559b2448bb78d36205d62b0f78ab33202bcfb9a4` |
| Activation worker | `e785e3ab0ae4abca926b24697e155fb7a584de84364b8cf71a06433d1c25d50c` |
| Read-validation worker | `a12b3d426fe2b73e457dec5eef5adfe8703c16a0e188d64346eac043e982782c` |
| Activation operation | `9b8329caacc6a9b10d012690fbe65bb204cfcdf7e433bd4fad62985ea6c1fe86` |

## Remaining release closeout

At this evidence cutoff, the database cutover and the native read checks above are accepted. The publisher workflow has started. **Publisher completion, final HTTP acceptance and temporary-resource cleanup remain pending in this record** and are tracked separately in the [release closeout](DB_REFACTOR_RELEASE_20261107.md).

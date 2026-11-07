# Native database roundtrip — 7 November 2026

**Accepted at 07:19:43 UTC.** The isolated PostgreSQL 18.6 clone completed the physical consolidation, exhaustive forward validation, publication into the new stores, exhaustive reverse copy including that new data, guarded rollback, and continued writes to the restored legacy tables.

This report covers the validation clone. Production migration and cutover have their own acceptance gate. The [machine-readable record](../verification/db-refactor-20261107/native-clone-roundtrip.json) contains the exact counts, revisions, code digests and hashes of the canonical operator receipts.

## Snapshot and execution scope

The clone was restored from the **01:35 snapshot**, captured at 01:35:18.024 UTC. The **04:15 snapshot**, captured at 04:15:48.486 UTC and verified available, is the separate retained production recovery point. The clone results apply to the 01:35 restore.

CloudTrail records the successful `RestoreDBInstanceFromDBSnapshot` event at **01:47:56 UTC**, binding the clone to the 01:35 snapshot. The canonical lineage receipt is `clone-restore-lineage-cloudtrail.json`. Supporting receipts are `production-baseline-capacity.json`, `clone-restore-verified.json`, and `production-pre-cutover-snapshot.json`.

The clone initially used `db.t4g.micro`, then temporarily used `db.t4g.large` for the full-data proof; the larger instance was verified available at 04:40:34 UTC. Production remained on `db.t4g.micro`. The large-clone proof establishes data integrity, permissions and reversibility. Its timings must not be presented as production navigation benchmarks. Earlier navigation measurements retain their original instance-class labels in `clone-compute-phase-manifest.json` and `clone-resize-verified.json`.

## Full-data migration and reversal

| Gate | Exact accepted result |
|---|---|
| Forward copy | 6,213,334 rows across all 112 mapped kinds |
| Forward typed and binary parity | All 6,213,334 rows, at revision 2116 |
| Resource reconstruction parity | 167,273 resources: 623 catalogue, 1,935 support, 164,715 detail |
| Active physical storage | Three authoritative stores; 56 physical app tables and 112 retired physical tables |
| Publication after cutover | Four new records: one catalogue, one support, two detail; publication generation 201 |
| Reverse-copy start | Revision 2117 |
| Reverse copy and typed/binary parity | 6,213,338 rows across all 112 kinds, including the four new records; verified at revision 4883 |
| Reverse pruning | Zero rows |
| Guarded rollback | Legacy mode at revision 4883; original fixture payload preserved exactly |
| Restored physical layout | 168 physical app tables, including the additive structures; zero tables in the retirement namespace |

These are clone counts. They are not assertions about the number of rows in production at its later cutover.

Every forward row and resource checkpoint was complete at the same revision before activation. Every reverse row checkpoint was complete at the current revision before rollback. The reverse gate uses exhaustive typed/binary row parity and runtime payload checks; the exhaustive resource sweep had already completed before activation.

The four new records were written into the consolidated physical stores after activation. Reverse copying therefore restored data that did not exist in the original retired copies. The process retained physical tables for reversibility and performed no physical table drops.

Key receipts: `clone-forward-complete-gate.json`, `clone-native-activation.json`, `clone-active-smoke-write.json`, `clone-reverse-copy-complete-gate.json`, `clone-reverse-complete-gate.json`, and `clone-native-rollback.json`.

## Actual runtime credentials

The worker was reconfigured to the actual `statarena_runtime` account with writes disabled for three separate phases:

1. Active storage after the consolidated publication.
2. Legacy storage after reverse copy and rollback.
3. Legacy storage after a subsequent physical publication.

Each phase began with an identity query that does not change role. The contract and fixture reads then checked the connected runtime account's access. The original active and restored-legacy payloads matched exactly; the final phase matched the explicitly changed legacy payload.

The checks preserved null and absent fields, boolean values, string jersey values and native negative zero. Its binary representation remained `8000000000000000`.

The accepted **2018/2019 archive canary** remained ready through all three runtime phases: 10,219 matches, 50 rows on the first page, 205 pages, a 16,061-byte listing and a valid 709-byte selected detail. This is the projected-read compatibility canary. Exhaustive provider row and resource coverage is reported separately above; the remaining 93 clone projection rebuilds were waived.

Runtime receipts: `clone-active-actual-runtime-acceptance.json`, `clone-legacy-actual-runtime-acceptance.json`, and `clone-legacy-continuation-actual-runtime.json`.

## Continued publication after rollback

A separate, narrowly scoped native SQL probe ran once after the original roundtrip had passed. It required legacy mode, the ingestion role, restored physical tables, and exact existing fixture values and provenance.

It updated three typed fixture rows and their three synthetic source digests, changed seven expected public scalar values, and advanced generation **202 → 203**. It inserted and deleted no rows. The full maintenance control record, all four consolidated shadow records, and native negative zero remained unchanged. A subsequent actual-runtime read observed the exact changed public payload.

This proves the native legacy SQL publication contract. The actual Python publisher has separate integration coverage in [`tests/consolidation_postgres.py`](../../tests/consolidation_postgres.py): it invokes the publishers, performs reverse copying, and asserts that the legacy publisher continues after rollback. [The contract runner](../../tests/run_public_read_contracts.py) runs that fixture through [the ingestion verification workflow](../../.github/workflows/verify-ingestion.yml). The fixed native SQL probe is not described as a Python publisher execution.

The original roundtrip receipt is `clone-native-full-roundtrip-accepted.json`; the additional publication receipt is `clone-legacy-continuation-accepted.json`. Their combined closeout is `clone-native-closeout-accepted.json`.

## Sealed code and model

| Artifact | SHA-256 or model digest |
|---|---|
| Storage model | `395de5ecf4c7e0546561c612559b2448bb78d36205d62b0f78ab33202bcfb9a4` |
| Full roundtrip worker | `5d1adec4ccf56e021618cd22bbac0ec4ff6e5687dca99ba93596fb2cd13d279f` |
| Narrow continuation worker | `7e40400487fe5301e14860761e0b1a72e854ca95b84ec67abbd796c2a571a67c` |
| Continuation SQL | `5f23e668b4f3d6ebebd648c442f393c30bf1e3a315f0431f15f7149a1ff97fb2` |
| Continuation operation | `16571832702911dab5e37efacb1e0305836f646d57bea9ec71759b3ae28f9f88` |

The original worker receipts were preserved when the separate continuation worker was deployed.

## State at closeout

At **07:19:43 UTC**, the clone was in **legacy mode, revision 4883, generation 203**, configured with actual runtime credentials and writes disabled. It had no invocation running and awaited evidence bundling and disposal. It was not reactivated after rollback. The clone operator made no production mutations.

Subsequent disposal and production acceptance are recorded in the [release closeout](DB_REFACTOR_RELEASE_20261107.md).

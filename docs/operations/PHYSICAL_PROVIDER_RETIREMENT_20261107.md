# Physical retirement of the former provider tables

## Scope and execution status

Migration `036_finalize_provider_retirement.sql` installs an explicit finalizer
for the **112 ordinary tables in `statarena_retired_v1`** and their **62 obsolete
row-type reader functions**. Installing the migration does **not** remove data,
enter a maintenance mode, or authorize a later deletion automatically.

This document describes the implementation and its acceptance gates. A committed
native finalization receipt is required before claiming production execution.
The earlier cutover/roundtrip receipts remain historical evidence of the
reversible phase.

With the two active home-projection tables from migration `035_home_projection.sql`,
the expected durable inventory changes from **304 physical tables to 192**. The
active application model remains **58 physical tables**. The earlier observed
302/56 inventory predates those two additions. These are expected counts until
the operator records the fresh native inventory. Session temporary tables are
excluded. The 98 Pro tables, ten archived
transfer tables, nine authentication tables and 17 source/ingestion tables are
outside this operation. They are neither selected nor deleted to meet a count.

The active `statarena_app` compatibility views and the `statarena_next` typed
views remain necessary: they read the three consolidated stores. Removing their
schemas would break the serving contracts. The existing migration journal,
original cutover manifest, copy/parity checkpoints and recovery evidence remain.

## Recovery decision before deletion

The retained tables are not an independent immutable backup. Replacing an active
source header can cascade into its old retained children. Before finalization,
the supported in-place reversal therefore copies current consolidated data back
into those physical tables and proves exact parity.

**After finalization that in-place path is unavailable.** Recovery requires
restoring the reviewed database snapshot and replaying or otherwise recovering
publications after its recovery point. The saved cutover manifest alone does not
contain a physical backup of table data, indexes, defaults and constraints.

The operator must review actual evidence for all of the following:

1. An available retained snapshot with the intended database identity and
   recovery point, including all 112 old tables and the active/source data.
2. A successful restoration of that exact snapshot into an isolated target,
   with the 112-table inventory and active read contracts checked.
3. Durable preservation and verified readback of the supporting evidence.
   An evidence ZIP contains receipts; it is not itself the database backup.
4. A concrete recovery plan covering publications after the snapshot and an
   explicit decision to replace in-place rollback with snapshot/replay recovery.
5. Native rehearsal of the finalizer, unchanged active reads, subsequent actual
   publication and the final reduced physical inventory before production use.

The recovery proof is an **external operator attestation bound to receipt
hashes**. Neither PostgreSQL nor the CLI contacts the cloud or establishes that a
snapshot exists merely because an input says `available`. The operator must
validate the referenced evidence. Synthetic test digests are never a production
recovery proof.

The snapshot can precede later source publication when the reviewed recovery plan
explicitly covers replay after that point. It need not have the same generation
as the final execution plan. The final execution itself always requires a fresh,
unchanged publication fence under exclusive writer exclusion.

`rematerialize --all` reconstructs serving partitions from retained staging; it
does not restore staging that arrived after the snapshot. Catalogue and support
publication also consult their input receipts, while partition publication can
preserve earlier served values. Do not import newer `worker_inputs` or publication
receipts into an older snapshot without the corresponding serving data. Restore
the reviewed post-snapshot source delta and required immutable object versions
first, retain the snapshot's consistent serving receipts, then requeue partitions
once and continue bounded publication normally. Latest source values alone are
not proof that every intervening historical value or provenance can be replayed.
The recovery plan must identify any source-version loss explicitly. The retained
Neon reconciliation script is pinned to an earlier transfer capture and is not a
general recovery tool for this operation.

### Preserve current data before an actual recovery

The retained pre-retirement snapshot recovers the old 112-table layout at its
recorded recovery point. Physical retirement leaves the current consolidated
serving data, ingestion sources and home projections in place. The historical
snapshot must not replace the live database without accounting for later changes.

Before any actual recovery, preserve a verified, coherent capture of the CURRENT
whole database with a full snapshot or a consistent logical dump. Keep source
and serving rows, input receipts, publication generation, migration journal and
derived projections together. Restore into an empty isolated recovery target.
Do not restore with destructive cleanup into the working primary or the populated
historical clone, and do not import newer receipts independently of their data.

A verified point-in-time restore immediately before finalization may reduce the
recovery gap. No zero-data-loss recovery point is claimed. The repository has no
validated general importer for every post-snapshot database change. Latest source
values may omit intermediate values or provenance. The recovery attestation
confirms review of the procedure and these limits; it does not assert that a
lossless delta replay has already run.

Keep the working production database intact until the reconstructed replacement
passes exact data and serving-contract validation against the preserved current
capture. Rebuilding the old physical layout after finalization requires a
separately reviewed recovery operation. The former in-place rollback command
deliberately remains unavailable.

## Guarded SQL interface

| Operation | Fixed SQL | Effect |
| --- | --- | --- |
| Inspect | `SELECT statarena_app.consolidation_status()` | Reports mode, actual counts, rollback availability and any finalization receipt summary. |
| Review a plan | `SELECT statarena_app.consolidation_retirement_plan()` | Reads exact object identities, structural hashes and dependency blockers; deletes nothing. |
| Finalize | `SELECT statarena_app.consolidation_finalize_retirement($1::jsonb,$2::jsonb,$3::text)` | One atomic transaction using the reviewed plan, recovery proof and explicitly confirmed manifest digest. |

The plan and finalizer are invoker-rights functions, unavailable to `PUBLIC`.
The current record-store owner must execute them. They do not grant role
membership, change owners, or broaden runtime privileges.

The plan binds the installed model, original cutover manifest, database/actor,
current publication generation/timestamp, migration journal, all 112 table OIDs,
their types/columns/constraints/indexes/ACLs, the 62 actual retired function
identities, and the active view/function contracts. Full structural details are
hashed inside PostgreSQL; the returned manifest remains small enough for the
reviewed worker's 100,000-byte JSON argument limit. No row-count scan is presented
as having occurred: the plan reports `row_counts_measured=false`.

The finalizer takes the existing exclusive publication lease, locks the exact
old relations and active provider stores/headers, and repeats the catalogue and
publication-fence checks. Incoming foreign keys, composite-type consumers,
views, unexpected functions/triggers/rules, extension membership, inheritance,
logical publications and detected string-body consumers block retirement.
Untracked external application consumers still require the operator's audit.

Only the 62 verified old function identities are explicitly dropped, followed
by one exact multi-table **`DROP TABLE ... RESTRICT`**. There is no `CASCADE` and no
partial-batch checkpoint. Any failure—including a late receipt failure—rolls
back all drops in that transaction. An unchanged evidence retry returns the
stored receipt; a retry with different evidence is refused.

The operation keeps `mode=active`, preserves serving data and publication
generation, and records `physical_retirement_finalized=true`, zero retained
physical tables, and `recovery_strategy=restore_snapshot_then_replay`.
`consolidation_begin('rollback')` and `consolidation_rollback()` subsequently
reject the request before changing mode or clearing proof checkpoints.
The separate `lineup_consolidation.py --rollback` reader switch remains usable;
it names active compatibility views, not the removed physical copy.

## Explicit CLI invocation

`dashboard/scripts/finalize_schema_retirement.py` defaults to read-only status.
It accepts only the three fixed SQL operations above. The existing connection
mechanism supplies `DATABASE_URL`; do not print that value or store it in evidence.
Pin the expected host/database, keep TLS `verify-full` for remote targets, and
clear ambiguous libpq target/service overrides before use.

```bash
umask 077
mkdir -p private-retirement

python dashboard/scripts/finalize_schema_retirement.py plan \
  --expected-host "$VEGA_RETIREMENT_HOST" \
  --expected-database "$VEGA_RETIREMENT_DATABASE" \
  --receipt private-retirement/reviewed-plan.json
```

Review the exact plan, its blockers and its database-generated `manifest_sha256`.
Prepare the external recovery proof from verified evidence; its format is:

```json
{
  "format": "vega.provider-retirement.recovery.v1",
  "database": "<database from reviewed plan>",
  "model_digest": "<model digest from reviewed plan>",
  "manifest_sha256": "<manifest digest from reviewed plan>",
  "snapshot": {
    "identifier": "<verified retained snapshot identifier>",
    "status": "available",
    "captured_at": "<actual zoned recovery-point timestamp>",
    "receipt_sha256": "<snapshot receipt SHA-256>"
  },
  "restore": {
    "snapshot_identifier": "<same snapshot identifier>",
    "status": "verified",
    "verified_at": "<actual zoned restore-verification timestamp>",
    "retired_table_count": 112,
    "active_contracts_passed": true,
    "receipt_sha256": "<restore acceptance receipt SHA-256>"
  },
  "preservation": {
    "status": "verified",
    "full_readback_verified": true,
    "receipt_sha256": "<evidence preservation receipt SHA-256>",
    "artifact_sha256": "<preserved evidence artifact SHA-256>"
  },
  "recovery": {
    "strategy": "restore_snapshot_then_replay",
    "post_snapshot_publication_replay_reviewed": true,
    "plan_sha256": "<external restore/replay plan SHA-256>"
  },
  "approval": {
    "action": "retire_exact_112_provider_tables",
    "loss_of_in_place_rollback_accepted": true
  }
}
```

The placeholders are intentionally not executable proof. Compute and review the
SHA-256 of each input file. These **file hashes** differ from the database's
manifest digest and from the external recovery-plan artifact digest.

```bash
python dashboard/scripts/finalize_schema_retirement.py apply \
  --expected-host "$VEGA_RETIREMENT_HOST" \
  --expected-database "$VEGA_RETIREMENT_DATABASE" \
  --plan private-retirement/reviewed-plan.json \
  --plan-sha256 '<reviewed plan file SHA-256>' \
  --recovery-proof private-retirement/recovery-proof.json \
  --recovery-sha256 '<reviewed recovery proof file SHA-256>' \
  --confirm-manifest-sha256 '<reviewed database manifest SHA-256>' \
  --receipt private-retirement/finalization-receipt.json
```

The CLI validates bounded, finite JSON, duplicate keys, exact input-file hashes,
object/proof shapes and the explicit target before connecting. It never refreshes
a stale plan silently. A publisher, reader-contract switch or schema change
after review requires a new explicit review of the changed plan. Receipt files
use exclusive creation; a failed attempt does not overwrite a previous receipt.
Standard output contains selected counts/digests/status, not credentials or
business rows. Retain the full committed metadata receipt privately.

## Verification and post-operation evidence

`tests/consolidation_retirement_postgres.py` uses a fresh disposable database,
seeds every mapped node kind (including nonpositive resource IDs), performs the
real copy/parity/cutover and then invokes the explicit finalizer. It exercises
wrong/missing evidence, stale generation, foreign-key/view/type/function
dependencies, unknown targets, runtime permissions, late transactional failure,
idempotent retry and rollback refusal. It checks active data/contract preservation,
installer idempotence, actual post-retirement catalogue/support/detail writes,
least-privilege reads, signed zero and the independent lineup-reader switch.
It also validates the real SQL plan/receipt against the CLI's validation contract.

PGlite substitutes INSERT transport for its unsupported COPY completion protocol.
Its single backend cannot establish independent-session advisory-lock contention;
that case is explicitly reported as unexercised locally and runs on native
PostgreSQL in the normal CI fixture. The existing full reverse-copy/rollback
fixture remains separate and still proves the pre-finalization recovery phase.

The [local acceptance receipt](../verification/db-retirement-20261107/local-acceptance.json)
records the implementation hashes, the 62 passing PostgreSQL/PGlite checks and
20 passing CLI unit checks. This is local acceptance; it does not certify a
restored cloud snapshot or production physical retirement.

Production acceptance must retain the reviewed plan/proof and committed receipt,
actual before/after physical counts, active runtime read acceptance and a normal
publisher continuation. Storage reclamation should be reported from observed
database/cloud measurements, not inferred from a table-count reduction. The
finalizer does not resize storage, run `VACUUM FULL`, change source queues or touch
the separately retained historical schemas.

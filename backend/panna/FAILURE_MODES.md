# PannaData into RDS: failure modes, edge cases and expected outcomes (GH278)

> Résumé : les données PannaData de la saison 2021/22 (année 2021 pour les compétitions annuelles) jusqu'à la date de
> chaque collecte sont lues hors d'AWS et écrites dans RDS en lignes typées, avec toutes leurs colonnes. Ce document
> fixe, avant les tests et avant le code, ce qui peut se tromper et le résultat attendu.

- **Status:** written on 28 Nov 2026 before the tests it names and the code they cover; amended the same day, before
  any test or code, when the user narrowed the period to 2021/22 onwards and the plan moved to deduplicated segments.
  GitHub #278, Linear VI-177.
  GH278-as to ay were added after Fable's review of H1 (M1, M2, m3 to m5, one nit), before their tests and fixes.
  Section 9 (GH278.F-a to j, the fixtures' 14 added columns) was written on 28 Nov 2026 before its tests and code;
  GH278.F-k to r and the rules marked *(review F)* after Fable's review of that lot, before their tests and code.
  Section 8 (S1, GH278.S1-a to t) and the amendments of GH278-ai and GH278-al were written on 28 Nov 2026, after
  Hugo approved the S1 scheme, before their tests and code.
- **Pass H1 (this document's sections 1 to 6):** the Opta fixtures and their event children (`opta-latest`:
  `opta_fixtures.parquet`, the `events_<competition>.parquet` files), every column, through the real CLI, into the
  schemas `panna` and `panna_data`. **Pass H2** (section 7) covers the other families and formats, the tunnel task, the
  role and the daily schedule; nothing of H2 is claimed here.
- **Decisions applied:** no Parquet file is ever downloaded into, stored in or fetched by AWS (no S3, no task storage,
  no byte copy in RDS); every eligible record keeps every column, typed; one as-of date per run; physically identical
  content is stored once and its names kept; nothing of the football schemas changes.
- **Tests:** `backend/tests/test_panna.py` (the CLI against a loopback upstream, a disposable PostgreSQL 18 and a TCP
  relay; the migrate task and the rollback in GH278-ah/al), `backend/tests/test_panna_infra.py` (the templates, the
  image, `secrets.sh` run against a stand-in `aws`), `backend/tests/test_panna_deploy.py` (the real `deploy.sh` with
  the switch), and for S1 `backend/tests/test_panna_s1.py` (the real Pitch writer, migrate task, CLI and
  PostgreSQL 18). Real-file controls are evidence runs, not tests.

## 0. Terms

| Term | Meaning |
|---|---|
| As-of | The UTC date a run reads as « today » (`--as-of`, default the run's UTC date). Every decision of the run uses it. |
| Window | Vega season 2021/22 onwards: a split label `YYYY-YYYY` from 2021-2022; a calendar league's `YYYY` from 2021; a named tournament by Vega's `sporting_season` (`backend/vega/seasons.py`, its `EXCEPTIONS`); qualifiers and friendlies by their day from 2021-01-01. |
| Outcome | What a source row becomes: `eligible` (stored), `eligible_orphan` (stored, flagged: an event whose fixture is unknown but whose own season is in the window), `historical` (before the window), `deferred` (in the window, day after the as-of), `pending` (no signal yet, three days), `unresolved`. |
| Receipt | What a run proved about one asset: its listing, digest and size verified, its footer row count and schema. |
| Dataset | One typed table of `panna_data` (`opta_fixtures`, `opta_events`); every generation and every competition file of a family loads into it. |
| Segment | The rows of one key in one dataset, with one content digest: a fixture row; the events of one fixture. Stored once (`panna.segments`, unique by dataset, key and digest). |
| Stream | One listing name over time (`github`, `opta-latest`, `events_Ligue_1.parquet`). Its loads are its generations. |
| Manifest | What a load changed in its stream: each key whose segment is new or different, or a tombstone. A stream's current state is the latest entry of each key over its complete loads. |
| Scope index | `panna.scope`: each fixture key with its day, edition, outcome and next eligible date; never a data column of a deferred fixture. |

## 1. Rules

- **Window.** Split `YYYY-YYYY` labels: the first year from 2021. Plain or host labels (`YYYY`, `YYYY Qatar`): by the
  competition's declared convention: tournaments (World Cup, Euro, Copa América, Gold Cup, AFCON, Asian Cup, Club World
  Cup) through `sporting_season`; calendar leagues by the year; qualifiers and friendlies by the day. An undeclared
  competition's plain year is decided both ways: when the two conventions disagree (the year 2021), the edition is
  `unresolved`. No row dated before 2021-01-01 is kept through a label: an in-window edition holding such a fixture is
  `unresolved` until the registry declares it.
- **Day.** The source's UTC date as written (`match_date`, `YYYY-MM-DDZ`). A fixture is `deferred` while its day is after
  the as-of, whatever its status; it is written by the first run whose as-of reaches it, the digest unchanged or not.
- **Children.** An event takes its fixture's outcome through `match_id` and the fixture version the run pins. An event
  without a known fixture is decided by its own season (and competition): before the window `historical`, inside it
  `eligible_orphan`; no readable season `pending` for three days from first sight, then `unresolved`.
- **Every column.** Fixture and event columns keep their source types (`string` → `text`, `int64` → `bigint`, `double`
  → `double precision`); nothing is dropped. One conversion is declared, `double` into a `bigint` column, and only when
  every value of the object is an exact integer within ±2⁵³ (not NaN, ±inf or −0.0; NULL stays NULL): the receipt
  keeps the source types and the load records the conversion, so the source values come back by a cast. Any other
  type, a column added or removed upstream stops that object with `SCHEMA_DRIFT`, naming the columns; nothing of it
  is written. (Added on 28 Nov 2026, before its tests, when the full catalog showed two events files storing their
  six integer columns as `double`.)
- **Segments.** A segment's digest is SHA-256 of a canonical encoding of its rows in source order: per value `N` for
  NULL, `T<bytes>:<text>`, `I<integer>`, `D<IEEE-754 bits as a signed 64-bit integer>` (NaN as the canonical quiet NaN),
  joined by `|`, a row ended by `|` and a newline. The server reproduces it from the stored rows. A chunk is a bounded
  run of whole segments: their ledger rows, their data rows and their manifest entries commit in one transaction, after
  the server's digests equal the loader's.
- **Generations.** A load writes only the eligible segments whose digest is not stored, records in its manifest only the
  keys that changed against the stream's previous loads (tombstones for keys gone), and becomes current when it
  completes last. A large object whose eligible segments changed beyond `--churn-limit` (0.5) stops with
  `PARTIAL (CHURN_GUARD)` and writes nothing.
- **Selection.** A run reads exactly the assets it names: `--asset` (names in the release), `--family` (every name of a
  declared family, sorted), or a frozen manifest (`--manifest`, digests and local paths or URLs). Nothing else is listed
  or fetched. Fixtures load before events; an events load needs a complete fixtures load (the one in the run, or the one
  `--fixtures` names) and records it.
- **Bounds.** A run reads one asset at a time; a file it downloads leaves the scratch once its load completes, while
  `prep` keeps its plan's files until `run --plan` loads them. `--database-ceiling-bytes` refuses, before writing, an
  object whose projected size (rows to write × measured bytes per row) would pass it; `--max-seconds` stops between
  chunks. A stop for a bound is `PARTIAL` (exit 3). The run's bounds (ceiling, churn limits, chunk size) are kept in its
  plan, so `retry` keeps them.
- **Transport.** The loader takes a PostgreSQL URL. `--via HOST:PORT` connects through a local port forward while TLS
  still verifies the database's name (`verify-full`, the RDS CA). Each chunk is encoded before its transaction opens.
  Each commit waits for its WAL flush (`synchronous_commit` on); TCP keepalives detect a dead link.
- **Privileges.** The login `vega_v2_panna` (group `vega_panna`, 4 connections) reads and inserts into `panna` and
  `panna_data`, updates `panna`'s control tables, nothing else: no delete, truncate, drop, alter or create, nothing of
  `core`, `agg`, `ops`, `api` or `account`.
- **Output.** JSON lines with counts, digests, names and reason codes; never a row value, a password or a URL holding a
  credential.

## 2. Scope (`probe`, no database)

| # | Plan | Situation | Expected |
|---|---|---|---|
| GH278-a | | EPL `2020-2021` played in 2021; EPL `2021-2022` | `historical`; `eligible` |
| GH278-b | | MLS `2021`; MLS `2020` | `eligible`; `historical` |
| GH278-c | | WC qualifiers `2022 Qatar` dated 2020 and 2021 | by day: `historical`, `eligible` |
| GH278-d | | Euro `2020` played in June 2021; Copa América `2021`; Gold Cup `2021` | `historical` (Vega season 2020/21) |
| GH278-e | | AFCON `2021 Cameroon` played in 2022; World Cup `2022 Qatar` | `eligible` |
| GH278-f | bo | An in-window label holding a fixture dated 2020 | the whole edition `unresolved` |
| GH278-g | bt | An undeclared competition labelled `2021`; labelled `2022`; `2020` | `unresolved`; `eligible`; `historical` |
| GH278-h | | Fixtures after the as-of (thousands of them), and one dated the as-of itself | `deferred`; `eligible` |
| GH278-i | bq | An as-of after today's UTC date | refused, exit 2, nothing read |
| GH278-j | bi | Events whose fixture is unknown: season `2013`; `2022-2023`; unreadable | `historical`; `eligible_orphan`; `pending`, then `unresolved` after three days |
| GH278-k | | Per object | the outcomes add up to the Parquet footer's row count |
| GH278-l | | `probe` on the release of 28 Nov 2026 at as-of 2026-11-28 | the coordinator's control: fixtures 111,584 eligible, 152,507 historical, 6,104 deferred; events 120,871,458 eligible, 114,254,779 historical; else each difference by edition |

## 3. Loading

| # | Plan | Situation | Expected |
|---|---|---|---|
| GH278-m | | Fixtures and events of a release, every edge value (NULL and empty strings, NaN, ±inf, −0.0, non-ASCII, quotes, newlines) | every eligible row stored with every column equal to the source, in order; nothing historical, deferred or unresolved stored; the scope index holds every fixture key |
| GH278-n | br | Server digest against the loader's | equal for every segment written, on the edge values |
| GH278-o | bm | Run on D, then D+3 with the same digests | the second run writes the fixtures dated D+1 to D+3 and nothing else |
| GH278-p | bn | A deferred fixture moved later; another moved to before the as-of | still deferred; written |
| GH278-q | bj | A next generation with one fixture changed and one added; the same rows re-encoded | two segments written, the old generation still readable; 0 rows written |
| GH278-r | bk | A large object with most segments changed | `CHURN_GUARD`, nothing written |
| GH278-s | bl | The same events in two objects | stored once; each stream's manifest names them |
| GH278-t | | Events loaded with no complete fixtures load | refused (`DEPENDENCY_MISSING`), nothing written |
| GH278-u | | Upstream adds or removes a column | `SCHEMA_DRIFT` naming it, nothing of that object written |
| GH278-v | bq | A pass whose projection passes `--database-ceiling-bytes` | refused before writing (`DATABASE_CEILING`), the projection reported |
| GH278-w | | A second run with nothing changed and nothing due | nothing written; the run `complete` |
| GH278-am | | The six integer columns of an events file stored as Arrow `double` (`events_EPL.parquet` and `events_Scottish_Premiership.parquet` of 28 Nov 2026), every value finite, integral and within ±2⁵³, a NULL kept NULL | loaded into the `bigint` columns exactly; the receipt keeps the source types; the load records each conversion; cast back to `double precision`, every value equals the source bit for bit; `probe` reports the conversions |
| GH278-an | | A value of such a column that is not an exact integer (1.5, NaN, ±inf, −0.0, beyond 2⁵³) | the whole object refused before anything of it is written (`LOSSY_CONVERSION`, each column and its count, no value) |
| GH278-ao | | The same rows once with `int64` columns and once with `double` (an upstream type flip, either way) | the same segments and digests; 0 rows written; each load says which types it read |
| GH278-ap | | Any other change of a column's type (a number to text) | `SCHEMA_DRIFT` naming the column; nothing of that object written |
| GH278-aq | | A generation with no eligible row: a stream's first; one after a generation with segments; an asset missing or refused | a complete, empty generation (`panna.current_generations`); its predecessor's keys tombstoned, the predecessor still readable; a missing or refused asset records no generation and the current state stays |
| GH278-ar | | `probe` over the whole catalog with one object refused | every other object still reported; the refused one named; exit 1 |
| GH278-as | M1 | A chunk acknowledged, then lost (a server crash-restart; any committed write the base no longer holds when the load completes) | the load is not completed (`CONSERVATION`: keys missing or stale), exit 1; `retry` writes what is missing; commits wait for their WAL flush, reported at the run's start |
| GH278-at | M2 | The per-chunk server verification as the table grows | the chunk's rows found by a B-tree on `segment_id` (`003_panna_segment_index.sql`), not by the table's unsummarised tail; a base without it refused (`SCHEMA_VERSION`); `explain` prints the plan of the latest segments' verification |

## 4. Transport and resumption

| # | Situation | Expected |
|---|---|---|
| GH278-x | The connection drops in the middle of a chunk (relay) | that chunk rolled back; the loader reconnects and resumes; no segment, row or manifest entry twice; exact counts |
| GH278-y | The answer to a `COMMIT` is lost | the chunk found in the ledger after reconnecting, not sent again |
| GH278-z | A throttled link | the run completes; no transaction idle while a chunk is encoded |
| GH278-aa | The process killed in the middle of an object | `retry` resumes it with no duplicate |
| GH278-ab | Two runners at once | the second exits `ALREADY_RUNNING` (4) and writes nothing |
| GH278-ac | `--max-seconds` reached | stops between chunks, `PARTIAL` (3); `retry` continues |
| GH278-au | The link lost while the server still holds the old session's lock (m3) | the loader waits for the lock with its backoff and goes on; `PARTIAL` (`LOCK_LOST`) only once its attempts are spent |
| GH278-av | `retry` of a run older than a later complete run, or than a later complete load of one of its streams (m5) | refused (`RETRY_STALE`, naming the later run), nothing written; `--force` overrides |
| GH278-aw | `retry` of a run stopped by its ceiling (m5) | the run's own bounds from its plan: stopped again; a bound given to `retry` replaces the stored one |

## 5. Selection and receipts

| # | Situation | Expected |
|---|---|---|
| GH278-ad | `--asset` names from the real release listing | exactly those assets fetched, digests checked against the listing; the receipt records name, asset id, digest, size, footer rows |
| GH278-ae | A frozen manifest with local paths | no listing or download made; each file's digest checked |
| GH278-af | Bytes that differ from the declared digest or size | nothing loaded; `DIGEST_MISMATCH` |
| GH278-ag | A named asset absent from the release | `ASSET_MISSING`, named; nothing else changes |
| GH278-ax | A listed asset without a declared digest | refused (`NO_DECLARED_DIGEST`), never accepted on its size alone |

## 6. Database, privileges, output

| # | Situation | Expected |
|---|---|---|
| GH278-ah | `migrate` without `V2_PANNA_PASSWORD`; with it, twice; a recorded file changed | nothing of panna; applied once, recorded with its SHA-256, the login set (4 connections); the run stops |
| GH278-ai | The login tries `DELETE`, `TRUNCATE`, `DROP`, `ALTER`, `CREATE`, or reads `core`, `agg`, `ops`, `api` | denied. Amended for S1 (section 8), before its tests: the login may use the schema `core` and execute only `core.score_pair_verdict` (a read) and the two functions `panna.apply_score_segment` and `panna.revert_score_application`, beside H1's `panna.segments_as_of` (unchanged; this sentence omitted it until the suite named it, 28 Nov). Amended again on 28 Nov after Fable's review (M1), before its tests: `core.publish_score_pair` and `core.revert_score_selection` are reached only through those two panna functions (SECURITY DEFINER, the same owner), so the login cannot call them with lexemes, a key, a match, a batch or an instant of its own; a direct call is denied. The login still writes H1's panna tables, so a forged segment can reach `panna.apply_score_segment`: the database bounds that call by origin `opta`, a Pitch-owned parent, the identity proof, the half-time phase, the parent's own chronology and final, a complete approval and an instant not in the future. A one-fixture bound the login cannot write (an approval seeded by a migration) is Hugo's decision; until then the login is disabled after the pilot (README, S1). It still reads and writes no `core` table, and it reads `panna.canonical_applications` and `panna.identity_reviews` without writing them. The schema's usage also reaches what every role (`PUBLIC`) already executes in `core`: pure helpers and `core.table_results` (an edition's results by team, read-only, called by the SportScore source as `vega_collect`), left as they are. `vega_collect` holds no `INSERT`, `UPDATE`, `DELETE` or `TRUNCATE` on the three S1 core tables and no right on their sequences. `PUBLIC` executes none of the five functions. Amended for S3 (section 10), before its tests changed: the login also executes `panna.action_batch`, `panna.put_action_sets`, `panna.place_action_sets`, `panna.action_set_encoding` and `panna.action_set_digest` (SECURITY DEFINER, the same owner), reads S3's own relations (`core.observation_sets`, `core.observation_set_revisions`, `core.match_action_sets`, `core.match_actions`, the views `core.match_action_qualifiers` and `core.current_match_action_sets`, `panna.action_field_exceptions`, `panna.source_set_memberships`, and the events objects' batches through the view `panna.action_batches`) and inserts into the two staging tables only; it still reads no other `core` table (`core.observation_batches` included) and writes none |
| GH278-aj | `status`, `verify`, and every error | counts, digests, names, reasons; no row value, password or credential URL |
| GH278-ak | `verify` after a run | every segment's server digest equals its ledger digest; a tampered row is named by its segment |
| GH278-al | Removing the integration (`backend/panna/README.md`, Rollback) | `panna`, `panna_data`, `panna_admin` and the two roles dropped; football schemas, rows and logins unchanged. Amended for S1, before its tests: the login's grants on `core` (the schema, the score functions) are revoked before the role is dropped. Business data does not live in `panna`, so these stay: the three S1 core tables and their rows, the published half-time pair, the Opta key of `core.provider_ids` and the `opta` provider value. The targeted revert (GH278.S1-n) is how a publication is undone |
| GH278-ay | The switch set to `off` after `on` (m4) | the Deploy passes `Panna=false`: the migrate task no longer gets the password, the alarm no longer counts the login, so a rollback is not undone by the next Deploy; an absent switch passes nothing |

## 7. Pass H2 (not covered by H1, nothing of it claimed)

- The other PannaData families and formats in the window: the remaining Parquet families (season partitions,
  ratings by `season_end_year`, current-state snapshots and dimensions), R caches and models (frames by their own
  rows, no opaque copy of old rows), CSV, JSON, tar members, player bios, credits and headshots.
- The transient tunnel task, its session document, the role trusted by the workflow, the daily workflow and its
  stale alarm, the second-day churn measurement.
- The retirement of the collectors PannaData replaces, one scope at a time after validation.

## 8. S1: the half-time pair of one existing Vega match (the PSG–Roma pilot)

Hugo approved the S1 scheme and the PSG–Roma pilot only on 28 Nov 2026 (`schema-vega-propose`, the final dictionary).
This section and the amendments of GH278-ai and GH278-al were written that day, before their tests
(`backend/tests/test_panna_s1.py`) and the code. Fable's review of that evening (M1, M2, m3 to m7) amended the rules
marked *(review)* below and cases l, m, n, p, r, and added u and v, before their tests and code. S2 and later, other matches, the scheduler and the retirement of
sources are not part of S1.

### 8.1 Rules

- **One key, one match.** An application names one Opta key and one Vega match through a scope manifest. The scope
  manifest is the report of the real object, and it holds:
  - the object's digest;
  - the ordinals of the key's rows;
  - the key and the match id;
  - the maximum row count;
  - the digest of each row's 13 lexical fields (the packet);
  - the parent the approval saw.

  Any other cardinality is refused before anything is written. Reading or hashing the whole file authorizes nothing
  beyond the key. The run writes the key's segment, manifest entry and scope row only: no other key, segment, scope
  row or observation.
- **The load.** It is an H1 run of `opta_fixtures.parquet` restricted to the key (`panna.runs.plan.scope`).
  - The receipt keeps the object's digest and row count.
  - The load's outcomes count the key's rows (`eligible`) and the others (`out_of_scope`), and add up to the footer.
  - The manifest entry keeps the key's ordinals.
  - No tombstone is written, and no scope row of another key.
  - *(review)* A scoped load is never the fixtures index of a later events load: after the pilot alone (no complete
    unscoped fixtures load), an events-only `run` or `prep` is refused `DEPENDENCY_MISSING`, as GH278-t.
- **The application.** `panna.apply_score_segment` reads the stored segment and its receipt, never values the caller
  supplies. It keeps one row of `panna.canonical_applications` per (segment, rule version, target relation), updated
  in place, under lock, as its state changes. The states are published, unchanged, observed, pending_identity,
  quarantined, conflict, superseded and reverted.
- **Lexemes.** `^[0-9]{1,3}$` parses a lexeme into goals; any other form, the empty string included, is kept as text
  with NULL goals. A pair is valid when both sides parse. An invalid or incomplete pair is kept and can never win.
- **Contradictory rows.** Rows of the key whose four score lexemes differ give `conflict / DUPLICATE_SOURCE_ROWS`: no
  observation and no publication, and the segment keeps every row and ordinal. Equal rows keep their multiplicity in
  the segment and give one observation.
- **Batch.** One `core.observation_batches` row per published object version: distributor `pannadata`, object name,
  member path NULL, content digest, `issued_at` (the release asset's update instant when the listing gives it),
  first sight, source URL and schema digest.
- **Observations.** Each batch gives the key's `half_time` pair and its `final_reported` pair, both of origin `opta`:
  - source key: the Opta key;
  - source dataset: `opta_fixtures`;
  - both lexemes kept;
  - `effective_at` *(review)*: this activation's issue instant, the object's update instant in the run's own plan
    (`panna.runs.plan`, its asset's `updated_at`), not the first one a receipt or a batch kept for the same bytes;
    else the batch's `issued_at`; else the run's as-of day at 00:00 UTC.

  A replay (the same batch at the same instant) adds nothing. Any other activation adds an observation
  (`revision_no` + 1), even with the same pair, so the latest activation ranks first: A (t1), B (t2), then the same
  bytes as A again (t3) give three observations and the selection follows A, B, A; A (t1), A' with the same pair
  (t3), then B dated t2 received late: B is superseded. An activation without an instant, when the key already has
  an observation from another batch, cannot be ordered; nor can an instant more than five minutes after the
  database's clock, which would outrank every later real generation. Both: no observation,
  `quarantined / GENERATION_NOT_ORDERABLE`.
- **Candidate.** For an origin, key and phase, the candidate is the valid complete pair with the largest
  (`effective_at`, `revision_no`); a NULL `effective_at` comes last.
- **Identity.** It is recorded in `panna.identity_reviews` (entity match, origin opta, the key). The anchor is
  `linked` when all of these hold:
  - it exists, and its parent is Pitch's: source `pitchapi`, no key of a snapshot source;
  - its date is the source's day;
  - its two teams carry the source's oriented names, normalised;
  - its final score equals the source's final pair;
  - no other match of that day joins the same two teams.

  The arbitrated half-time pair is never part of the proof. The other decisions:
  - `ambiguous`: another candidate exists;
  - `no_candidate`: there is no anchor;
  - `rejected`: a check fails, with its code.

  A replay with the same decision and evidence adds no review row. One review is current per key.
- **Ownership.** A parent whose source is a snapshot provider (`open_matchday`, `openfootball`, `openligadb`,
  `international_results`), or that holds a key of one, gives `quarantined / PARENT_OWNED_BY_SNAPSHOT`:
  - the review is `rejected` with that code and `chosen_id` NULL;
  - no `core.provider_ids` row is written;
  - the observations stay;
  - the next snapshot runs normally.

  Any other non-Pitch parent gives `quarantined / PARENT_NOT_PITCH`.
- **Approval.** The parent the scope manifest expects (season, edition, teams, date, status, source) is read again
  under the parent's lock. Any difference gives `quarantined / STALE_APPROVAL`: nothing is written in core except the
  batch and its observations. *(review)* The approval names nine fields (`match_id`, `public_id`, `season_id`,
  `competition_season_id`, `home_team_id`, `away_team_id`, `match_date`, `status`, `parent_source`).
  `core.publish_score_pair` and `core.score_pair_verdict` refuse an approval that lacks one or names another match
  (`invalid_parameter_value`, nothing written). Each field is compared NULL included: an expected NULL holds only
  against NULL. The approval holds neither the parent's cells nor its revision: the operator compares those
  `pilot check` prints with the capture before `apply` (README).
- **Protections.** Each failure leaves no selection and no change to the match:
  - a half-time pair above the final pair (the source's or the parent's): `conflict / HALF_TIME_ABOVE_FINAL`;
  - the parent's first-half goals in `core.match_events`, per side, differing from the pair:
    `conflict / CHRONOLOGY_CONTRADICTS`;
  - *(review, the code's rule since the first version)* a first-half goal that is an own goal, or whose team is
    neither side's: `observed / CHRONOLOGY_UNCLEAR`, the side it counts for not being certain;
  - no goal chronology at all: `observed / CHRONOLOGY_ABSENT`.
- **Locks.** The application takes, in this order:
  1. the Opta key's advisory lock;
  2. the advisory lock `pitchapi:match:<key>` that `Store.save_matches` takes;
  3. the parent row;
  4. its keys.

  The resource versions come last, the edition's then the match's.
- **Publication.** The selection (match, `half_time`) names the winning Opta observation. The two cells change
  together, once, with `revision` + 1, `updated_at`, and the versions of the edition then the match. Cells that
  already hold the pair get the selection and no business change (`unchanged`). A replay changes no business row,
  revision, version or data mark.
- **Capture.** Before an unattributed pair (no selection) is replaced, the parent's two cells are captured as an
  observation: origin `other`, source key the Vega match id, source dataset `core.matches`, no batch and no
  `effective_at`. The old value, even partial, stays readable and never takes Opta's authority. *(review)* When a
  selection starts on cells that already hold the pair, they are captured too if the match's latest capture differs
  from them: the latest capture is always the cells as they were when the current selection began.
- **Corrections.** A later valid Opta observation takes the selection, and the earlier application becomes
  `superseded`. An older generation received late does not. An invalid or missing pair keeps the last valid one.
- **Writers.** `Store.save_matches` never writes the cells of a phase a selection governs.
- **Revert.** `panna.revert_score_application` re-arbitrates only while the application owns the selection: the
  selection is removed, the captured cells are restored (or kept when nothing was captured), with `revision` + 1 and
  the versions once. Otherwise the application is only marked `reverted`. *(review)* What is restored is the cells as
  they were when this selection began, never an earlier selection's capture; nothing changes when they already hold
  it. The request's reviewer is in the command's output line (no column of the approved tables holds it).
- **Purge and restore.** A scope purge removes a match's selection (by cascade) and its keys, and keeps the
  observations and the batch. `open_matchday_restore` counts `core.match_score_selections` among a match's
  dependencies, and has reviewed 185 and 186.
- **Migrations.**
  - `185_core_provider_opta.sql` adds `opta` alone.
  - `186_match_score_observations.sql` adds the three core tables, the three functions and the revocations; both are
    online. *(review)* Its one lock on an existing table, for the key of `core.match_score_selections` on
    `core.matches` (SHARE ROW EXCLUSIVE, which the collector's writes wait for), is asked without queueing (NOWAIT,
    again every 50 ms, for at most 60 s) as the file's last step, and held only until the file commits. A base
    written without a pause for 60 s refuses 186: the migrate task fails, nothing of 186 stays, it can run again.
  - *(review)* `ROLLBACK.sql` runs on a base without the schema `core` while the roles exist on the server.
  - `backend/panna/sql/004_panna_canonical.sql` adds the two panna tables, their two functions and the login's
    grants, after 001–003. Only the migrate task with `V2_PANNA_PASSWORD` applies it.
  - H1's rows are untouched.

### 8.2 Cases

| # | Situation | Expected |
|---|---|---|
| GH278.S1-a | The normal path: a parent written by Pitch (HT NULL/NULL, final 2–2, first-half goals 1–1), the key's row with HT `'1'`/`'1'` and final `'2'`/`'2'` | review `linked`; one batch; observations opta `half_time` 1–1, opta `final_reported` 2–2 and the `other` capture NULL/NULL; the selection; the cells 1–1, `revision` + 1, the edition's then the match's versions + 1 each; the Opta key in `core.provider_ids`; the application `published` (source rows 1, target rows 1); `api.match_list` under `vega_read` gives 1–1. A replay: `published` kept, no business row, revision, version or data mark changes |
| GH278.S1-b | What the scoped run writes | in panna: one segment, one fixture row, one manifest entry with the key's ordinal, one scope row; the receipt's digest and full row count; the load's outcomes `eligible` 1 and `out_of_scope` the rest; the plan's scope |
| GH278.S1-c | A scope manifest that does not fit the object: another digest, a key absent, two rows of the key, another ordinal, a changed lexeme (packet digest), two keys or two matches, more rows than allowed; or whose target lacks one of the nine fields the approval saw (`match_id`, `public_id`, `season_id`, `competition_season_id`, `home_team_id`, `away_team_id`, `match_date`, `status`, `parent_source`; added on 28 Nov after the first green run, before its test) or names another match | refused before any write (exit 2), naming the check (`SCOPE_TARGET` for the target); nothing in panna or core |
| GH278.S1-d | Pitch→Opta→Pitch and Opta→Pitch→Opta, Pitch's row carrying half-time cells | the cells stay 1–1; Pitch's other columns written as before; the re-application `published`, unchanged business rows |
| GH278.S1-e | The parent already holds 1–1, unattributed | selection recorded; application `unchanged`; no revision, version or data mark; no capture |
| GH278.S1-f | The parent holds another valid pair (0–2) | Opta wins: the capture `other` 0–2 readable; cells 1–1; `revision` + 1 |
| GH278.S1-g | Invalid or incomplete lexemes (`''`, `'x'`, `'1000'`, NULL) | observation kept with NULL goals; `observed / INVALID_PAIR`; no selection; cells unchanged; a later valid generation publishes |
| GH278.S1-h | Two rows of the key with different half-time lexemes; two identical rows | `conflict / DUPLICATE_SOURCE_ROWS`, no observation, no publication; identical rows: one observation, published once, the segment holds both rows |
| GH278.S1-i | A half-time pair above the final; a chronology that contradicts it; no goal chronology | `conflict / HALF_TIME_ABOVE_FINAL`; `conflict / CHRONOLOGY_CONTRADICTS`; `observed / CHRONOLOGY_ABSENT`; none publishes |
| GH278.S1-j | No anchor yet, then Pitch creates it; another match of the same two teams that day; another date, other teams, another final; the key linked to another match | `pending_identity` (`no_candidate`), observation kept, then `linked` and published on the same id; `ambiguous`; `rejected` with its code; `rejected` (`KEY_LINKED_ELSEWHERE`). None of them adds a link or publishes |
| GH278.S1-k | A parent of Open Matchday | `quarantined / PARENT_OWNED_BY_SNAPSHOT`, review `rejected` with that code and `chosen_id` NULL, no `core.provider_ids` row, observations kept; the next Open Matchday snapshot of that edition runs |
| GH278.S1-l | The parent changed since the approval (status, edition); *(review)* an expected NULL where the parent holds a value (`public_id`); an approval lacking a field or naming another match, given to `panna.apply_score_segment` by the login outside the CLI; `pilot check` with the database | `quarantined / STALE_APPROVAL`; core.matches and core.provider_ids unchanged; `STALE_APPROVAL`; `invalid_parameter_value`, nothing written; the check's preview gives the same verdicts (exit 1), and `published` (exit 0) on the approved parent, writing nothing |
| GH278.S1-m | Generations A (t1), B (t2), *(review)* the same bytes as A again (t3); an older generation (t0) received late; one dated after the database's clock; a generation without `issued_at` once the key has observations; *(review)* A (t1), A' with the same pair (t3), then B dated t2 received late | three observations, the selection follows A, B, A, `revision` + 1 at each change, the earlier applications `superseded`; the late one observed, not selected; the future one `quarantined / GENERATION_NOT_ORDERABLE`, no observation; `quarantined / GENERATION_NOT_ORDERABLE`; B `superseded / OLDER_GENERATION`, the cells stay A's |
| GH278.S1-n | Revert while owner; re-apply; revert of a superseded application; *(review)* a revert in a cycle that began on cells already holding the pair, after an earlier cycle's capture | selection removed, captured cells restored, `revision` + 1, `reverted`, the line names its reviewer; published again; only marked `reverted`; the cells stay as that cycle found them |
| GH278.S1-o | `Store.save_matches` and an application at once on the same match; an application whose COMMIT answer is lost | no deadlock, both commit, cells 1–1; the retry changes nothing more (one revision) |
| GH278.S1-p | Privileges (GH278-ai amended) | as GH278-ai |
| GH278.S1-q | A scope purge of a match holding a selection, as `vega_collect`; the restore's inventory | the match, its selection and keys removed, observations and batch kept; `open_matchday_restore` accepts the inventory and has reviewed 185, 186 |
| GH278.S1-r | `ROLLBACK.sql` after an application (GH278-al amended); *(review)* on a base without the schema `core`, the roles existing | as GH278-al; no error |
| GH278.S1-s | The migrations: without the switch; with it; on a base holding H1 rows; `pilot apply` on a base the login reaches without 004 (added on 28 Nov after the first green run, before its test). *(Amended with section 9, after its code: the loader now needs 005, so the base before 004 holds 001–003 and 005, which does not depend on 004; 004 then applies alone, total 5)* *(Amended with section 10, after its code: 006 is applied with 004 in the last migration, total 6, `panna applied=2 total=6`; 187 is among core's files)* | 185 and 186 applied, the panna files not; then 004 too; H1's rows, segments, manifests and scope unchanged; the pilot refused before any write (`SCHEMA_VERSION` naming `004_panna_canonical.sql`, exit 1), no receipt |
| GH278.S1-t | Everything `pilot` prints | ids, codes, digests, counts and the pair; no password or credential URL |
| GH278.S1-u | *(review)* After the pilot alone (one scoped fixtures load), an events-only `run`, and `prep` | `DEPENDENCY_MISSING` (exit 1), no events written, as GH278-t |
| GH278.S1-v | *(review)* 186 applied online while a transaction holds a row of `core.matches` for 5 s, a second writer of `core.matches` arriving meanwhile | the migrate task waits for the first and applies 186 (exit 0); the second writer does not wait behind it |

## 9. The fixtures' added columns (`opta_fixtures.parquet` of 28 Nov 2026, 14:18 UTC)

Written on 28 Nov 2026 before the tests `GH278.F-*` of `backend/tests/test_panna.py` and before the code, after H1
refused the release asset 804814591 (SHA-256 `9382c16a…efd163`) with `SCHEMA_DRIFT`: after H1's 13 columns it holds
14 more, `venue_id`, `venue_name` (string), `venue_latitude`, `venue_longitude` (double), `venue_neutral` (bool),
`local_date`, `local_time`, `match_week`, `coverage_level`, `var`, `referee_id`, `referee_name` (string), `attendance`
(double), `match_officials_json` (string). Fixtures only: nothing of events, core or S1's functions changes.

### 9.1 Rules

- **Two schemas.** A fixtures object has H1's 13 columns, or those and all 14 added ones, each in its own Arrow type
  (`bool` is stored as `boolean`). Anything else (an added column missing, a 28th column, another type) is
  `SCHEMA_DRIFT` naming the columns, and nothing of the object is written.
- **The 13 columns as before.** Their segment (`opta_fixtures`), encoding and digest are H1's whatever the schema. A
  key whose 13 values did not change keeps its segment and is not written again, S1's segment included.
- **The extension.** The 14 values of a key's rows, in the same row order, are one segment of the dataset
  `opta_fixtures_ext`, with its own digest over those 14 columns (a boolean is `B1` or `B0`), stored once in
  `panna_data.opta_fixtures_ext`. A key whose 14 values are NULL in every row has no extension segment. The manifest
  entry names both segments (`segment_id`, `extension_segment_id`), and the load names the extension it read
  (`panna.loads.extension`, NULL for a 13-column object). An entry is written when either segment changes: the 13
  values, the 14, or the schema (a 13-column object after an extended one, or the reverse).
- **Reading.** `panna.fixture_rows(load)` gives a complete extended fixtures load's generation, one row per stored
  source row: `source_ordinal`, then the 27 values in the object's column order, in their types. A load without the
  extension is refused (`invalid_parameter_value`): 13 columns are never shown with 14 invented NULLs. *(review F)* So
  is a load of a scoped run: its other keys' entries may come from a 13-column object.
  `panna_data.opta_fixtures_current`, `panna.segments_as_of` and S1's functions read the 13 columns as before.
- **As H1 otherwise.**
  - The churn guard counts the keys whose pair of segments changed.
  - The completion's conservation check covers both segments of every eligible key.
  - `verify` recomputes the digests of both datasets.
  - A scoped load writes the two segments of its keys and nothing else.
  - Ingestion never calls core: no score, link or selection changes because a fixtures object was loaded.
- **Source ordinals.** A manifest entry keeps the first row and the runs of the load that wrote it. *(review F)* For
  `opta_fixtures`, an entry is also written when only a key's rows moved in the object (the same pair, another first
  row or runs), with no row written, so `fixture_rows` gives every generation's exact ordinals. Events keep H1's rule.
- **Order of generations.** *(review F)* A full load whose object is older than its stream's current full
  generation is refused before any write (`OLDER_GENERATION`, exit 1, naming the current digest). Each instant is the
  object's update instant in its run's plan (this activation's, as S1 ranks them), else its receipt's. The same object
  again is a replay. With either instant unknown, nothing is refused (the runbook's manifests carry both). A scoped
  load (S1's pilot) is neither ordered nor counted as the current generation. An older object kept as an earlier
  revision (27 Nov before 28 Nov) is loaded first.
- **Migration 005** (`backend/panna/sql/005_panna_fixture_extension.sql`) adds the dataset and its 14 columns, the
  table and its B-tree, the two columns, the function (the owner's: the login gets no new function, GH278-ai
  unchanged) and the login's `SELECT` and `INSERT` on the new table. It is online: catalog changes, no
  rewrite of H1's tables, the new foreign key validated over NULLs. The loader refuses a base without 005
  (`SCHEMA_VERSION` naming it). H1's loader must not run on a base with 005: it writes no extension pair.

### 9.2 Cases

| # | Situation | Expected |
|---|---|---|
| GH278.F-a | `probe` of an extended object | no drift; the outcomes of its 13 columns; the object reports its extension |
| GH278.F-b | A first load of an extended object whose 14 values hold every edge value (NULL and empty strings, NaN, ±inf, −0.0, true, false and NULL booleans, non-ASCII, quotes, newlines, a JSON text); a key whose 14 values are all NULL | every eligible row's 13 values in `opta_fixtures` and 14 in `opta_fixtures_ext`, the server's digests equal; `fixture_rows` gives each eligible source row's ordinal and 27 values equal to the source (doubles bit for bit), columns in the object's order; the all-NULL key has no extension segment and its 14 values come back NULL; nothing historical, deferred or unresolved stored; no value in the output |
| GH278.F-c | Backward: a 13-column generation, then the extended object with the same 13 values | no row of `opta_fixtures` written, every key keeps its segment id; extension segments written; the first generation still readable, `fixture_rows` refuses it |
| GH278.F-d | Forward: an extended generation, then the 13-column object, then the extended object again | accepted, 0 rows written each time; the keys that had an extension get an entry without it, then with it again; `fixture_rows` refuses the middle load and reads the other two equal |
| GH278.F-e | Corrections in a next extended generation: one key's score, another's attendance and officials, a third gaining its first added value, a fourth losing its only one | one base segment and two extension segments written, every other segment reused; four entries; `fixture_rows` of each generation equals its own source |
| GH278.F-f | A replay of the same extended object | 0 rows written in both tables, no manifest entry, the load complete, `fixture_rows` equal |
| GH278.F-g | One added column missing; a 28th column; `venue_neutral` as string; `attendance` as int64 | `SCHEMA_DRIFT` naming the column, nothing written |
| GH278.F-h | S1's state (a scoped load of one key of a 13-column object), then the extended object. *(review F)* The test's scoped load is this branch's; 005 over rows written by `main`'s loader is the rehearsal's (9.3) | the scoped key keeps its segment id and gains its extension; `verify` 0 mismatch |
| GH278.F-i | A base without 005 | refused before any receipt (`SCHEMA_VERSION` naming 005), exit 1 |
| GH278.F-j | A tampered extension row | `verify` names its segment in `opta_fixtures_ext` |
| GH278.F-k | *(review F)* An extended load stopped by `--max-seconds 0`, then `retry`; one killed after a committed chunk, then `retry` | complete; the generation exact; no row, segment or entry twice |
| GH278.F-l | *(review F)* The link cut when an extended chunk sends its extension rows; the answer to that chunk's COMMIT lost | one drop each; the chunk rolled back and written again, or found committed; the generation exact |
| GH278.F-m | *(review F)* A committed entry whose extension link is lost before the load completes | `CONSERVATION` (stale), exit 1, the load not completed; `retry` refuses again |
| GH278.F-n | *(review F)* A next generation changing only the 14 values of most keys | `CHURN_GUARD`, nothing written; `--allow-churn` writes the extension segments only |
| GH278.F-o | *(review F)* A scoped plan of one key of the extended object | its two segments and one entry naming both; no other key, tombstone or scope row; `fixture_rows` refuses that load; a later full load reuses both segments |
| GH278.F-p | *(review F)* An object older than the current generation; the current object again | `OLDER_GENERATION`, nothing written, the current generation unchanged; a replay |
| GH278.F-q | *(review F)* Two rows swapped in the next object, their values unchanged | 0 rows written; one entry for each moved key, same segments; `fixture_rows` gives each generation its own ordinals |

### 9.3 Rehearsal on the real objects (evidence, not a test)

A clone of the S1 rehearsal base (production at 184, then 185, 186 and panna 001–004, the pilot published by `main`'s
loader), then 005, then the 27 Nov object (13 columns) as a full generation, then the 28 Nov object (27 columns), each
load stopped once and resumed by `retry`. Expected: 005 alone; S1's rows unchanged. The 28 Nov load writes the 25
changed base segments (the coordinator's keywise comparison) and the 5,547 extension segments, and moved keys get
their entries. `verify` finds no mismatch. The 27 Nov object reloaded is refused `OLDER_GENERATION`. A replay writes
nothing. `fixture_rows` equals the coordinator's oracle. The same sequence without the entries of moved keys
(a mutation) fails the oracle's ordinals.

## 10. S3: Opta's detailed actions, one physical copy (`core.match_actions`)

Written on 28 Nov 2026 before the tests `GH278.A-*` of `backend/tests/test_panna_s3.py` and before the code, after Hugo
approved the full schema (`core.observation_sets`, `core.observation_set_revisions`, `core.match_action_sets`,
`core.match_actions`, `panna.action_field_exceptions`, `panna.source_set_memberships`, the view
`core.match_action_qualifiers`) and the backfill from 2021/22. Inputs and the first real cohort:
`s3-actions-preflight-20261128/OPUS-BRIEF.md` (scratch). The `events_*.parquet` objects only; the compact chronology
(`opta_events.parquet`), FBref's `events.parquet` and the tournament timing file are other products, not read here.

### 10.1 Rules

- **One copy.** A match's actions (the rows of one `match_id` of one object, in the object's physical order) are one
  *set*: `core.observation_sets` (origin `opta`, product `match_actions`, subject, schema, content digest, row count),
  its header `core.match_action_sets` (the two labels) and its rows `core.match_actions` (ordinal 0 to n−1). The same
  content from another object, generation or run is the same set: nothing is copied twice. Nothing is written to
  `panna_data.opta_events` or to `panna.segments` for events by this command.
- **Subject and schema.** `subject_key` is `match:<octets>:<native key>`, never a Vega id. `schema_key` is
  `arrow:` then each column of the object as `name:type` in the object's order, comma-separated (`!` after the type
  of a non-nullable field). The object must hold exactly the 17 columns of H1's events, in any order; `match_id`,
  `player_id`, `player_name`, `team_id`, `qualifier_json`, `competition`, `season` as `string` or `large_string`;
  `event_id`, `type_id`, `minute`, `second`, `outcome`, `period_id` as `int64` or `double`; `x`, `y`, `end_x`, `end_y`
  as `double`. Anything else is `SCHEMA_DRIFT`, the object refused before any write.
- **Content digest.** SHA-256 of H1's canonical encoding (`backend/panna/encode.py`) of the 17 source values of each
  row, in the object's column order and the source's own types (`T`, `I`, `D`), rows in source order; a double's `D`
  is its exact IEEE bits (a NaN keeps its own). Without NaN, an `int64` object's set digest equals H1's segment digest
  of the same key. The server recomputes it from the stored rows, header, exceptions and schema before the unit
  commits; a difference aborts the unit (`VERIFY_MISMATCH`).
- **Exact values.** `int64` codes go to the `bigint` columns. A `double` code (EPL and Scottish Premiership) goes there
  when it is a finite integer, not −0.0, within [−2^63, 2^63); else the column is NULL and
  `panna.action_field_exceptions` keeps its 8 IEEE bytes (`float_bits`, big-endian). A coordinate goes to its
  `double precision` column (±inf and −0.0 included) except a NaN, kept as an exception the same way. A label is the
  header's when constant over the set (NULL included); else the header is NULL and each row holding a value has a
  `text_value` exception. No exception row for the normal case; a NULL in the source is a NULL without exception. A
  text holding U+0000, which PostgreSQL's text cannot hold, refuses the object (`UNSTORABLE_TEXT`).
- **Scope.** H1's decision of each key (the fixtures index, then H1's orphan rule): `eligible` and
  `eligible_orphan` keys are stored; every other row is counted, never written. The plan pins the fixtures object
  (`fixtures`, `sha256:<hex>`): when the index is another generation, `FIXTURES_VERSION_MISMATCH`, nothing written.
  A plan's `select` narrows the eligible keys: `keys` (an allowlist), `key_range` (`[low, high)` on the native key),
  `vega_seasons`; the others are `out_of_selection`. Successive selections of one object compose.
- **Provenance.** One `core.observation_batches` row per object version (distributor `pannadata`, the object's name,
  its SHA-256, `opta-latest#<asset id>`, the first activation's instant, the object's URL, the SHA-256 of its
  `schema_key`). `panna.source_set_memberships` keeps, per batch and subject, the set and the subject's rows in the
  object as half-open ranges of physical row numbers (`source_runs`), `ordinal_map` NULL (ordinals follow those rows
  in order). Differential: a subject gets a row when it is new in the stream, its set changed or its rows moved;
  otherwise nothing (a daily replay writes no row). A subject absent from a later object is counted
  (`absent_from_object`); no tombstone, no retraction, no empty set: an absence is not an attested retraction.
- **Revisions.** Per (origin, product, subject): the first set seen is revision 1, current. A different set from a
  later activation (`effective_at`, the run's plan instant of the object) is revision n+1, current, the previous not
  current. The current set again is nothing new. A→B→A gives three revisions and two sets. An instant in the future
  is refused (`FUTURE_INSTANT`). A different set at an instant earlier than the current revision's is a non-current
  revision (history, the current kept); at the same instant from another object, a `conflict`: both sets and
  memberships kept, no revision, counted. An object older than its stream's current generation is refused before any
  write (`OLDER_GENERATION`, H1's rule).
- **Units.** One transaction per chunk of whole sets (`--chunk-rows`): the new sets (rows, header, exceptions, the
  server's digest), the memberships and revisions of every subject of the chunk, the chunk's ledger row in
  `panna.chunks`. A unit run again after a lost link or a lost COMMIT answer finds what committed; a killed run is
  resumed by `retry`. Sets already stored are never sent again. *(Amended on 28 Nov after the first whole-object measurement, before its fix: the staging tables kept every deleted row, 1,060 MB for 3.5 M actions, autovacuum not run during the load.)* The staging tables stay at about one chunk: the loader vacuums them after each committed chunk (the login holds `MAINTAIN` on those two tables only), and autovacuum is set to reach them within 10,000 dead rows. The completion checks conservation in the base: each
  selected eligible subject's state in the stream names a set of its digest, row count and runs.
- **Identity.** No `core.matches` or `core.provider_ids` row is created. The view `core.current_match_action_sets`
  resolves a subject's current set to a Vega match through `core.provider_ids` (`match`, `opta`, the native key,
  current); without a link it stays pending (`match_id` NULL).
- **Privileges.** The login (group `vega_panna`) reads the S3 relations and executes the entry points
  `panna.action_batch`, `panna.put_action_set`, `panna.place_action_set`, `panna.action_set_encoding`; it has no
  INSERT, UPDATE, DELETE or TRUNCATE on them, nor has `vega_collect`; PUBLIC executes none of them.
- **Rollback.** Once `panna.action_field_exceptions` or `panna.source_set_memberships` holds a row, `ROLLBACK.sql`
  refuses and removes nothing (those rows are the only copy of their values); the core S3 tables are never dropped.

### 10.2 Cases

| # | Situation | Expected |
|---|---|---|
| GH278.A-a | A first load of an `int64` object: three eligible keys (one with rows in two runs), one historical, one deferred, one without fixture in the window; constant labels | three sets, each row's 17 values restored in order (ordinals 0..n−1), set digest = H1's encoding and the server's; memberships with their runs; revision 1 current; one batch; no exception; no row in `panna_data.opta_events` or `panna.segments` for events; the others counted |
| GH278.A-b | A `double` object with every edge value: integral codes, −0.0, NaN with a payload, ±inf, 0.5, 2^63 in codes; NaN, −0.0, ±inf coordinates; NULLs, empty strings, non-ASCII, quotes, newlines and a duplicated key in `qualifier_json`; labels varying within a set, a NULL among them | integral codes in `bigint`, the others NULL with exact `float_bits`; NaN coordinates as exceptions, the rest in the columns; label exceptions as the rule says; the readback rebuilds every value bit for bit; `core.match_action_qualifiers` lists the pairs in order with the duplicate |
| GH278.A-c | A column missing; an 18th; `x` as string; `type_id` as int32; a text holding U+0000 | `SCHEMA_DRIFT` naming it, or `UNSTORABLE_TEXT`; nothing written for that object |
| GH278.A-d | The same object again (a replay) | 0 sets, actions, exceptions, memberships and revisions; the load complete |
| GH278.A-e | A next generation changing one value of one key and moving another key's rows; then the first generation's bytes again (A→B→A) | one new set, revision 2; the moved key a membership with its new runs, no set, no revision; then no set written, revision 3 naming the first set: two contents, three activations |
| GH278.A-f | One key in two objects with the same rows; then a third object at the same instant with other rows for it | one set, two memberships, one revision; then both sets kept, `conflict` counted, the current revision unchanged |
| GH278.A-g | A run stopped by `--max-seconds 0` then `retry`; one killed after a committed chunk then `retry`; the answer to a chunk's COMMIT lost | complete; every set, membership and revision once; the restored rows exact |
| GH278.A-h | An object older than the stream's current generation | `OLDER_GENERATION`, nothing written |
| GH278.A-i | Another runner holds the loader's lock; two sessions putting the same set at once through the function | exit 4; one set |
| GH278.A-j | An asset of the plan unreachable (no file, its URL answering 404), another reachable | the first fails, nothing written for it, no tombstone or revision change; the second loaded; the run failed (exit 1) |
| GH278.A-k | A file whose bytes differ from the plan's digest | `DIGEST_MISMATCH`, nothing written for it |
| GH278.A-l | A plan selecting two keys, then one selecting a key range, then the whole object | each run writes only its own keys' sets, the others `out_of_selection`; the last writes only what remained; no set twice |
| GH278.A-m | The plan's fixtures pin not the index's generation; a base without 187 or 006 | `FIXTURES_VERSION_MISMATCH`; `SCHEMA_VERSION` naming the file; nothing written |
| GH278.A-n | The login inserting into the S3 tables directly; `vega_collect` doing so; PUBLIC executing the functions; `panna.put_action_set` called with rows that do not give the declared digest | each refused (privilege); `VERIFY_MISMATCH`, nothing stored |
| GH278.A-o | A subject with a current Opta key in `core.provider_ids`, another without | the first resolves to its match in `core.current_match_action_sets`, the other pending; no row of `core.matches` or `core.provider_ids` written |
| GH278.A-p | `actions verify` on a sound base, then after an action row changed as owner | 0 mismatch; then the set named |
| GH278.A-q | `ROLLBACK.sql` once S3 rows exist | refused, nothing removed |

### 10.3 The first real cohort (evidence, not a test)

The wave-0 cohort of `s3-actions-preflight-20261128` (scratch): the fixtures object `9382c16a…efd163` loaded by H1 as
the index, then the four objects (Brazilian Serie A, EPL, Ligue 1, Saudi League) restricted to their eight keys
(`select.keys`), on a local clone of the S1 rehearsal base (production at 184, 185, 186, panna 001–005) after 187 and
006. Expected: 14,235 actions in 8 sets; every row's 17 values, rebuilt from the base by an independent script with
the oracle's encoding, equal to `pilot-row-oracle.jsonl` and each set's `set_oracle_sha256`; EPL's codes as `double`;
the queries of `expected-readback.sql` without violation, query 3 holding no resolved subject (all eight pending);
a replay writes nothing; a run killed after a chunk and resumed is exact; bytes per action measured (heap, TOAST,
indexes) and projected to the 120,899,239 served actions.

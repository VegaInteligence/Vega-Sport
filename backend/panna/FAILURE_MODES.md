# PannaData into RDS: failure modes, edge cases and expected outcomes (GH278)

> Résumé : les données PannaData de la saison 2021/22 (année 2021 pour les compétitions annuelles) jusqu'à la date de
> chaque collecte sont lues hors d'AWS et écrites dans RDS en lignes typées, avec toutes leurs colonnes. Ce document
> fixe, avant les tests et avant le code, ce qui peut se tromper et le résultat attendu.

- **Status:** written on 28 Nov 2026 before the tests it names and the code they cover; amended the same day, before
  any test or code, when the user narrowed the period to 2021/22 onwards and the plan moved to deduplicated segments.
  GitHub #278, Linear VI-177.
  GH278-as to ay were added after Fable's review of H1 (M1, M2, m3 to m5, one nit), before their tests and fixes.
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
  the switch). Real-file controls are evidence runs, not tests.

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
| GH278-ai | The login tries `DELETE`, `TRUNCATE`, `DROP`, `ALTER`, `CREATE`, or reads `core`, `agg`, `ops`, `api` | denied |
| GH278-aj | `status`, `verify`, and every error | counts, digests, names, reasons; no row value, password or credential URL |
| GH278-ak | `verify` after a run | every segment's server digest equals its ledger digest; a tampered row is named by its segment |
| GH278-al | Removing the integration (`backend/panna/README.md`, Rollback) | `panna`, `panna_data`, `panna_admin` and the two roles dropped; football schemas, rows and logins unchanged |
| GH278-ay | The switch set to `off` after `on` (m4) | the Deploy passes `Panna=false`: the migrate task no longer gets the password, the alarm no longer counts the login, so a rollback is not undone by the next Deploy; an absent switch passes nothing |

## 7. Pass H2 (not covered by H1, nothing of it claimed)

- The other PannaData families and formats in the window: the remaining Parquet families (season partitions,
  ratings by `season_end_year`, current-state snapshots and dimensions), R caches and models (frames by their own
  rows, no opaque copy of old rows), CSV, JSON, tar members, player bios, credits and headshots.
- The transient tunnel task, its session document, the role trusted by the workflow, the daily workflow and its
  stale alarm, the second-day churn measurement.
- The retirement of the collectors PannaData replaces, one scope at a time after validation.

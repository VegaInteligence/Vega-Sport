# SportScore official standings: failure modes, edge cases and expected outcomes (VI-29)

## Stage 5 — 18 November 2026, 17:40 UTC, written before its tests and its code

Fable’s review of `c61e87afda` and Astra’s independent reconciliation drive this stage, including the check
with production at 17:01:24 UTC (`DECISION-ASTRA.md`). On that snapshot, 75 of the 76 scopes have no
competition kind and the World Cup is `international`; no scope has a named native group. So the
first-table gate of `c61e87af` (rule 12b below in its old form: `kind = 'league'` or native groups)
refuses every first table production can produce. The other defects of that commit are:

- the J1 exclusion of migration 147 matches one exact table and expires at a fixed instant;
- the read falls back to Vega's own table even when that table is shorter than the official one, or
  has not been recalculated yet;
- an identical Swedish table proved by the organiser cannot be rebased after a partial catch-up of
  the native calendar;
- content refusals are retried every hour and logged once per attempt;
- the organiser lookup has no test in the repository.

What changes, rule by rule:

| Topic | Contract | Where |
|---|---|---|
| First table, format | One table in an ordinary league or the three evidenced UEFA league phases of 2026/27. Their calendars contain 36 teams and eight fixtures per team in UCL/UEL or six in UECL. Several tables without native groups receive `UNVERIFIED_TABLE`, including USL conferences and World Cup groups | §2.1 rule 12b |
| First table, roster | Compare the exact table, edition-membership and non-canceled counted-fixture identity sets, including clubs scheduled but still on zero. Explicit qualifying-only fixtures can identify clubs from a separate phase. A known omitted club yields `INCOMPLETE_TABLE`. A membership without fixture evidence yields `UNVERIFIED_TABLE` unless the ordinary league has an empty calendar and a complete all-zero table | §2.1 rule 12b |
| J1 quarantine | Migration 150 redefines `api.j1_standings_exclusion()` (same signature) by the misassigned edition alone: competition `l_2ApGa4`, canonical season `2027/2028`, native label `2027`. Row hashes, ids, points, `as_of`, matchdays and the clock play no part. It releases when VI-21 changes either label, or when a reviewed forward migration redefines the function. Stored rows are not touched. Every edition whose read changes gets one version bump | §6.1 |
| Fallback | A missing counted club or changed results can put the official table behind. Replace it only when Vega's aggregate exactly matches current native results and no originally short calendar still leaves a club below the accepted played count. A documented annulment of a previously covered result can lower the aggregate's count | §2.3 |
| Rebase | A repeat whose moved clubs did not catch up keeps its `as_of` and basis, as before. The one exception is a scope with an organiser path (Allsvenskan): there, the repeat rebases on a proof fetched in the same run. A cached proof cannot certify a table after a native change. If the fresh proof is unavailable (`ORGANISER_UNAVAILABLE`) or contradicts the table (`UNVERIFIED_EDITION`), the run is refused and nothing is written. No edition is marked "proved" for later runs | §2.2 |
| Cadence | A SportScore content refusal is retried after the scope's period (2 h). A transport or database failure (`HTTP_*`, `TRANSPORT_ERROR`, `INVALID_JSON`, `TOO_LARGE`, `DATABASE_ERROR`, `ORGANISER_UNAVAILABLE`) keeps the 1 h retry. The hook is `sportscore.retry_after`; an adapter without it keeps `RETRY_AFTER` | §2.1 |
| Failure log | For SportScore, a refusal with the same code and detail as the scope's previous one adds no `ops.parse_failures` row. `ops.source_runs` keeps every attempt (`last_attempt_at`, `status`, `error_code`), the current `detail`, and `repeats`, the number of consecutive attempts with that code and detail (150). A changed reason is logged. Other adapters log as before | §2.1 |
| Organiser | The Allsvenskan lookup (`gql.sportomedia.se`) verifies; it never writes. It is read only under rule 11, or to rebase a repeat. The cache is per process and per (edition, year), and lasts one period plus 5 min. A cached proof is reused only while its six totals per club still equal the widget's | §2.1 rule 11, §6.2 |

Stage 5 adds a 28-record replay with actual production metadata, frozen native standings and fixture
rows, captured Swedish/World Cup/J1 widgets, and production-shaped synthetic controls. The original
54 cases remain in the repository. Named-group positives in S28, S36–S49, S52 and S54 use synthetic
data because the 76 current production scopes supply no native named-group matches.

## Reprise on 18 November — additional cases before implementation

| Situation | Expected |
|---|---|
| All accepted groups are renamed and rearranged, the cross-group table disappears, and there is no independently reviewed retirement | Refuse the body. Keep the cross-group table, each accepted club association, the observation time and the public ETag |
| Groups are renamed with their memberships intact and the cross-group table stays | Accept the complete replacement with the new group names |
| One table splits into disjoint tables with every previously observed member and the same sporting figures | Accept the complete split. The normal point correction and verified phase controls also remain valid |
| Every Allsvenskan club exceeds the internal kickoff count, and the sporting rows agree with the organiser for the exact edition | Accept the full table, including a repeat or a points-only correction. Fetch the organiser only for this calendar guard and preserve SportScore as the writer of the standings |
| A later Allsvenskan match changes W/D/L and goals beyond the internal calendar, with matching season-labelled organiser rows | Refresh the proof and accept the update. A cache match is usable only while its sporting rows still agree |
| The organiser is unavailable, serves a different season or disagrees on sporting rows | Refuse the incomplete-calendar update. Preserve accepted rows, dates, and public ETags |
| The previous year's authentic final table is submitted for the current Swedish season, including a control with unchanged club identities | Refuse the update. A table no longer matches the attested sporting rows just because every team name links |
| The Japanese table corresponds to J1 2026/27 but the candidate edition is labelled 2027/28 in Vega | Do not qualify the table against that target. The primary calendar's season association remains VI-21 |

### Japanese legacy observation already served (additional acceptance before correction)

The organiser's 380-match J1 2026/27 calendar matches Vega's fixtures exactly. The matches were
split between the native 2026 and 2027 editions. The 20 SportScore rows observed in November 2026
belong to J1 2026/27 and are currently attached to the native 2027 edition, whose first stored
kickoff is 13 February 2027. This is positive evidence for this specific already-accepted
observation. A reader-only correction identifies the public competition, its canonical/native
season labels and the full sporting observation. The same rows may be observed again before
the first stored kickoff while the legacy collector is still active.

- Preserve the official stored rows, source and observation times. Bump the affected edition's
  resource version when the migration changes the read. The old HTTP ETag must not produce 304.
- Return the ordinary unavailable response for the current affected edition and explicit
  requests for `2027` and `2027/2028`. A historic edition cannot substitute for the known
  unavailable current one. The bad native association is not an eligible Vega fallback.
- Preserve the exact SQL and HTTP replies of the other 59 observed editions.
- Accept an independent, distinct verified future table on the same public competition. Once
  the observation is represented under the correct edition, return it for that edition and
  maintain explicit unavailability of the still unresolved edition. The local simulation does
  not perform the real calendar resolution.

### Initial official observation (additional acceptance before correction)

| Case | Initial evidence | Expected |
|---|---|---|
| S50 | Ordinary league, three rostered clubs and a scheduled Cedar match. Widget has only the two that have played | `INCOMPLETE_TABLE`. No official rows, 404 when no computed result exists. The complete retry is accepted |
| S51 | Ordinary league has a known complete roster and an empty schedule | Accept a full table with all clubs at zero |
| S52 | Cup's named groups are in the native schedule. A rostered club appears only in a qualifying round | Accept the complete group tables without requiring the qualifying club |
| S53 | A cup body exists but the base cannot establish the table's phase or membership | `UNVERIFIED_TABLE`, last computed view or explicit absence |
| S54 | Both native groups are known, but the incoming named groups swap their club assignments | `INCOMPLETE_TABLE`; keep the computed response and its ETag |

> Résumé : une réponse SportScore HTTP 200 ne remplace un classement officiel accepté que si elle
> décrit entièrement l'édition courante. Une lecture refusée ne vide pas la table, ne la date pas à
> nouveau et ne crée aucun alias. Le classement servi reste l'officiel tant qu'il est complet et
> que les résultats comptés depuis son observation n'ont pas bougé, sinon celui de Vega.

- **Status:** stage 1 written on 18 Nov 2026 at 01:58 UTC, before the first tests (cases S1–S26).
  Stage 2 adds the reconciled pinned-Astra amendments of 18 Nov: completeness of a first table,
  results that move after an observation, attested corrections, and no invented tie-break. It was
  written before the tests of S27–S35 and before migration 138. Stage 3 answers two red witnesses of
  18 Nov. In one, the World Cup's ranking of third-placed teams was dropped while every club stayed
  in its group. In the other, rows of another provider or stage took over the public table. Stage 3
  was written before the tests of S36–S40 and before their code. Stage 4 (this version) answers
  Astra's review of 18 Nov, 11:40 UTC, on the real World Cup body. Two responses were accepted:
  Uruguay left the 12-row third-placed ranking while staying in its group (60 rows became 59), and
  the twelve groups were renamed while that ranking was left out (60 became 48). Stage 4 was written
  before the tests of S41–S47 and before their code. Sol's reprise of the same day added S48–S54, the
  organiser proof and migration 147. Stage 5 (section at the top, §2, §3 S55–S71, §6) answers Fable's
  and Astra's reviews of `c61e87afda`. It was written before the tests of S55–S71 and before their code.
- **Issue:** [VI-29](https://linear.app/vegainteligence/issue/VI-29), track file of the VI-27 audit, so
  that it does not collide with `FAILURE_MODES.md` (§19 belongs to the cups and open-matchday batch).
- **Baseline:** `1b28961a88` (production image `8018e0836c`). The adapter, view and route have the
  same bytes in both.
- **Scope:** `backend/vega/sources/sportscore.py`, migrations `138_sportscore_standings.sql` (one column,
  one function, the `api.standings` selection), `147_j1_standings_observation.sql` and
  `150_sportscore_standings_quarantine.sql` (the J1 quarantine, the fallback rule, two columns of
  `ops.source_runs`), their tests and this file. Stage 5 adds two opt-in hooks to `sources.due` and
  `sources.record_run` that only SportScore sets (SportScore content cadence and refusal deduplication), and the edition
  selector of the read route (147). The HTTP client, the other adapters and their scheduling, the
  identity rules and the site are unchanged. Applied migrations (012, 138, 147) are never edited.
- **Conventions:** those of `FAILURE_MODES.md` §0. Test classes: **CR** fails on the baseline because
  of the defect; **BC** holds on the baseline and must keep holding; **NC** is a new contract.

## 1. What the baseline does (reproduced locally, 17 Nov 2026, 22:33 UTC, and 18 Nov, 02:06 UTC)

`sportscore.run` reads the current edition's table and:

- deletes every stored SportScore row of the edition when a HTTP 200 has `tables: []`, or when one
  name cannot be linked. It bumps the edition's version and returns `ok`;
- accepts a subset: a 3-team table followed by 2 linkable rows stores 2 rows;
- links the last unpaired row to the last unpaired team of the edition ("the last team left"). A
  club of the previous season (`Fjord Rovers`) took Cedar Athletic's row, and its name was stored as
  a SportScore spelling of Cedar;
- stores a missing or non-numeric field as `NULL` over a known value;
- drops silently a second row of the same team (`ON CONFLICT DO NOTHING`), and skips a malformed row;
- raises `AttributeError` on a table that is not an object. `run_due` does not catch it, so one such
  body ends the whole sources pass.

`api.standings` serves an edition's official rows as soon as one exists: one row hides Vega's whole
table, however old the observation and however many results were counted since.

Production (read-only, 17 Nov 2026, 22:51 UTC): fifteen editions have unlinked names. Their last
runs are `ok` with zero rows written. Whether a complete table was lost before is not measured.

## 2. The rules

"Counted" means what Vega's own table counts (`calculator.STANDINGS_SQL`): finished matches with
both scores, of a regular or group round, or of none. `core.table_results(edition)` (migration 138)
gives each club's counted results, `{played, won, drawn, lost, goals for, goals against}`. The writer
and `api.standings` both read that one function.

### 2.1 What a response must be before it replaces anything

Checked in this order. The first failure refuses the whole response with its code. `sources.run_due`
rolls the scope back and records `status = 'error'` with the code. From stage 5 it also records the
detail and the count of identical consecutive refusals in `ops.source_runs` (`detail`, `repeats`,
migration 150). The detail goes to `ops.parse_failures` when the code or the detail differs from the
scope's previous refusal. A content refusal (every code of this table) is tried again after the
scope's period (2 h, `sportscore.retry_after`). A transport or database failure is tried again after
`RETRY_AFTER` (1 h). The HTTP status alone accepts nothing.

| # | Rule | Code |
|---|---|---|
| 1 | The body is an object for `sport = football` and this competition's slug, with a `tables` list (unchanged) | `UNEXPECTED_RESPONSE` |
| 2 | Every table is an object with a `rows` list; at most 30 tables and 100 rows a table (they were cut silently before). Every row is an object with a non-empty `team`, and `pos`, `p` and `pts` known. A known number is an integer (an integral float is accepted, as before; booleans and strings are not). `pos ≥ 1`; `p`, `w`, `d`, `l`, `gf`, `ga ≥ 0`; `pts` may be negative (a deduction) | `INVALID_ROW` |
| 3 | At least one row | `EMPTY_TABLE` |
| 4 | Several tables have distinct names. One table is stored without a name, as before | `DUPLICATE_GROUP` |
| 5 | Within a table, one row per name | `DUPLICATE_ROW` |
| 6 | Within a table, clubs sharing a position have equal points. That is the only invariant every ranking shares; no tie-break order is assumed | `DUPLICATE_POSITION` |
| 7 | A single table holds every position it names: `pos ≤` its row count. Tables of a split may continue one numbering (7–12), so this is not checked across tables | `INCOMPLETE_TABLE` |
| 8 | No name designates a club of the previous or next edition of the competition that this edition does not hold | `WRONG_EDITION` |
| 9 | Every name designates exactly one team of the current edition: a known spelling, or its distinctive words when one team is clearly closest. There is no pairing by elimination | `UNMATCHED_TEAMS` |
| 10 | Within a table, no two rows designate one team | `DUPLICATE_ROW` |
| 11 | If every club is more than 4 matches ahead of the edition's kicked-off matches in counted rounds, require independent season evidence when available. The Swedish league's organiser corroborates the exact native year, each club, and played/W/D/L/GF/GA for one complete table. Other scopes still use the calendar guard | `UNVERIFIED_EDITION` when the organiser serves another season, malformed rows or other totals. `ORGANISER_UNAVAILABLE` when it cannot be read (HTTP error, transport, not JSON; stage 5). `WRONG_EDITION` for a scope without a corroboration path |
| 12 | Every club of Vega's own table (a club with a counted result in the edition) is in one of the response's tables. Each group is not required to hold the edition's clubs | `INCOMPLETE_TABLE` |
| 12b | **First observation only.** Named native groups must form a full partition of the evidenced phase roster. Match each group by normalized name and exact club membership, or by a unique alias with the same club set. An additional cross-group table may reuse clubs from the proven partition. Without native groups, allow one evidenced league table with the exact roster. Use only the confirmed 2026/27 UEFA league-phase schedules and domestic classification inference. Include scheduled fixtures, ignore cancellations, and exclude registered qualifying-only clubs when the separate phase is evidenced. With no calendar, accept only a full all-zero domestic league table | `INCOMPLETE_TABLE`, `UNVERIFIED_TABLE` |
| 13 | Every club of the accepted table that is still a team of the edition is in the response, unless each of its accepted rows is retired (`RETIRED_ROWS`, below) | `INCOMPLETE_TABLE` |
| 13b | Every accepted table stays under its name or as the unique new table with exactly its clubs. This includes rankings whose clubs all appear in other tables. A single table may split into disjoint tables that cover its entire membership and preserve its known sporting totals. A table can be retired through `sportscore.RETIRED_TABLES` for the edition, with reviewer, date and reason. A table may also be added | `INCOMPLETE_TABLE` |
| 13c | Within each table that stays, its accepted clubs stay. A **partition table** owns at least one club no other accepted table holds (a league table, a group). Each of its accepted clubs stays in it. A **cross table** holds only clubs that another accepted table also holds (a ranking of third-placed teams). Its members may change as the competition advances, but each club that leaves must be replaced by a club that joins: it never shrinks. Two exemptions: a club no longer a team of the edition, and a row in `sportscore.RETIRED_ROWS` (`{(LEAGUES key, season label, table name, club's public id): "reviewer, date: reason"}`). A retired row lets that club leave that table of that edition, and nothing else | `INCOMPLETE_TABLE` |
| 14 | A field known in the accepted row of a club stays known | `MISSING_FIELD` |
| 15 | A club's `p` does not go down within the same table, unless the edition's own results attest it: `p` equals the club's counted matches now (a correction the results show, such as an annulled match), or `p` is at most the club's counted matches since the accepted observation (a phase counted from then) | `PLAYED_DECREASED` |

An edition-only club name is affirmative evidence of another edition (`WRONG_EDITION`). The
legacy rule-11 calendar refusal uses the same code for other scopes; the count alone cannot prove
a different season. Allsvenskan can corroborate when the current native label agrees with the
canonical season start. The organiser response decides the code:
- malformed or different rows: `UNVERIFIED_EDITION`;
- unreadable: `ORGANISER_UNAVAILABLE`, a transient code retried after 1 h.

The proof is looked up on demand through the bounded public-source HTTPS client. The process caches
one matching proof per edition and year for up to one refresh period plus five minutes. A different
sporting row always requires a new lookup. A rebase (§2.2) always requires a lookup in its own run.
The organiser is a verification source only: points and positions remain SportScore's fields,
including a complete points deduction, and nothing from the organiser is stored.

Not checked, on purpose:
- points against wins and draws (a deduction breaks it);
- `w + d + l = p` (no evidence the widget guarantees it);
- any order between positions and points (a split shown as one table breaks it);
- the edition's team count. A group's completeness is never inferred from the league's number of
  teams, and rule 12b compares identity sets, never counts.

### 2.2 What an accepted response does

- **The writer's scope:** SportScore's rows of the edition without a stage (it writes none). It reads,
  compares, replaces and dates those rows only. Rows of another provider, or SportScore rows of a
  stage, are left in storage as they are.
- Each stored row keeps its **basis**: the club's counted results when the row was observed
  (`core.standings_official.basis`, migration 138). It is the observation's own record of what it
  could reflect.
- **Same rows as stored** (a valid repeat): nothing is written and the version does not move.
  - The edition's counted results equal the basis (nothing counted since): `as_of` becomes the new
    observation time.
  - Results moved, and every club whose results moved now agrees with its official row: our results
    caught up with the table. `as_of` moves, the basis is updated, the version goes up once.
  - Otherwise SportScore is behind the results: `as_of` and the basis stay, with one exception
    (stage 5). For the Allsvenskan scope, when the native label is the season's start year, the
    repeat is rebased (`as_of` now, every moved basis updated, the version up once) on an organiser
    proof fetched in this run whose six totals per club equal the table's. A proof cached before the
    native change cannot do it. When the fresh lookup fails, the run is refused
    (`ORGANISER_UNAVAILABLE` or `UNVERIFIED_EDITION`) and nothing is written. Nothing marks an
    edition as proved for later runs.
- **Rows without a basis** (written before 138): their first identical repeat records the basis and
  moves `as_of`, unless a counted match finished (`first_finished_at`) after their `as_of`.
- **Different rows:** the edition's SportScore rows are replaced, with `as_of` the observation time
  and the basis now. Each row's spelling is recorded for its team. The edition's version goes up once.
- A correction is accepted like any change: fewer points (deduction), a new ordering, a split into
  named tables that hold every club, a club's new spelling linked by its distinctive words, and an
  attested lower `p` (rule 15).
- A new edition starts with no accepted table. Its first response is accepted when rule 12b holds.
  The previous edition keeps its last accepted rows and their date.

### 2.3 Which table `api.standings` serves (migration 138, fallback of 150)

**One authority.** The official table of an edition is SportScore's current table: its rows without
a stage. Production holds no other (18 Nov 2026, 07:52 UTC: 1,086 official rows in 60 editions, all
SportScore, no key with two providers). Rows of another provider, and SportScore rows of a stage,
stay stored. They are never served, and they neither qualify nor disqualify the official table. A
fresher row of another provider does not replace a club's row, and a row of another phase vouches
for no other scope. Making another provider authoritative takes an explicit change of this view.

An edition's official table is **qualified** unless Vega's table supersedes it.

**Migration 138: superseded when either holds.**
- **Incomplete:** the official table lacks a club of Vega's own table of the edition.
- **Not current:** some row's basis differs from its club's counted results now. A row without a
  basis is current while no counted match finished after its `as_of`.

**Migration 150 (stage 5).** Vega's aggregate must match the current six native sporting totals
and hold every counted club. It may then replace an official table when the observation omits a
counted club or the current results disagree with both the observation and its original basis.
An aggregate remains ineligible when an already short native calendar would drop a club below
the accepted played count, as in Allsvenskan. An annulled fixture can reduce a previously covered
count. The view treats an official row as current when its known sporting fields already match.

| Edition's state | Served |
|---|---|
| Official rows, qualified | the official rows, `fetchedAt` = their `as_of` |
| Official rows not qualified, Vega's table exists | Vega's table, `source: "Vega"`, `fetchedAt` = its `updated_at`. The official rows stay stored with their date |
| Official rows, no Vega table | the official rows, dated (nothing better exists) |
| No official rows, Vega's table | Vega's table |
| Neither | no rows: `/api/standings` answers 404 |

The choice reads data only, never the clock. The same base always serves the same body, so the
content-hash ETag changes exactly when the served table does. A match that finishes after the
observation, even one that kicked off before it, changes the counted results. So do a corrected or
an annulled result. A detail written later (statistics, line-ups, a referee) does not. Refusals
write nothing, so they cannot make a table current again. A closed edition keeps its last official
table. It is served while it stays qualified.

**Closed-edition limit (VI-21).** The collector reads current editions only (`cs.is_current`), so a
closed edition's table is never observed again. Suppose VI-21 later repairs that edition's
fixtures:
- Repaired results equal to the final table make it current again.
- A repair leaving Vega's table shorter keeps the official table (stage 5).
- Fixtures added beyond the final table (pollution from another edition) make Vega's table served.

Nothing re-qualifies a closed edition by observation. A repair of closed editions must check the
served source of each edition it touches.

Affirmative wrong-season evidence refuses the response and leaves the accepted table in storage.
The edition's own data then decides what is served. A new edition that SportScore has not reached
yet has no official rows, so Vega's table is served. No marker is kept for a refused response.
A marker would hide a correct final table when SportScore moves to the next season before our
edition closes. It would also need a write that survives the refusal's rollback, which `run_due`
does not offer.

## 3. Failure modes and expected outcomes

Unless a case says otherwise, it starts from an accepted 3-club table observed at 08:00 UTC: Aster
City 8 (Vega counts 10: a 2-point deduction), Birch Town 7, Cedar Athletic 1. No match of the edition
is stored, and Vega's own table exists (written 07:50). The next read is at 11:00. "Unchanged" means:
the same stored rows, `as_of` 08:00, the same edition version, `last_success_at` 08:00, the same
`/api/standings` body, 304 for the previous ETag. Every 200 is also asked again with its own ETag
(304 expected).

Cases S27–S35 store the edition's matches. "REAL" is a double round-robin of the three clubs:
Aster 2–0 Birch, Birch 1–1 Aster, Aster 3–0 Cedar, Cedar 0–2 Aster, Birch 2–1 Cedar, Cedar 1–0 Birch.
Vega counts Aster 10, Birch 4, Cedar 3; the official table deducts 2 from Aster (8, 4, 3).

| # | Next response or event | Expected | Class |
|---|---|---|---|
| S1 | First observation: a complete table with the deduction | Accepted: 3 rows, `as_of` 08:00, version +1; served SportScore 8, 7, 1 | BC |
| S2 | HTTP 200, `tables: []` | `EMPTY_TABLE`; unchanged | CR |
| S3 | 3 → 2 rows, both linkable | `INCOMPLETE_TABLE`; unchanged | CR |
| S4 | Two names the base does not know | `UNMATCHED_TEAMS` (missing evidence); unchanged | CR |
| S5 | Third row named a club of the previous edition (Fjord Rovers) | `WRONG_EDITION` (affirmative); unchanged; no spelling added to Cedar | CR |
| S6 | Third row a reviewed alias of Cedar (Bluebirds), corrected to 2 points | Accepted on Cedar; version +1; served 8, 7, 2 | BC |
| S7 | Goals scored missing for Aster (known before) | `MISSING_FIELD`; unchanged | CR |
| S8 | A non-numeric points value | `INVALID_ROW`; unchanged | CR |
| S9 | Birch Town listed twice | `DUPLICATE_ROW`; unchanged | CR |
| S10 | Birch and Cedar both 2nd, with different points | `DUPLICATE_POSITION`; unchanged | CR |
| S11 | First observation: two clubs level on points, difference and goals share 2nd | Accepted, both 2nd | BC |
| S12 | First observation: two named groups, each with a 1st, no native group | Stage 5: `UNVERIFIED_TABLE`, no rows, Vega's table served (was: accepted) | CR |
| S13 | The 3 clubs split into two named tables (Top: 1, 2; Bottom: 3) | Accepted as a phase change; two tables | BC |
| S14 | Complete correction: Birch 7 → 4 points (deduction) | Accepted; version +1; served with 4 | BC |
| S15 | Identical table | Nothing written; version unchanged; `as_of` and `fetchedAt` 11:00; the ETag changes with `fetchedAt` | BC |
| S16 | Identical table after a counted match (kicked off 09:00) finished | Nothing written; `as_of` stays 08:00; Vega's table served | NC |
| S17 | S2 at 11:00, again at 12:00, then at 13:00 | Stage 5: 12:00 not due (a content refusal waits the 2 h period); 13:00 refused again; `as_of` and `last_success_at` stay 08:00 | CR |
| S18 | HTTP 503 at 11:00, again at 12:00 | `HTTP_503` both times (a transient failure keeps the 1 h retry); unchanged | BC |
| S19 | No accepted table; the first response refused (S4's names) | `UNMATCHED_TEAMS`; Vega's table served | CR |
| S20 | No accepted table, no Vega table, first response refused | `/api/standings` 404 | CR |
| S21 | A counted match kicked off at 09:00 and finished; S2 at 11:00; a complete new table at 14:00 | 11:00: refused, Vega served (its `updated_at`), official rows kept at 08:00. 14:00: accepted, SportScore served at 14:00 | NC |
| S22 | A play-off match kicked off at 09:00 and finished | Still the official table: Vega's table does not count it | BC |
| S23 | Next season: the edition is closed and a new one is current; SportScore shows the new clubs | New edition accepted; the closed edition keeps its rows, served for its season | BC |
| S24 | New edition current; SportScore still shows last season (Cedar, a club of the closed edition only) | `WRONG_EDITION`; the new edition has no official rows: Vega's table served | CR |
| S25 | A table that is not an object | `INVALID_ROW`; the other scopes of the pass still run | CR |
| S26 | The same 3 clubs, every `p` lower, no result since (a fresh start) | `PLAYED_DECREASED`; unchanged | CR |
| S27 | REAL stored; first observation: Aster and Birch only (rows 1–2 of 3) | `INCOMPLETE_TABLE` (Cedar has counted results); Vega's table served | CR |
| S28 | A group stage (A: Aster–Birch, B: Cedar–Elm Park) stored; first observation: group A only; then both groups | 1st: `INCOMPLETE_TABLE`, Vega's two groups served. 2nd: accepted, two official tables | CR |
| S29 | Aster–Birch kicked off 07:00, in play at the 08:00 observation; it finishes at 08:50; identical table at 11:00; the updated table at 14:00 | 11:00: nothing written, `as_of` stays 08:00, Vega served. 14:00: accepted, SportScore | CR |
| S30 | REAL stored and accepted; Cedar 1–0 Birch corrected to 0–0 at 09:00; identical table at 11:00; the corrected table at 14:00 | 11:00: `as_of` stays, Vega served. 14:00: accepted | CR |
| S31 | REAL accepted; Cedar 1–0 Birch annulled at 09:00; at 11:00 SportScore shows Birch and Cedar with 3 played | Accepted: the lower `p` equals the counted matches | BC |
| S32 | REAL accepted; Aster 1–0 Cedar at 09:00 opens a new phase; at 11:00 SportScore counts that phase only (1, 0, 1 played) | Accepted: each `p` is at most the counted matches since 08:00 | BC |
| S33 | A closed league: the next edition (Aster, Birch, Dune) is current with 1–2 matches kicked off a club; SportScore shows those clubs with 10 played | `WRONG_EDITION` (played counts); Vega's table served; the closed edition keeps its table | CR |
| S34 | First observation: Birch and Cedar share 2nd, equal points, different goal difference | Accepted: no tie-break is assumed | BC |
| S35 | Rows written before 138 (no basis), Vega's table holding the same clubs; a counted match finishes at 09:00; identical table at 11:00; a new table at 14:00 | 08:30: served SportScore. 11:00: `as_of` stays, Vega served. 14:00: accepted with a basis, SportScore | CR |
| S36 | A group stage (A: Aster–Birch, B: Cedar–Elm Park). 08:00: the two groups. 11:00: the same plus a ranking of the second-placed teams (Elm, Birch). 14:00: the two groups only. 17:00: the three tables again | 08:00 and 11:00 accepted (a table may be added). 14:00: `INCOMPLETE_TABLE`, the three tables kept and served. 17:00: a valid repeat, `as_of` 17:00 | CR |
| S37 | S36's three tables at 08:00; at 11:00 the two groups only, the ranking listed in `RETIRED_TABLES` | Accepted: two tables | BC |
| S38 | REAL accepted; an `other` row for Aster (777 points, a stale basis, observed the day before) stored at 09:00; HTTP 503 at 11:00; identical table at 14:00 | 11:00: SportScore served unchanged. 14:00: a valid repeat. The `other` row stays stored, never served | CR |
| S39 | REAL accepted; an `other` row for Aster (777 points, the current basis, observed a day later) stored; HTTP 503 at 11:00 | SportScore served unchanged: Aster 8, no mixed source | CR |
| S40 | REAL accepted; a SportScore row of stage `old-playoff` for Aster (777 points, a stale basis) stored; HTTP 503 at 11:00; identical table at 14:00 | 11:00: SportScore served unchanged. 14:00: a valid repeat; the staged row stays stored, untouched | CR |

Cases S41–S47 start from S36's group stage, accepted whole at 08:00. Group A (Aster, Birch) and group B
(Cedar, Elm Park) are partition tables. The ranking of second-placed teams (Elm 1st, Birch 2nd) is a
cross table: each of its clubs is also in its group. These cases are the World Cup witnesses at small
scale.

| # | Next response or event | Expected | Class |
|---|---|---|---|
| S41 | 11:00: the ranking without Birch (2 → 1 rows), Birch still in group A; 14:00: the three tables again | 11:00: `INCOMPLETE_TABLE`, the six rows, their date and ETag kept (previous ETag 304). 14:00: a valid repeat | CR |
| S42 | Birch 2–0 Aster at 09:00 (group A: Birch 1st, Aster 2nd); 11:00: the groups and a ranking of Aster and Elm (Birch replaced by Aster) | Accepted: the same count, other members, as the stage advances | BC |
| S43 | 11:00: the three tables, Elm with 0 points instead of 1 in group B and in the ranking (a deduction) | Accepted: a complete correction | BC |
| S44 | 11:00: the two groups renamed ("Round 1 / Group A", "Round 1 / Group B"), the ranking left out | `INCOMPLETE_TABLE`: the renamed groups are found by their clubs, so no new phase; the ranking is missing. Kept | CR |
| S45 | 11:00: group A without Birch, Birch still in the ranking | `INCOMPLETE_TABLE`: a partition table lost a club. Kept | CR |
| S46 | Birch's row of the ranking in `RETIRED_ROWS`; 11:00: the ranking without Birch | Accepted: 5 rows | BC |
| S47 | The same retirement; 11:00: the ranking without Elm (Birch kept) | `INCOMPLETE_TABLE`: the retirement covers Birch only | CR |
| S48 | Native groups supplied. Accepted groups are renamed and their clubs rearranged, while the cross ranking disappears | Refuse and preserve all three tables and their ETag | CR |
| S49 | Accepted groups are renamed while memberships and the cross ranking agree | Accept the complete rename | BC |
| S50–S54 | First-table roster, zero-play membership, named phase and swapped groups | See the first-observation acceptance table above | CR, NC |

## 4. Existing expectations adjusted (they encode the defect)

- `backend/tests/test_sources.py::UefaTest::test_sportscore_official_tables` expected a table naming
  two clubs foreign to the edition to delete the accepted table (`standings() == []`), raise the
  version, and return `(0, 2)`. It now expects `SourceError("UNMATCHED_TEAMS")`, the accepted table
  kept and the version unchanged. Its fixture also stores the edition's matches (8 a club): its
  12-played table on an edition with no match at all is, by rule 11, another season's. Its other
  assertions are unchanged.
- `backend/tests/test_calculator.py::ApiViewTest::test_cup_tie_and_standings` expected one official
  row (team 3) to replace the computed 3-club table ("An official table, once observed, replaces the
  computed one"). It now expects that single row to leave Vega's table served, and an official table
  holding the three clubs to replace it.

## 5. Not changed, and what stays open (recorded)

- The public source selection uses persisted sporting data. Operations can inspect the latest
  refusal and the count of consecutive identical details in `ops.source_runs`.
- Other providers retain the existing retry cadence. The reader uses immutable migrations 138,
  147 and 150 over the base view generated by `api_schema.py`.
- The 50 names unlinked in production stay unlinked: no alias is added by this batch. Their scopes
  will read `error` / `UNMATCHED_TEAMS` instead of `ok` after deployment.
- A first table is complete relative to independently recorded club identities, including
  members who have yet to play. A club missing from both native membership and fixtures remains
  unobservable. Grouped scopes without phase membership require VI-21's calendar enrichment.
- The UEFA exception is bounded to the documented 2026/27 league phases. Earlier or future
  formats require their own evidence.
- Sweden is the only independent organiser lookup in this adapter. For Switzerland and other
  leagues, a short calendar can protect a prior official read from a short calculated fallback,
  but cannot itself corroborate a first observation or rebase a stale repeat.
- A league whose play-off rounds are named like matchdays has them counted by Vega's own table. The
  official table then reads as behind after each such match, and Vega's table is served until
  SportScore's table changes. The round names belong to the store, outside this batch. Witness:
  `store.round_stage("bronze")` is `regular`, so the World Cup 2026 bronze final (France 4–6 England,
  match 69466) counts as a fourth group match in Vega's table (146 sides instead of 144). VI-21 owns
  the round mapping.
- A table retired by `RETIRED_TABLES`, or a row by `RETIRED_ROWS`, is only removed at the next
  accepted response; neither has an entry today.
- Partition and cross tables are told apart by the accepted observation's own clubs, not by names.
  When every table holds only clubs found in another (an overall table beside its phase groups),
  every table counts as a cross table: a club may move between them, and none of them may shrink.
- A closed league whose edition is still current, never had an accepted table, and meets
  SportScore's next season (fewer matches for the same clubs) is not detected.

End to end (`tracks/2-ingestion/sportscore-authority/e2e`): the real HTTPS client against a loopback
replay of the widget, `sources.run_due`, PostgreSQL 18, `api.standing_rows`, and the read API
handler as `vega_read`. The script runs every case above on the baseline and on the candidate. It
keeps the bodies, SQL rows, ETags and verdicts.

## 6. Production-shape replay

### 6.1 J1 release

Migration 150 preserves the stored observation while the verified competition and both disputed
labels match. The three public selectors return 404 even after an old worker changes sporting
totals, club IDs or `as_of`. Changing the current-edition pointer can make a separate correctly
labelled edition eligible while the disputed explicit selectors remain unavailable. A genuinely
distinct future edition follows normal rules.

VI-21 owns the release. Verify the full organiser season, fixture and club mapping and accept a
season-labelled SportScore observation under the repaired association before restoring the
affected selector. If the disputed labels still apply after the repair, release them through a
reviewed forward migration. The disposable replay proves selection of another edition and
continued isolation of the disputed one. Production still needs the calendar repair and an
accepted observation before the current quarantine can be released.

### 6.2 Verification sources and receipts

| Source | Scope | Owns or verifies |
|---|---|---|
| PitchAPI | Edition membership, fixture schedule and results | Establishes native club and phase evidence. Supplies the calculated fallback inputs |
| SportScore | Official standings widgets | Writes accepted un-staged standings, including positions, deductions and observation time |
| Allsvenskan organiser, `gql.sportomedia.se/graphql` | Exact native Swedish season and one whole table | Confirms each linked club's played, W/D/L, GF and GA. Retrieved through the shared HTTPS client on demand. Changed sporting totals and rebase require current proof. Refusals store the upstream reason with the SportScore scope |

The immutable historical snapshots, actual widget bodies, provider proof bodies, request logs,
PG18 SQL state, Node responses, second-pass observations and rerun command are in
`delivery/actualisation-main-1633/sportscore-review/sol` of the audit evidence. The Serie A,
UEFA, Liga MX and USL widget-shaped test bodies were reconstructed from captured official rows
and matched to the captured fixtures. They provide fixture/roster controls, not a fresh
fetch of each widget. The World Cup 13-table, J1, Sweden and organiser bodies use saved upstream
responses.

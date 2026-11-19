# Calculation audit of 16 Nov 2026: failure modes, edge cases and expected outcomes

> Résumé : pour chaque constat corrigé par VI-23, ce document fixe, **avant les tests et avant
> toute correction**, ce qui peut se tromper, les cas limites et le résultat attendu. Les tests
> cités en découlent. Les constats d'autres propriétaires sont seulement tracés.

- **Status:** stage 1 of [VI-23](https://linear.app/vegainteligence/issue/VI-23). This file was
  written before the tests it names; no application code, SQL migration or algorithm changed in
  stage 1.
- **Frozen baseline:** `a912ed319e` (branch `codex/calculation-audit-20261117`).
- **Authority:** the Astra/xhigh pre-code amendment of 17 Nov 2026 (`brief-final-amendment.md`)
  overrides `brief-final.md`, which overrides `brief-astra-reconciled.md` and `opus-plan.md`. The
  audit (`Audit_calculs_Vega_Sport_2026-11-16.md`) is evidence, not instructions.
- **Amendment applied:**
  - penalty attempts come only from complete, reconciled shot sets (§7.2, §11);
  - paired xG fields (§7.3);
  - B7 becomes an owner handoff, so its tests are kept out of the runnable suites (§8);
  - a dated, versioned evaluation input (§10.1);
  - the unknown-assist sentence stays in scope, verified end to end (§6.3).
- **Language:** English, because this is the test contract shared with reviewers. The French
  calculation pages are reconciled in batch F.

## 0. Conventions used by every batch

| Term | Meaning |
|---|---|
| Known | A finite number published by the source. |
| Structural zero | A zero implied by another known value of the **same observation**. The only one used here: no shot means no xG and no xGOT (`shots = 0 ⇒ xg = 0`). It only fills a blank and never overrides a published value. The match-level blank-zero rule (068, `agg.match_zeros`) keeps its current scope. It is **not** extended to halves or to the browser. |
| Unknown | `NULL` / `null`. It never becomes 0 in a sum, a difference, a ratio, a leader or a sort key. |
| Support of a derived value | The observations (matches or rows) where **every** input is known. A numerator and its denominator are summed over the same support. A per-90 value uses that support's minutes; a per-match value uses its count. |
| Statistical eligibility | A match counts in a season aggregate only when `status = 'finished'`. This is the team side's existing rule, so `awarded` stays excluded; owners keep the awarded policy. A read of one explicit match (`match=`) is unchanged. |

**Test classification (used in the RED report):**

| Code | Meaning |
|---|---|
| **CR** (confirming reproduction) | Fails on the baseline **because of the audited defect**. The failing assertion is the defect. |
| **BC** (boundary / contract) | Already true on the baseline and must stay true after the fix. |
| **NC** (new contract) | Asserts an interface or field that does not exist yet. On the baseline it fails with a missing field or argument. On its own, such a failure is **not** evidence of a behaviour bug; each batch with an NC test also has at least one CR test. |

An existing test whose expectation encodes a defect is adjusted in stage 1, before the code. Each
adjustment is listed in §12.

## 1. Traceability of every audit item

| Audit item | Finding (short) | Here | Exit status in VI-23 |
|---|---|---|---|
| 1 | Duel attempts derived before zero restoration | — | Handed off to VI-21 (`power.py`) |
| 2 | Unknown non-penalty goals restored as 0 | — | Handed off to VI-21 |
| 3 | League-level MAP gradient and covariance | — | Handed off to VI-21 |
| 4 | Future information in historical contributions | — | Handed off to VI-21 + VI-19 (`lineup.py`) |
| 5 | Matches lost from the simulated season | — | Handed off to VI-19 |
| 6 | Simulation ignores `rho` | — | Handed off to VI-19 |
| 7 | Open-round projection cutoff | — | Handed off to VI-19 |
| 8 | Club metrics computed on unknown primitives | B6 | Fix (client service); display consumers owned by VI-22 |
| 9 (players) | Finishing gap on different samples | B2 | Fix (API and client service) |
| 9 (clubs) | Points − xPts on different samples | B6 | Fix (service fields); the subtraction in VI-22 UI stays a handoff |
| 10 | xPts tail truncation, symmetry, monotonicity | B6 | Fix (JS and SQL law) |
| 11a/b/c | Forecast consistency across routes | — | Handed off to VI-19 (+ VI-21 for history) |
| 12 | Line-up training variable differs from serving | — | Handed off to VI-21 + VI-19 |
| 13a | Club similarity with zero common axes | — | Handed off to VI-22 (style similarity with a league-level penalty, the user's recorded decision) |
| 13b | Missing blocks ranked as 0 | — | Handed off to VI-21 |
| 13c | Metric percentile without per-metric support | B5 | Fix |
| 13d | PCA places empty profiles | B8 | Fix (eligibility; the profiles route stays VI-22's) |
| 14 (in-play) | In-play clock and fit | — | Joint VI-19 / VI-21 interface; not edited here |
| 14 (durations) | Game-state minutes use `minute + added/100` | B7 | **Handoff**: the owned VI-22 display adds and renders the durations, so the fix cannot be delivered safely within VI-23. The contract and RED evidence are recorded (§8). |
| 15a | Neutral venue not symmetric | — | Handed off to VI-19 |
| 15b | Player aggregates without a finished filter | B1 | Fix |
| 15c | Halves: blanks summed as 0 | B3 | Fix (complete-case rows); per-metric route integration with VI-22 stays open |
| 15d | Round not amended after a postponement | — | Handed off to VI-19 |
| 15e | Non-penalty xG divided by all shots | B6, B10 | Fix |
| 15f | Own goals in the club gaps | B6, B10 | Fix |
| 15g | Returns broken by a national-team game | B4 | Fix |
| 16a | xG long-distance rebound | B9 | Fix (constrained, versioned model); no claim of better predictions |
| 16b | 90-minute target not guaranteed | — | Joint VI-19 / VI-21; not edited here |
| 16c | Normative choices of the player score | — | Owners; documented in batch F |
| 17 | Stale documentation | F | Docs only |
| 18 | Reproducible validation | F | Tooling and evidence; real-data results are unavailable |
| New N1 | Server club indicators: count = all matches, mixed supports | B10 | Fix, or a precise handoff if generated contracts block it |
| New N2/N3 | Player list and performance peers without a finished filter | B1 | Fix |
| New N4 | Returns count fixtures whose line-up is unobservable as "missed" | — | Recorded only (depends on VI-21 source deduplication) |
| New N5–N7 | Club xG difference (paired xG fields), red cards, xPts rank | B6 | Fix (service); UI expressions handed off |
| New N8 | Summary sentence prints an unknown assist rate as 0,00 | B5 | Fix; existing-app E2E documented before code (§6.3) |
| New (match tabs) | Unknown xG and tackles become 0 | B5 | Fix |
| New (cups, sources, nations) | Cup bracket, source identities, nation SQL | — | Handed off to VI-19 / VI-21 |

## 2. B1 — Finished-only statistical eligibility (audit 15b, N2, N3)

**Scope:**
- `calculator.py` `PLAYER_SQL` (the `b`, `a` and `st` CTEs) and `PLAYER_STALE_SQL`;
- `agg.refresh_player_list` (new migration, never an edit of 116);
- `agg.refresh_performance_distribution` (the peer histogram);
- the season-level directory reads of `players.mjs` (rollup and appearance-filtered).

**Failure modes:**

| ID | Failure |
|---|---|
| FM-B1.1 | Player statistics of a `canceled`, `postponed`, `suspended`, `in_play`, `not_started` or `awarded` match enter `agg.player_season_stats` (appearances, minutes, sums). |
| FM-B1.2 | The same for `core.player_match_advanced`. |
| FM-B1.3 | A confirmed line-up of a future match increments `starts`. |
| FM-B1.4 | A `finished → canceled` correction keeps the stale aggregate, because the stale delete only tests that some statistics row exists. |
| FM-B1.5 | A player whose only rows are on unfinished matches keeps an aggregate row. |
| FM-B1.6 | `agg.player_list_editions` counts unfinished matches: a future line-up becomes an unknown match, and identity and latest point at an unfinished match. |
| FM-B1.7 | The performance peers (`agg.performance_distribution`) include unfinished matches. |
| FM-B1.8 | The API's season-level reads (rollup and appearance-filtered paths) include unfinished matches. |

**Edge cases:**
- an `in_play` match with live statistics;
- an `awarded` 3–0 that has statistics;
- a `NULL` status (not finished);
- a future confirmed starter with pending player-statistics coverage;
- a player present only in unfinished matches;
- a correction from finished to canceled;
- an explicit `match=` read of a canceled match.

**Expected outcomes:**
- Only finished matches contribute.
- A row disappears when its last finished support disappears, in the calculator and in the player list.
- Identity and latest come from finished matches.
- The team side is unchanged (already finished-only).
- `match=` of the canceled match still returns that match's figures.

**Tests:**
- `backend/tests/test_audit_player_aggregates.py::FinishedOnlyAggregatesTest`
- `backend/api/test/players-support.test.mjs`

**Synthetic league:** `players-support` (API). Matches m1 and m3 are finished. Match 9201 is canceled: p120 played 90 minutes and scored 3 goals for 2.0 xG. Match 9202 is in the future and p120 is a confirmed starter.

| Value for p120 | Baseline | Expected |
|---|---|---|
| matches | 3 | **2** |
| minutes | 270 | **180** |
| unknown minutes | 1 | **0** |
| starts | 3 | **2** |
| goals | 8 | **5** |
| xG | 3.0 | **1.0** |

## 3. B2 — Paired finishing (audit 9, players)

**Failure modes:**

| ID | Failure |
|---|---|
| FM-B2.1 | `finishingDelta` = goals (their own support) − xG (their own support). Audit example: +4 in total, +1.5 per 90. |
| FM-B2.2 | `clinical` requires goals ≥ 4, counting goals scored where xG is unknown; `wasteful` requires xG ≥ 3, counting xG where goals are unknown. |
| FM-B2.3 | The client (`playerAverage`, the PlayersPage averages, `PLAYER_RANKINGS`) repeats the unpaired difference. The home route is already strict and is not part of this finding. |

**Contract:**
- **Paired observation:** an appearance with minutes > 0 where goals **and** xG are both known. The API applies its existing 068 zero rule first. The browser uses the API's values as they are.
- **Aggregate** (additive key): `profile.stats.finishing = {sum, count, minutes, goals, xg}`, where `sum` = Σ(goals − xG) over the paired rows. It is kept in the rollup and appearance paths and in the client accumulator (`aggregateSeason`, `aggregateSeasonPlayers`).
- **`finishingDelta`:** the paired gap on the requested basis:
  - total = `sum`;
  - per match = `sum / count`;
  - per 90 = `90 × sum / minutes`;
  - `null` when `count = 0`.
- **Client values:** `seasonMetric(profile, "finishing", basis)` and `playerAverage(profile, basis).finishingDelta` return the same value.
- **Rankings:**
  - `clinical` requires paired goals ≥ 4;
  - `wasteful` requires paired xG ≥ 3;
  - both are ordered by the paired gap.
  - The 4 and 3 thresholds are the user's and stay as they are.
- **Ordinary totals are unchanged:** `totals.goals`, `totals.xg`, `stats.goals`, `stats.xg`.

**Edge cases:**
- the audit example (1 goal / 1.0 xG, then 4 goals with unknown xG);
- a player with no paired match;
- xG known with goals unknown (wasteful support);
- several players whose unpaired and paired orders differ;
- `basis` total, per match and per 90.

**Expected outcomes:**
- **Audit example:**
  - the gap is 0 in total, per match and per 90 (the baseline gives +4 / +2 / +1.5);
  - the player is not in "Efficaces";
  - totals stay at goals 5 and xG 1.
- **Client ordering example:**
  - A: paired +2 (4 goals − 2.0 xG), unpaired +8;
  - B: paired +3, unpaired +3;
  - so clinical lists `[B, A]`, where the baseline lists `[A, B]`.
- **Wasteful example:** D has paired xG 2 and unpaired xG 6, so D is not wasteful.

**Tests:**
- `backend/api/test/players-support.test.mjs`
- `tests/audit-player-support.test.mjs`
- adjusted expectation in `backend/api/test/players.test.mjs` (§12).

## 4. B3 — Halves, complete-case (audit 15c)

**Scope:** `api.player_half_totals`, through a new migration; 084 is never edited. Its columns,
their order and their types are preserved. `excluded_matches integer` and `excluded_minutes
integer` are appended at the end.

**Failure modes:**

| ID | Failure |
|---|---|
| FM-B3.1 | `sum(coalesce(metric, 0))` turns every unknown into 0. |
| FM-B3.2 | The rates divide by all minutes, including the minutes where a metric is unknown. |
| FM-B3.3 | Halves of unfinished matches count. |
| FM-B3.4 | `chances_created`, which the source never publishes per half, is reported as 0. |

**Contract:**
- A half row counts only if it is **complete**:
  - its match is finished;
  - minutes > 0;
  - touches are known (the row is measured);
  - goals, shots, passes, touches in the box, dribbles, duels won, tackles and recoveries are all known;
  - xG is known, or shots = 0 (structural zero).
- `matches`, `minutes` and every sum cover the complete rows only.
- `chances_created` is the sum of known values over the complete rows, or `NULL`.
- A (player, half) with no complete row has **no row** in the view, so the route answers "unavailable" for it. An empty row would let the VI-22 route round a `NULL` xG to 0.
- No match-level zero flag is used for halves.
- `excluded_matches` and `excluded_minutes` count the eligible half rows (finished, minutes > 0) that were left out. Each has one of two reasons, enumerated in the evidence:
  - unmeasured (touches unknown);
  - incomplete (a required metric is unknown).
- No 5 % stop rule.

**Edge cases:**
- a measured complete row;
- shots = 0 with xG blank (included, xG 0);
- shots > 0 with xG blank (excluded);
- tackles blank (excluded);
- touches blank (excluded as unmeasured);
- a canceled match (ineligible);
- a player with only incomplete halves (404);
- the real fixture's goalkeepers, whose halves carry no touches.

**Expected outcomes:**
- **Synthetic player p130:**
  - first half = {matches 1, minutes 45, goals 1, shots 2, xg 0.6, touches_box 4, dribbles 1, passes 10, touches 30, duels_won 2, tackles 1, recoveries 3}, with excluded 2 rows / 90 minutes;
  - second half = {matches 2, minutes 85, goals 0, shots 1, xg 0.2, touches_box 1, dribbles 2, passes 19, touches 43, duels_won 1, tackles 3, recoveries 4}, with excluded 1 row / 45 minutes.
- **Real fixture `match_m_08LEIz`:** 46 complete rows (20 first-half, 26 second-half).
  - First half: minutes 900, xG 1.11, touches 460, shots 14.
  - Second half: minutes 900, xG 0.49, touches 452, shots 9.
  - Both goalkeepers (`p_4McHHL`, `p_3yNPPF`) have no row: all four of their half rows lack touches.
  - **Trade-off:** goalkeepers' halves become unavailable until the source publishes their touches per half.
  - Of the 46 complete rows, 28 have a blank xG with no shot, so their xG is 0.
  - One half (`p_4EpxW0`, second half) counts 0 shots but publishes 0.03 xG. A published xG is kept as it is: the structural zero only fills a blank, it never overrides a value.
  - The fixture is an example, not a guarantee about other competitions.
- **Not claimed:** per-metric coverage of halves in the VI-22-owned route.

**Tests:**
- `backend/api/test/player-halves.test.mjs`
- `backend/tests/test_audit_player_aggregates.py::HalvesRealFixtureTest`
- adjusted expectation in `backend/api/test/players.test.mjs` (§12).

### 4.1 Each metric's own coverage (137, audit 15c; written before the tests)

The audit asked for each half metric's coverage and observed minutes, as the season aggregates
give them (SOURCE_AUDIT §15, « Mi-temps »). §4 kept complete halves only, and the route published
nothing else. A half missing one metric lost all of its others, and a player without a complete
half answered 404 as if he had not played. In the production census (17 Nov 2026, read-only, six
seasons):
- 216,659 of 2,738,261 eligible half rows were left out (9,691,563 of 105,381,499 minutes);
- 214,383 of them for missing touches alone;
- 15,342 player-season-period groups were hidden entirely although they had positive passing.

The real fixture shows the same pattern: both goalkeepers publish passes, recoveries and duels
per half, but no touches.

**Failure modes:**

| ID | Failure |
|---|---|
| FM-HC.1 | A published metric of an eligible half is dropped because another metric of the same half is unknown. |
| FM-HC.2 | A player whose eligible halves all miss one metric answers 404, as if he had not played. |
| FM-HC.3 | An unknown metric is served as 0 (a NULL summed, or `Math.round(null)`). |
| FM-HC.4 | A metric's rate is divided by minutes in which that metric was not observed. |
| FM-HC.5 | xG's structural zero is applied without an observed zero shots (shots unknown), or over a published NaN or ±∞. |
| FM-HC.6 | Halves of a canceled or unfinished match, or with 0 or unknown minutes, are counted. |
| FM-HC.7 | `first` or `second` changes (values, nulls or shape) for an existing client. |
| FM-HC.8 | The read scans more than the asked player's season. |
| FM-HC.9 | The coverage's exclusions drift from 129's complete-half rule. |
| FM-HC.10 | A stored single-precision xG is read at 6 significant digits (`real::numeric`): 0.12345679 is summed as 0.123457 (Astra review, 18 Nov). |
| FM-HC.11 | The decimal a stored xG is read as depends on the reading session's `extra_float_digits` (`real::text` gives 6 digits at 0, the shortest exact digits at 1 or 3), so one base gives two bodies and two ETags. |
| FM-HC.12 | The sum is converted to binary before the HTTP answer (a `float8` sum, or the binary value of each input): 0.12345679 + 1.2345678 becomes 1.3580245524644852. |

**Contract:**
- **Eligible half:** finished match and minutes > 0, as in 129. A 0-minute half is not played, even when the source credits it a touch.
- **View `api.player_half_coverage` (137):**
  - one row per (season, player, period) with at least one eligible half, complete or not;
  - `matches` and `minutes`: the eligible halves;
  - `excluded_matches` and `excluded_minutes`: the eligible halves outside 129's complete sample. The rule is the same, so they equal 129's columns wherever 129 has a row.
- **Each route metric m:**
  - `m_count`: the eligible halves where m is known;
  - `m_minutes`: their minutes, 0 without any;
  - `m_sum`: its sum on them, NULL without any.
- **Known:**
  - for every metric but xG, not NULL;
  - for xG, a finite value, or a blank with an observed 0 shots.
  - These xG values stay unknown: a blank with unknown shots, a blank with a shot, NaN, +∞ and −∞.
- **Route:**
  - `first` and `second` are unchanged: 129's complete halves, or null without one.
  - `coverage.first` and `coverage.second` are each `{matches, minutes, excluded: {matches, minutes}, stats}`, where `stats` maps every route metric to `{sum, count, minutes}`.
  - An unmeasured metric is `{sum: null, count: 0, minutes: 0}`, never 0. A period without an eligible half is null.
  - **xG precision:**
    - each stored single-precision xG is read as its shortest decimal that reads back as the same stored value, PostgreSQL's own shortest output forced whatever the session's `extra_float_digits` (`core.real_decimal`);
    - these decimals are summed exactly (`xg_sum numeric`);
    - the route converts the sum to a JSON number once, at the end. The binary input (0.12345679104328156 for 0.12345679) is never what is summed.
  - The route reads both views in one statement, each filtered by the season and player asked.
  - **Types:** every `sum`, `count` and `minutes` is a JSON number (or `sum: null`). The legacy `first.xg` stays 129's float sum rounded to 2 decimals, so it is not the coverage's exact sum.
  - **Journal:** 137 was corrected in place before any release. It is only on `codex/audit-1-linear` (`c3c8232747`): not on `main`, and production runs `8018e0836c`. Disposable test bases re-create their schema. An environment that applied the first 137 must recreate the view (`MIGRATION_CHECKSUM_CHANGED` otherwise).
- **Rate:** 90 × `sum` / `minutes` of the same metric.
- **404:** only for a player without an eligible half in the season. A player with eligible but no complete halves answers 200, with `first` and `second` null. This replaces §4's 404 for such players, whose prior assertions were `player-halves.test.mjs` (Demi Inconnu) and `players.test.mjs` (p_aaaab1).
- **Site:** unchanged. `halfRows` reads `first` and `second` only. It shows the same tables and still hides a player without complete halves. Showing `coverage` is a frontend change, and needs a design the user approves.

**Expected outcomes** (synthetic seed of `player-halves.test.mjs`, season 2025/2026):

| Player | Status | `first` / `second` | Coverage |
|---|---|---|---|
| Moitiés Test (p_aaab30) | 200 | unchanged (§4) | First half: 3 halves, 135 min, excluded 2 / 90. Touches 50 on 2 halves / 90 min (50 per 90, not 33.3), tackles 1 / 90 min, passes 23 / 135 min, xG 0.7. Second half: 3 / 130, excluded 1 / 45, xG 0.2 on 2 halves / 85 min. |
| Demi Inconnu (p_aaab31) | 200 (was 404) | null, null | First-half xG unmeasured (a shot without xG), passes 4. Second-half recoveries unmeasured, structural xG 0 on 1 half. |
| Passe Seule (p_aaab32) | 200 | null, null | First half: passes 14 on 1 half / 45 min, every other metric unmeasured. Second half: null (0 and unknown minutes). |
| Non Fini (p_aaab33) | 200 | null, second half m1 | First-half xG unmeasured (NaN, +∞, −∞), shots 3. Second half: xG 0.4 and shots 1 on 1 half (m3's shots are unknown, so its blank xG stays unknown). |
| Rien Mesuré (p_aaab34) | 200 | null, null | 1 half (45 min and 30 min), excluded entirely, every metric unmeasured. |
| Hors Saison (p_aaab35) | 404 | — | Only a canceled match, a match not started and a 0-minute half. |
| Zéro Observé (p_aaab36) | 200 | first: all 0 | Every metric 0 on 1 half / 45 min (a measured zero, unlike Rien Mesuré). |
| Précision Fine (p_aaab37) | 200 | first xG 1.36, second xG 0.12 (129, unchanged) | First half, three values: xG 1.35802459 on 3 halves / 135 min (0.12345679 + 1.2345678 + a structural 0). It is not 1.358027 (6 digits) and not 1.3580245524644852 (binary). Second half, one value among mixed rows (supported 0.12345679, a blank with 2 shots, NaN): 0.12345679 on 1 half / 45 min. The same body and ETag at `extra_float_digits` 0, 1 and 3. |

Expected decimals:
- The stored values are exact in `half-fixture.mjs`.
- They were computed by an oracle independent of PostgreSQL (Python `struct` and `decimal`): `tracks/1-linear/half-coverage/precision/binary32_oracle.py` in the track evidence.

**Real fixture `match_m_08LEIz`** (FC Orenburg–CSKA Moscow, 1 Nov 2026):
- The goalkeepers Bogdan Ovsyannikov (`p_4McHHL`) and Maksim Borisko (`p_3yNPPF`) answer 200 (were 404), with `first` and `second` null:
  - Ovsyannikov: passes 2 and 7, recoveries 6 and 6, duels won 0 and 2;
  - Borisko: passes 6 and 5, recoveries 9 and 5, duels won 2 and 1;
  - for both: touches unmeasured, structural xG 0, 1 half / 45 min each.
- Damián Puebla (`p_02x0dj`) is unchanged: first half xG 0.28 and shots 3. His coverage equals his totals.
- Egor Nazarenko (`p_3o0rP8`) stays 404: his only row is a 0-minute second half (1 touch, 1 pass).
- Astra's probe, with Puebla's first-half xG set to the stored value of 0.12345679: `coverage.first.stats.xg` is `{sum: 0.12345679, count: 1, minutes: 45}`. It was 0.123457, an error of +0.00000021, while the legacy `first.xg` stays 0.12.
- Over the 28 players:
  - first half: 22 halves / 990 min, excluded 2 / 90, passes 226 / 990 min, touches 460 / 900 min;
  - second half: 28 halves / 990 min, excluded 2 / 90, passes 185 / 990 min, touches 452 / 900 min.

**Tests:**
- `backend/api/test/player-halves.test.mjs` (synthetic, through the route; bounded statement; view identity);
- `backend/api/test/player-halves-real.test.mjs` (the real match, written by the collector's path);
- adjusted expectation in `backend/api/test/players.test.mjs`.

## 5. B4 — Returns from absence on the club stream (audit 15g)

**Failure modes:**

| ID | Failure |
|---|---|
| FM-B4.1 | A national-team appearance during the absence reads as a change of club, so the return is lost (audit: 3 matches back, 60 minutes → no return). |
| FM-B4.2 | A national-team appearance after the return ends the current return. |
| FM-B4.3 | Appearances of unfinished matches (`APPEARANCES` has no status filter) break or create absences, while the club calendar (`TEAM_DATES`) is finished-only. |

**Contract:**
- **Appearances read:** finished matches of non-national teams (`core.teams.is_national IS NOT TRUE`), in chronological order.
- **Unchanged:**
  - a real transfer still stops a return;
  - same-day distinct matches are both kept (no date-only deduplication);
  - the appearance-based usual-minutes definition;
  - the curve definition.
- **Version:** the stored curves carry a new model version (the stream definition changed).

**Edge cases:**
- a national-team game during the absence;
- a national-team game after the return;
- a transfer after the absence;
- a canceled club match during the absence;
- two finished club matches on the return day.

**Expected outcomes (refresh at week 18):**

| Player | Club matches | Expected return |
|---|---|---|
| 7001 | weeks 0–7 at 90 minutes; back weeks 14 (30), 15 (60), 17 (90); national games at weeks 10 and 16 | days 49, missed 6, usual 90, bucket `30_59`, matches back 3, minutes back 60 |
| 7002 | weeks 0–7, then back at another club | none |
| 7003 | weeks 0–7; a canceled club match at week 10; back weeks 14 (45), 15 (45) | days 49, missed 6, matches back 2, minutes back 45 |
| 7004 | weeks 0–7; back at week 14 in two matches (60, 30), then week 15 (90) | matches back 3, minutes back 60 |

- **Curve** (with `MIN_RETURNS = 1`), bucket `30_59`:
  - match 1: 3 returns, mean 45.0;
  - match 2: 3 returns, mean 45.0;
  - match 3: 2 returns, mean 90.0;
  - usual minutes 90.0 throughout.
- The stored version is not `returns-v1`.

**Tests:** `backend/tests/test_audit_models.py::ReturnsClubStreamTest`.

## 6. B5 — Per-metric percentile support, match tabs and the summary sentence (audit 13c and new)

### 6.1 Percentiles

**Failure modes:**

| ID | Failure |
|---|---|
| FM-B5.1 | `performanceProfileFromCounts` checks only the global peer count. A metric known for 1 peer out of 100 gets a percentile (audit: 50). |
| FM-B5.2 | The browser path (`performanceProfile`) does the same with the sorted distributions. |

**Contract:**
- A metric's percentile requires `peers ≥ 30` **and** the metric's own known count ≥ 30 (same `MIN_PEERS`).
- Derived rates use their own known count (the count of peers whose derived value exists).
- Midrank ties stay.

**Expected outcomes:**

| Case | Expected percentile |
|---|---|
| 100 peers, 1 xG known | `null` |
| shots known for 100 peers (50 below, 1 equal) | 51 |
| 29 known | `null` |
| 30 known | `round(100 · (below + equal/2) / 30)` |
| all 30 tied | 50 |
| observed 0 (40 known, 0 below, 10 equal) | 13 |
| a derived rate known for 10 of 40 peers (browser path) | `null` |
| global peers < 30 | everything `null` (unchanged) |

**Tests:** `tests/audit-player-support.test.mjs`.

### 6.2 Match tabs (`match-tabs.js`)

**Failure modes:**

| ID | Failure |
|---|---|
| FM-B5.3 | `shootersOf` adds `s.xg ‖ 0`, so a shot without xG counts as 0 and the shooter's xG looks known. |
| FM-B5.4 | `threat = (xg ?? 0) + (xa ?? 0)`, so a player whose xG is unknown can lead the "most dangerous" card on his xA alone. |
| FM-B5.5 | `recovered` is computed when only tackles **or** only interceptions is known. |

**Contract:**
- The API's players family omits a statistic the source did not publish; there is no zero restoration, as checked in `api.match_player_stat_rows` and `match-families.mjs`. The browser does not invent zeros from other players.
- A shooter's xG is `null` if any of his shots lacks xG. His shots and goals stay known. A shooter with unknown xG sorts after the known ones.
- `threat` requires xG and xA. `recovered` requires tackles and interceptions.
- An unknown value can never lead and always sorts last (existing `sortRows` rule).

**Real players family (`match_m_08LEIz/players.json`):** 29 players played.
- 13 have neither shots nor xG published, so their threat is `null`.
- The threat leader is among the players with both xG and xA known.

**Tests:**
- `tests/audit-match-tabs.test.mjs`
- adjusted expectation in `tests/match-tabs.test.mjs` (§12).

### 6.3 Summary sentence (N8)

**Failure:** `PlayerScoutOverview` `ScoutReading` prints `fmt(goals.value ?? 0, 2)` and `fmt(assists.value ?? 0, 2)`. A known scoring rate next to an unknown assist rate therefore reads « … but et 0,00 passe décisive par 90 min ».

**Expected:**
- the « Production » line states only the known rates;
- an unknown rate makes no claim at all (no 0,00);
- with neither rate known, there is no line (unchanged);
- the card's layout, its other lines and its position are unchanged.

### 6.4 End-to-end check for N8 (documented before the code; executed by the coordinator)

Per the amendment (§5), this display correction is verified on the real application, not by a
post-implementation unit test.

- **Setup:**
  - the local read API on the API test database, seeded by `backend/api/test/seed.py`;
  - the site in development mode, pointed at that API through the coordinator's local real-API bridge;
  - this is run once the test suites have released the database.
- **Input:** player `p_aaaab1` (Élie Durand), season 2025/2026. The seed gives him 2 goals in 260 minutes (0.69 per 90) and **no assist observation** (the directory test reads `assists: null`).
- **Steps:** open the player's page, « Profil » tab, then the « Lecture du scout » card.
  - Desktop capture: 1440 × 1000.
  - Mobile capture: 390 × 844.
- **Expected before the fix (baseline, the defect):** the « Production » line reads « Production : 0,69 but et 0,00 passe décisive par 90 min… ».
- **Expected after the fix:** the line states the scoring rate (0,69 but par 90 min) and no assist figure. The note sentence (if any), the other lines and the card layout are unchanged.
- **Control:** a player with both rates known keeps both figures.
- **Evidence:**
  - screenshots before and after (desktop and mobile);
  - the rendered card text;
  - the API response for the player;
  - the exact URLs and the commit or diff hash.

### 6.5 Minutes per goal or assist (N9, stage 3; written before the correction)

Found by the coordinator's real-application run after N8 (`context/browser-candidate1-*`), confirmed by
the Astra/xhigh interim review (`context/astra-interim-contributions-review.md`).

**Failure:** `PlayerScoutOverview.jsx` computes `(goals ?? 0) + (assists ?? 0)` for the headline KPI
« Min. par but ou PD » (`SeasonKpis`) and for the competition table's « Min / B+PD » (`PlayerGames`),
and divides **all** the minutes by it. `total()` accepts any observation, so:

| ID | Failure |
|---|---|
| FM-N9.1 | Unknown assists count as 0: 2 goals, 260 minutes, no assist observed → « 130′ » and « 2 contributions ». |
| FM-N9.2 | Unknown goals count as 0: 1 assist → « 260′ ». |
| FM-N9.3 | Partial or disjoint observations: goals and assists each known on some matches only, the minutes of every match divided by their sum → « 87′ ». |

**Contract.** One helper, `contributionRate(profile)` in `season-player.js`, read by both displays. It
returns `{minutes, count}` only when:
- goals and assists are both finite sums known on **every** played match whose minutes the profile counts (each statistic's `count` equals `profile.matches`; played means minutes > 0, as `aggregateSeason` and the API count them);
- `matches > 0` and the minutes are finite and positive;
- `count = goals + assists > 0`.

Otherwise it returns `null`: the displays keep « — » and omit the « contributions » note. The ordinary
goals, assists and minutes keep their values, and the layout is unchanged. No paired subset of the
matches stands in for this full-scope rate: a player observed on some matches only has no rate.

**Cases** (the coordinator's seven browser fixtures, 3 played matches of 90, 90 and 80 minutes):

| Case | Rows (goals, assists) | Expected |
|---|---|---|
| unknown assists | (2, —), (0, —), (0, —) | — , no note; goals 2, minutes 260 kept |
| unknown goals | (—, 1), (—, 0), (—, 0) | — , no note |
| partial assists | (2, 0), (0, —), (0, 1) | — , no note |
| disjoint | (2, —), (—, 1), (—, 0) | — , no note |
| complete, zero assists | (2, 0), (0, 0), (0, 0) | 130′, 2 contributions |
| complete, positive | (2, 1), (0, 0), (0, 0) | 260 / 3 = 86.7 → « 87′ », 3 contributions |
| zero contributions | (0, 0), (0, 0), (0, 0) | — , no note, no division by zero |

Edge cases: no played match; zero or non-finite minutes; a non-finite sum.

**Tests:** `tests/audit-contribution-rate.test.mjs` (service level, profiles built by the real
`aggregateSeason`). **E2E:** the coordinator's seven-case real-browser matrix, desktop and mobile, KPI and
table: 70 assertions, 46 pass and 24 expected failures before the correction
(`context/browser-contributions-red-*`); the coordinator reruns it after the correction.

## 7. B6 — Club descriptive metrics and the xPts law (audit 8, 9 clubs, 10, 15e, 15f, N5–N7)

**Scope:**
- `club-scout.js`: metrics, `teamRows`, `outcomeChances`, cohort fields, `opponentStrength`;
- the SQL law used by `api.match_xpts` and by the calculator's team `xpts`.

### 7.1 Primitives and support

**Failure modes:**

| ID | Failure |
|---|---|
| FM-B6.1 | Arithmetic runs before the null checks. Audit row: `keeper −2`, `fieldTilt 100`, `boxShare 100`, `duels 100`, `aerials 100`, `ppda 20`, `defActions 10`. |
| FM-B6.2 | Every metric is gated on both xG values (`has`), so possession, duels and others are dropped when xG is missing. |
| FM-B6.3 | Ratios add numerators and denominators from different matches. |
| FM-B6.4 | Red cards total 0 when nothing was observed. |

**Contract:**
- Each metric reads only its own inputs.
- A match counts for a metric only when every input is finite (its support).
- A ratio sums numerator and denominator over the same support.
- A denominator ≤ 0 gives `null`.
- Known zeros are kept.
- `red` = the sum over matches where red cards are known, or `null` when none is.
- Per-metric coverage is published as `club.coverage[key]` (an integer per `METRICS` key).

**Formulas** (each over its support):

| Metric | Formula |
|---|---|
| `keeper` | mean of opp.xgot − (ga − own goals conceded) |
| `fieldTilt` | Σown.oppHalf / Σ(own.oppHalf + opp.oppHalf) |
| `boxShare` | Σown.touchesBox / Σ(own.touchesBox + opp.touchesBox) |
| `duels` | Σown.duels / Σ(own.duels + opp.duels) |
| `aerials` | Σown.aerials / Σ(own.aerials + opp.aerials) |
| `ppda` | Σopp.ownHalfPasses / Σ(tackles + interceptions + fouls) |
| `defActions` | mean of (tackles + interceptions) · 50 / (100 − possession), with possession < 100 |
| `passAccuracy` | Σaccurate / Σpasses |
| `directness` | ΣlongBalls / Σaccurate |
| `boxShots` | ΣshotsIn / Σshots |
| `setShare` | ΣxgSet / Σxg |
| `placement` | mean of xgot − xg |

**Edge cases:**
- each input of each derived metric removed alone (failure matrix);
- both sides zero;
- possession 100;
- xG missing while possession is known (unrelated gate);
- red cards never observed, or observed 0.

### 7.2 Penalties and own goals (15e, 15f)

> **Superseded by §17 (stage 8, 17 Nov 2026) where they disagree:** production's goal shots never carry
> FALSE, so the scoring is classified once per match on the server (`agg.match_scoring`), from the goal
> events' teams, and every match record carries it; the client no longer classifies shot lists.

**Penalty attempts of a match** are established only by observed classification on a **complete, reconciled shot set**. Amendment §1 applies: equal xG and non-penalty xG establish nothing.

A complete, reconciled shot set means:
- every shot's `teamId` is the match's home or away id (`match.home.id`, `match.away.id`), own goals included: a shot of another team, or of none, never counts as the club's;
- the club's non-own-goal shots in the list number exactly `own.shots`;
- the opponent's shots in the list number exactly `opp.shots`;
- every goal carries an explicit own-goal flag (`isOwnGoal` true or false); a non-goal attempt may omit it;
- the scoring events reproduce the score.

The club's attempts must also be **classified**: each of its non-own-goal attempts carries a recognized situation. Two spellings reach the client:
- the normalized codes of `api.match_shots`, kept by `match-record.mjs` in the embedded club records: `penalty`, and the non-penalty `regular_play`, `from_corner`, `set_piece`, `fast_break`, `free_kick`, `throw_in_set_piece`, `individual_play`;
- the provider spelling of the source-shaped endpoint (`match-families.mjs`): `Penalty`, and `RegularPlay`, `FromCorner`, `SetPiece`, `FastBreak`, `FreeKick`, `ThrowInSetPiece`, `IndividualPlay`.

The penalty count is then the club's attempts whose situation is `penalty` or `Penalty`. In every other case the count is unknown:
- no shot list;
- a count that does not match;
- a shot of another team or of none;
- a goal without its own-goal flag;
- a club attempt whose situation is missing or not recognized.

The opponent's situations are not read: they may be unknown. The club may be the home or the away side. A non-penalty denominator Σ(shots − penalty attempts) that is not positive is unavailable. The shot set is one of `xgPerShot`'s required inputs; an unclassified attempt makes `xgPerShot` unavailable for its match without hiding the own-goal-adjusted metrics, which need the scoring only.

*Corrected after the Astra/xhigh interim contract review and clarification of 17 Nov 2026, before the code: the embedded records' lowercase `penalty` was not recognized (11 attempts with one penalty gave npxG/11 for npxG/10), a team other than the opponent counted as the club's, and a missing flag on a goal was read as false.*

**Own goals of a match** are classified separately. Complete, classified scoring events can establish them without every non-scoring shot: it is enough that the list's goals and own goals reproduce the score, every goal carrying its own-goal flag and every shot one of the two teams.
- Own goals benefiting the club are shots with `isOwnGoal` true and `teamId` the opponent's.
- Own goals conceded are shots with `isOwnGoal` true and `teamId` the club's.
- A goal (`isGoal`) whose `isOwnGoal` is null or missing leaves the match's scoring unknown: an ordinary goal is never inferred from `isGoal` alone. The coverage of the own-goal-adjusted metrics may fall accordingly.
- This is the convention `club-game-states.js` already uses.

An empty shot list is **unresolved whatever the score**. A rule such as "no goal ⇒ no own goal" would select matches on their outcome and bias the residuals. *(Stage-7 correction, §16.6: rejecting an empty list avoids inventing a classification; it does not remove the selection bias of nullable goal flags. If ordinary goals lack the flag, only goalless matches classify.)*

**Formulas:**

| Metric | Formula | Support |
|---|---|---|
| `xgPerShot` | Σnpxg / Σ(shots − penalty attempts) | npxg, shots and penalty attempts all established |
| `finishing` | mean of (gf − opponent own goals) − xg | classified matches |
| `keeper` | mean of opp.xgot − (ga − own goals conceded) | classified matches |
| `conversion` | Σ(gf − opponent own goals) / Σshots | classified matches |

**Expected outcomes:**
- **`xgPerShot`:**
  - the complete row's full set (12 club shots, 9 opponent shots, no penalty) → 1.4 / 12;
  - a complete 10-shot set {npxg 1, xg 1} → 0.1;
  - a complete 11-shot set {npxg 1, xg 1.78} including one penalty → 0.1 (adding a penalty changes nothing);
  - `null` (the baseline gives 1/11 or 1/10) in each of these cases:
    - the 11-shot match without its set;
    - the 10-shot match without its set (equal totals);
    - a set that lacks one shot.
- **Own goals:** gf 2 including one opponent own goal, xg 1.0, shots 10 →
  - finishing 0.0 (baseline 1.0);
  - conversion 10 % (baseline 20 %).
- **Keeper:** ga 2 including one own goal by the club, opp xGOT 1.5 → 0.5 (baseline −0.5).
- **Trade-off:**
  - the league cohort read (`detail=summary`) carries no shots;
  - so the other clubs' `finishing`, `keeper` and `conversion` become `null` until the API publishes own-goal counts per side;
  - the finishing phase is then missing from the centiles;
  - recommendation (outside VI-23's files): add per-side own-goal counts to the summary read.

### 7.3 Paired points and xPts rank (9 clubs, N7)

**Contract** (additive cohort fields; `record.points` and `xptsTotal` keep their meaning):

| Field | Value |
|---|---|
| `pairedMatches` | matches whose xPts is known |
| `pairedActualPoints` | Σpoints on those matches, `null` when none |
| `pairedExpectedPoints` | ΣxPts on those matches, `null` when none |
| `pairedPointsDelta` | the difference, `null` when none |

**Other rules:**
- **Copying:** `rebase` copies the paired fields.
- **`xptsPosition`:**
  - ranks on totals only in a single-league cohort where **every** club has complete coverage;
  - otherwise it ranks per covered match;
  - clubs without xPts come after the others.
- **Paired xG** (N5, amendment §3). Two non-null seasonal means can stand on different matches, so their difference is not a per-match difference. The additive fields are all computed on the same intersection (matches where both the club's and the opponent's xG are known):

| Field | Value |
|---|---|
| `pairedXgMatches` | the number of intersection matches |
| `pairedXgFor` | Σ xG for |
| `pairedXgAgainst` | Σ xG against |
| `pairedXgDelta` | Σ(xG for − xG against) |
| `pairedXgDeltaPerMatch` | `pairedXgDelta / pairedXgMatches` |

  - Every field is `null` (and the count 0) without a common match.
  - The ordinary marginal means `values.xg` and `values.xga` keep their meaning: each is a mean over the matches that know it. *(Stage-5 correction, §14.7: their support did change: each now stands on its own side's xG, where the baseline's joint xG gate read both.)*
- **`opponentStrength`:** reads `pairedXgDeltaPerMatch`, never `values.xg − values.xga`.
  - It is `null` when the opponent has no paired difference.
  - The distribution keeps only the clubs that have one.

**Expected outcomes:**
- **Audit example** (two wins, one with xG 1/1):
  - record points 6;
  - paired matches 1;
  - paired points 3;
  - paired xPts 1.345745838723;
  - delta 1.654254161277.
- **Rank example:**
  - A is fully covered at 1.67 xPts per match;
  - B is covered 1 time out of 3, at xPts(3, 0.2) per match;
  - C has no coverage;
  - so the rank is B, A, C (the baseline ranks A, B, C on totals).
- **Paired xG example:** club E has three matches:
  - xG 1.5 / 0.5 (both known);
  - 2.5 / unknown;
  - unknown / 0.1.

  Expected:
  - marginal means `values.xg` 2.0 and `values.xga` 0.3 (the baseline's xG gate gives 1.5 / 0.5);
  - `pairedXgMatches` 1, `pairedXgFor` 1.5, `pairedXgAgainst` 0.5, `pairedXgDelta` 1.0, `pairedXgDeltaPerMatch` 1.0, and not 2.0 − 0.3.

  Club F, whose matches never know both xG: 0 and `null`s.
- **Opponent example:**
  - `opponentStrength` of a club with known marginal means but no paired difference → `null`;
  - a club at +0.5 per match among five paired clubs → centile 70 (the baseline reads the marginal means).
- **Handoff:** the VI-22 consumer lines are listed in §11 and stay unchanged.

### 7.4 xPts law (10)

**Contract (JS `outcomeChances` and the SQL law behind `api.match_xpts` and the calculator):**
- **Floor:** λ = max(0.01, xG); the floor is documented.
- **Rejected inputs:** negative, `NaN` and ±∞ are rejected before the floor (JS `null`, SQL `NULL`).
- **Bounded domain:** an xG above 100 for either side is outside the supported domain and gives `null` / `NULL` in both implementations, before any allocation or `exp`, without an error. 100 is a generous engineering guard, not a sporting cutoff: no real match comes near it. A total mass that is not finite and positive also gives `null`. Without the guard, SQL `exp(-750)` raises SQLSTATE 22003 (underflow) and JS returns `NaN` (Astra/xhigh interim review of 17 Nov 2026, P2). Large inputs are never clamped silently.
- **Support:** adaptive. The omitted tail mass per side is ≤ 1e-12.
- **Sums:** win, draw and loss are summed explicitly.
- **xPts:** 3·win + draw.
- **Precision:** JS and the reference agree within 1e-9. SQL agrees within 2e-6, because `agg.xpts_result` stores `real`.
- **Nature:** this is a numerical approximation, not an exact infinite sum.

**Reference values** (independent double-precision computation, log space, N = 200):

| Input | Expected |
|---|---|
| 6 v 6 | win = loss = 0.441786889393; xPts 1.441786889393 |
| 0 v 0 (floored law) | xPts 1.009851652188 |
| 1 v 1 | 1.345745838723 |
| 6 v 1 | 2.920479764700 |
| 8 v 1 | 2.980046839625 (monotonic) |
| 1.8 v 0.9 | 1.987180740701 |
| 2.2 v 1.0 | 2.132300503421 |

**Properties checked:**
- **Monotonicity:** for each b ∈ {0.5, 1, 2, 6} and a from 0 to 20 in steps of 0.25, xPts never decreases.
- **Swap:** win(a, b) = loss(b, a).
- **Domain edge:** 100 v 1 agrees with the reference; 100.5 v 1, 750 v 1, 1 v 750 and 1e300 v 1 give `null` / `NULL` without an error.

**Tests:**
- `tests/audit-club-metrics.test.mjs`
- `backend/tests/test_audit_club_aggregates.py::ExpectedPointsLawTest` (`test_5`: the bounded domain, interim review, RED before the correction)

### 7.5 The club's shot profile (stage 3; written before the correction)

`shotProfile` (`club-scout.js`) gives the owned `SituationTable`, `ShotPair` and `TeamShotMap`
(`ClubScoutUI.jsx`, VI-22) the shots, xG and goals by situation, for and against, and the map points.
Found in stage 2, scoped by the Astra/xhigh interim reviews (`context/astra-interim-shot-profile-review.md`,
`astra-interim-shot-missingness-boundary.md`).

| ID | Failure |
|---|---|
| FM-S1 | Only provider spellings are mapped: the embedded records' normalized codes (`penalty`, `from_corner`, `free_kick`…) fall into « open », a penalty included, with the tooltip « Jeu placé ». The provider's own `ThrowInSetPiece` also falls into « open ». |
| FM-S2 | An unknown or missing situation defaults to « open ». |
| FM-S3 | A shot of another team, or of none, counts against the club. |
| FM-S4 | A missing xG adds 0 to its bucket: the table shows a low total as if known. |
| FM-S5 | A known zero xG on the map becomes 0.01 (larger point, tooltip « 0,01 », a false share of the header total). |

**Contract:**
- **One canonical parser** for the 8 normalized codes and their provider aliases, mapped to the existing six buckets (keys and labels unchanged): `regular_play`, `individual_play` → open; `fast_break` → fastBreak; `from_corner` → corner; `set_piece`, `throw_in_set_piece` → setPiece; `free_kick` → freeKick; `penalty` → penalty. Any other value, or none, is **unclassified** (never « open »). `penaltiesOf` reads the same parser (its behaviour is unchanged).
- **Teams:** a shot is the club's or the opponent's by the match's actual sides (§7.2's check); a shot of another team or of none enters neither side's buckets nor maps. Home and away perspectives agree. A row whose sides cannot be established contributes nothing.
- **Buckets:** shots and goals are counted; `xg` is the sum of known xG and becomes `null`, for good, as soon as one included attempt has no finite xG (the owned table already renders `null` as « — »). A known 0 stays 0.
- **Unclassified shots** are counted apart, as data (`unclassified.for`, `unclassified.against`: shots, xG with the same rule, goals). They are in no bucket, so the six rows may sum to fewer shots than the map; showing that difference is VI-22's presentation, not resolved here.
- **Map points:** every attributed shot with coordinates keeps its point; an unclassified one is labelled « — » (the site's unavailable mark). A known xG of 0 stays 0 (the renderer's minimum radius keeps it visible). A **missing** xG keeps the legacy 0.01: the owned `ShotPair` header sums the points' xG and would read `null` as 0, so a missing map xG still fabricates a value. **Unresolved, VI-22 handoff:** `xg: number | null`, the point and its outcome kept with an unknown tooltip, a separate minimum radius, the header « — » when any included xG is unknown (`[0.2, null]` and `[null]` → « — »).
- Own goals stay out (unchanged).

**Cases:**
- the same shots spelled normalized and provider give identical counts, xG, goals and labels, for and against;
- a normalized penalty is in « penalty », tooltip « Penalty », never « open »; `throw_in_set_piece` and `ThrowInSetPiece` are in « setPiece »;
- an unknown code and a missing situation are unclassified: not in « open », counted in `unclassified`, the map point kept with « — »;
- another team's shot and a shot without a team: in neither side;
- the club away gives the same profile as at home;
- a bucket with xG 0.3 then a missing xG then 0.2 → `null`; a bucket of known zeros → 0; the map point of a 0 xG → 0; a missing map xG → 0.01 (legacy, documented);
- all-known control: unchanged values.

**Tests:** `tests/audit-club-metrics.test.mjs` (`shotProfile`, exported for the test as a pure function).

## 8. B7 — Regulation clock: owner handoff, not a local fix (audit 14, durations)

**Status:** unresolved in VI-23; an explicit integration handoff (amendment §2).

**Why it is a handoff:**
- The durations feed the owned VI-22 display: `ClubScoutUI.jsx:1015-1037` adds `states.minutes.lead + level + behind` and renders percentages.
- A `null` there silently becomes 0, and a smaller supported subset would hide its coverage.
- So the correction cannot be delivered safely through that consumer within VI-23's files.
- The server copy (`agg.team_game_states`, `calculator.refresh_game_states`) has no API view; changing it alone would leave the display wrong.

**What this means in VI-23:**
- No legacy duration field changes.
- No new aggregate is wired into the display.
- No B7 test is left failing in the runnable suites.
- The stage-1 change to `test_calculator.py` was undone, so the file is byte-identical to the baseline.

**Failure modes (for the owner):**

| ID | Failure |
|---|---|
| FM-B7.1 | `minute + added/100` is used as elapsed time, and the match is assumed to last ≥ 93 minutes. |
| FM-B7.2 | Extra-time goals extend the durations. |
| FM-B7.3 | JS turns a missing minute into 0. Python drops the match. |
| FM-B7.4 | Python orders `NULL` periods last, so a timeline that mixes null and known periods is misordered and dropped. |

**Proposed contract for the owner:**
- `regulationMinutes: {lead, level, behind} | null`, plus `durationMatches`, `outcomeMatches` and `excludedDurationMatches`.
- For the existing display, `regulationMinutes` is unavailable when the displayed population lacks complete duration support. Independently supported outcome fields (scored first, points from behind, points dropped) are preserved.
- Clock definition (descriptive, declared, not recovered elapsed time):
  - first-half events at min(minute, 45);
  - second-half events clamped to [45, 90];
  - stoppage time collapsed to its half's end;
  - no extra-time or shoot-out duration;
  - shoot-out kicks are not goals.
- Missing periods:
  - a missing period is read from the minute only where it is unambiguous: 45 or less is the first half, 46 to 90 the second;
  - **after 90 a missing period is ambiguous** (stoppage or extra time) and is never read as extra time (coordinator review, 17 Nov 2026). The match's duration contribution is rejected: it counts in `excludedDurationMatches`, and no regulation minute is invented. Its outcome facts supported by the ordered timeline (who scored first, the final result) are kept. No result at 90 is inferred.
- A goal without a minute removes the match from durations and from order-based outcomes.
- Historical seasons computed by the old definition are not comparable until recomputed.

**RED evidence and proposed tests (not in the runnable suites):** they are in `prototypes/calculation-audit/evidence/b7-handoff/`.
- `regulation_clock.json` holds 13 cases: regulation, 90+10, 45+3, extra time, a late stoppage winner, null periods, a mixed null period, a null period after 90, an own goal, a shoot-out, 0–0 and an unknown minute.
- `test_b7_regulation_clock.py` runs the calculator. `audit-regulation-clock.test.mjs` runs `gameStates`.
- Their baseline logs are there too, with `README.md`.

## 9. B8 — Embedding eligibility (audit 13d)

**Failure modes:**

| ID | Failure |
|---|---|
| FM-B8.1 | A profile with no usable statistic is mean-imputed and placed. Two such profiles are identical (distance 0, similarity 100). |
| FM-B8.2 | Partial profiles are placed with most of their features imputed; two placed players may share few real observations. |
| FM-B8.3 | The minimum number of players is checked before eligibility. |
| FM-B8.4 | A player who becomes ineligible keeps a vector after the next refresh. |
| FM-B8.5 | The worker never refreshes a season whose model predates the new definition. |
| FM-B8.6 | A non-finite value (`NaN`, ±∞) counts as measured. One all-`NaN` row among 220 valid ones is placed, its `NaN` spreads into the column means, and the geometry collapses: all 221 vectors identical, variance share 0 (coordinator's interim probe, 17 Nov 2026; synthetic, no production occurrence claimed). |

**Contract:**
- **Known means a finite number:** `NaN` and ±∞ are missing everywhere (column coverage, row eligibility, standardisation), like `None`. A row with no finite value is never placed and never imputed.
- **Starting set:** players with ≥ 450 minutes. Then repeat until stable:
  1. kept columns = measured for ≥ 60 % of the current rows, and varying;
  2. drop the rows with < 90 % of the kept columns known.
- The row set only shrinks, so the iteration is deterministic and terminates.
- **Fit and placement:** only eligible rows are fitted and placed. `embed()` keeps its 3-tuple, and `vectors[i] is None` for a row not placed.
- **Minima:** `MIN_PLAYERS` and `DIMENSIONS` are checked on the eligible set.
- **Guards:** a column whose moments (mean, spread) are not finite is not usable (like a constant one); if a vector component is not finite, no axes are published (`None`). A single bad input cannot publish a degenerate geometry, and a cohort that falls below the minima is never reported as placed.
- **Guarantee:** any two placed rows share ≥ 80 % of the kept columns as real observations.
- **Refresh:**
  - it writes only placed rows;
  - `players` = the placed count;
  - delete-then-insert removes stale vectors;
  - a new `MODEL_VERSION`.
- **Worker:** a season whose model has another version is due.
- **Not done:** no gender-specific PCA.

**Edge cases:**
- exactly 90 % (with 10 columns, 1 missing: placed);
- 80 % (2 missing: not placed);
- disjoint missing sets;
- an all-`None` row;
- the fixed point dropping a column;
- an eligible count below `MIN_PLAYERS`;
- a second refresh after a player loses his statistics;
- one row entirely `NaN`, +∞ or −∞ added to 220 valid rows: no placement for it, and the 220 vectors identical to those of the 220 alone;
- `NaN` and ∞ inside rows, counted as missing by the 90 % rule;
- a column whose spread overflows (a value of 1e308): not usable, the vectors finite;
- a refresh where one player's kept real statistic is `NaN`: placed on the others, every stored vector finite.

**Tests:**
- `backend/tests/test_audit_numeric.py::EmbeddingEligibilityTest` (tests 6–8: non-finite values, added after the coordinator's interim review, RED before the correction)
- `backend/tests/test_audit_models.py::EmbeddingRefreshTest`
- `backend/tests/test_audit_models.py::EmbeddingNonFiniteRefreshTest` (interim review, RED before the correction)
- adjusted expectations in `backend/tests/test_models.py` and `backend/tests/test_worker.py` (§12).

## 10. B9 — Constrained xG model (audit 16a)

**Failure modes:**

| ID | Failure |
|---|---|
| FM-B9.1 | Unconstrained Newton allows `distance_sq > 0` and `angle_distance ≠ 0`. The documented coefficients rise again: 0.968 % at 50 m, 19.365 % at 100 m. |
| FM-B9.2 | The SQL sigmoid is unbounded while the Python one is clamped at ±30. The values diverge at extreme logits, and SQL `exp` overflows. |
| FM-B9.3 | A stored unconstrained model keeps scoring after the code changes (the version is not bumped). |

**Contract:**
- **Typed schema and categorical offsets:** unchanged.
- **New version, with constraints:** `distance ≤ 0`, `distance_sq ≤ 0`, `header_distance ≤ 0`, `angle ≥ 0`, `angle_distance = 0`.
- **Optimizer:** a feasible (projected Newton or gradient) step with backtracking.
  - It is deterministic.
  - `fit(bins, diagnostics=True)` returns `(coefficients, info)` with `converged`, `iterations`, `objective` and `max_violation`.
  - `fit(bins)` keeps returning the coefficients or `None`.
- **Equality:** the result equals the unconstrained optimum only when that optimum is feasible.
- **Scoring:** Python and SQL use the same features and the same sigmoid bounded at ±30.
- **Refresh:** it refits when no model of the current version exists and rescores every season.
- **Verification:** a dense ray grid is a check, not the definition of the constraints.
- **Evaluation:** see §10.1.
- **Not claimed:** any predictive improvement.
- **Storage precision:** `agg.shot_xg.xg` is a `real` (080). `XgVersionTest.test_2` compares SQL with Python to one float4 step (2⁻²³ relative); its stage-1 tolerance of 1e-9 could not be met by a stored real (corrected in stage 2; the baseline's unbounded SQL gives 2.9e-20 for 9.4e-14 at −45 and overflows at −800).

**Edge cases:**
- data drawn from an infeasible model, long range included;
- a feasible truth (recovered exactly);
- an unseen situation (weight 0);
- extreme intercepts (±45, −800);
- penalties (separate rate, unchanged).

**Tests:**
- `backend/tests/test_audit_numeric.py::ConstrainedXgTest`
- `backend/tests/test_audit_models.py::XgVersionTest`
- adjusted fixtures in `backend/tests/test_xg.py` (§12).

### 10.1 Evaluation on a dated, versioned, immutable input (amendment §4)

**Tool:** `backend/tools/evaluate_xg.py`. `--synthetic` only generates an input; it is not the only mode.

| Command | Effect |
|---|---|
| `--synthetic --seed N --write-input FILE` | Writes a synthetic input in the schema. |
| `--input FILE --cutoff YYYY-MM-DD --output FILE` | Evaluates the unconstrained and the constrained fits. |

**Input schema `vega-xg-evaluation-input/1`:**
- `schema`;
- `provenance`:
  - `kind`: `synthetic` or `snapshot`;
  - `description`, `generated_by` and `seed`;
  - `snapshot_sha256`, `null` for a synthetic input;
  - `observation_times`: false when the input carries no availability timestamps.
- `shots`, each `{match, shot, date, x, y, body, situation, outcome, own_goal}`.

**Rejected** (exit code 2, no report written, the message naming the reason):

| Reason in the message | Input |
|---|---|
| `schema` | another schema |
| `date` | a malformed date |
| `duplicate` | a duplicate `(match, shot)` |
| `conflict` | one match with two dates |
| `coordinate` | x outside [0, 105] or y outside [0, 68] |
| `body` | an unknown body part (also an unknown situation or outcome) |
| `partition` | a cutoff that leaves the training or the test partition empty |

**Split:**
- strictly disjoint by date: train is date < cutoff, test is date ≥ cutoff;
- a match lies in one partition only, since it has one date;
- the order is deterministic: (date, match, shot).

**Report:**
- `input`: the file's `sha256`, `schema`, `provenance` and shot count;
- `split`: `cutoff`, then for train and for test the shots, matches, first date and last date;
- `excluded`: counts by reason (own goals, penalties, which have their own rate). Train + test + excluded = every input shot.
- `models.unconstrained` and `models.constrained`, each with:
  - its coefficients, log loss and Brier score;
  - calibration by distance band and by situation;
  - its constraint violations (`[]` for the constrained fit).
- `evaluation`: « event-time retrospective evaluation » when there are no observation-availability times; such an input is never presented as an as-known replay.
- `real_data`: « unavailable » for a synthetic input;
- `sha256`: the report's own hash.

The same input gives byte-identical reports. Real predictive performance stays unavailable until an actual snapshot is provided.

**Tests (NC; the tool does not exist on the baseline):** `backend/tests/test_audit_xg_evaluation.py`.

### 10.2 A failed fit is never published (stage 3; written before the correction)

Found by the Astra/xhigh interim review (`context/astra-interim-xg-publication-review.md`), with a
read-only real-fitter probe: two bins, `iterations=0` → coefficients returned with `converged: False`.
This shows the path exists, not that the default 200 iterations fail on real data.

| ID | Failure |
|---|---|
| FM-B9.4 | `fit` returns its last iterate even when it did not converge, and `refresh`, which calls it without diagnostics, inserts it as the current model and rescores every season with it. |
| FM-B9.5 | Non-finite coefficients or objective, or violated constraints, would be published the same way. |
| FM-B9.6 | The evaluator reports a comparison as successful when a fit did not converge. |

**Contract:**
- `refresh` reads `fit(bins, diagnostics=True)` and publishes only a model that converged, with finite coefficients and objective, and constraints satisfied (`max_violation` ≤ 1e-12). Anything else raises `xg.FitFailed` (naming how the fit ended) **before** the publication transaction opens. Every model and every score stays byte-for-byte unchanged; with no previous model, nothing is written. No score is ever written with another version's coefficients, and no old model is relabelled.
- A successful fit keeps one transaction: insert, every season rescored, unused models deleted.
- Too few shots is not a failure: `refresh` returns 0 and writes nothing (unchanged).
- **Operational consequence (no orchestration change here; superseded by §10.3, stage 4):** `models.refresh_daily` runs `xg.refresh` in the middle of a season's daily pass. A `FitFailed` fails that season's step: the worker logs its code and retries after `RETRY_DAILY_AFTER` (1 h), and the models after xG in that pass (embedding, breakout, actions, returns, the editions' recount) wait. The model is global, so every due season fails at the same step while the fit fails. Running the xG step last, or isolating it, would limit this; that is a separate, test-first change of the daily orchestration.
- **Evaluator:** each model's `fit` keeps `converged`, `iterations`, `objective`, `max_violation`. The report gains `complete`, `status` and `failed_fits`: `complete: true`, `status: "ok"`, `failed_fits: []` when both fits converged with finite, feasible results; otherwise `complete: false`, `failed_fits` the models concerned, and `status: "nonconverged"` (a fit stopped before its optimum) or `"invalid"` (a converged fit not finite, or the constrained one not feasible). Their metrics stay as **terminal-iterate diagnostics** where finite (a non-finite one is `null`), never presented as optima, and `claims` says the comparison is incomplete. The tool then writes the report and exits **3** (2 stays « input rejected, no report »). `--iterations N` sets the fits' cap (vega/xg.py's 200 without it), so the path can be exercised.

**Tests:** `backend/tests/test_audit_models.py::XgFailedFitTest` (a published model and scores in two
seasons, a growth refit through a wrapper of the real fitter with `iterations=0`: an explicit failure,
both snapshots unchanged; no previous model: nothing written);
`backend/tests/test_audit_xg_evaluation.py::XgEvaluationInputTest.test_6` (`--iterations 0`: exit 3,
report written, `complete: false`, `status: "nonconverged"`, both fits named).

### 10.3 A rejected fit does not stop the season's other daily models (stage 4; written before the correction)

Stage 3's correction (§10.2) introduced this, as its result warned. The Astra/xhigh interim review
confirmed it against the actual dependencies and worker semantics
(`context/astra-interim-xg-daily-review.md`): no later model reads `agg.shot_xg` or `agg.xg_models`.

| ID | Failure |
|---|---|
| FM-B9.7 | `xg.refresh` raises `FitFailed` in the middle of `models.refresh_daily`. The season's later models (embedding, breakout, actions, returns) and the editions' recount (match zeros, player list) do not run. The model is global, so every due season's pass fails at the same step while the fit fails. |

**Contract:**
- **Call order unchanged.** `refresh_daily` catches `xg.FitFailed` **only**, around `xg.refresh`, and prints at once `daily models season=<season> xg=rejected error=FitFailed`. That line holds the season and the class, never the exception's text.
- It runs the rest of the pass, recounts included, then re-raises the saved `FitFailed` at the end. Deferring is safe only because `FitFailed` guarantees that nothing was written.
- **Worker:** it logs the season's step as failed with its usual code and backoff (`daily step=season <season> error=WORKER_FITFAILED@xg.py:<line> retry_at=…`), and prints no `outcome=ok` for that season.
- **A later failure** propagates as before: it is the error the worker logs; the rejection line was already printed. No `finally` re-raises the `FitFailed` over it.
- **Any other xG error** (a bug, a database error) still stops the pass at once: the later models do not run, and its own code is logged.
- **Success:** a fit that succeeds, or too few shots (`xg.refresh` returns 0), keeps the normal success (`outcome=ok`).
- No scheduler change; the owners' algorithms are untouched.

**Tests:** `backend/tests/test_audit_models.py::DailyPassXgRejectionTest`.
- **Setup:** the real `Worker.daily()` and `models.refresh_daily` on two due seasons of the dedicated local models DB.
- **Seams:** recording no-ops replace only the owners' expensive algorithms: VI-21's power and Elo (`refresh_players`, `refresh_power`, `refresh_elo`, `previous_year_changed`, `stale_rankings`) and VI-19's forecast, in-play and line-ups. Spies record the downstream models, whose real functions run.
- **Forced failure:** the xG fit fails through the `iterations=0` wrapper of the real fitter.

Cases:
1. A rejected fit, two seasons:
   - every later model and the recount run for each season;
   - the published model and its scores stay unchanged (a model fitted first, then a growth refit that fails);
   - two rejection lines, two step failures with `WORKER_FITFAILED` and a retry time;
   - no `outcome=ok`, no exception text.
2. A rejected fit, then a bug in `actions.refresh`: the worker logs that error (`WORKER_ZERODIVISIONERROR`), not `FitFailed`. The rejection line was printed, and the steps after `actions` (returns, the recount) did not run.
3. A fit that succeeds: `outcome=ok` for both seasons, no rejection line, no retry, one model published.
4. Too few shots: `outcome=ok`, nothing published.
5. An unexpected xG error stops the season at once, with no later model and no rejection line:
   - a bug in the fit (`WORKER_VALUEERROR`);
   - a database error in the bins' query (`DATABASE_42601`).

## 11. B10 — Server club indicators (new N1)

**Failure modes:**

| ID | Failure |
|---|---|
| FM-B10.1 | `covered_matches` of every club indicator is the club's total match count (`models._team_values_sql`). An axis known on 3 of 8 matches passes VI-22's ≥ 5-match gate. |
| FM-B10.2 | Ratios mix supports: field tilt, box share, duels, aerials, PPDA, adjusted defensive actions, directness, box shots, set share. |
| FM-B10.3 | `xg_per_shot` divides non-penalty xG by all shots. |
| FM-B10.4 | Own goals sit in finishing, conversion and keeper. |

**Contract:**
- **New paired columns:**
  - a new migration adds them to `agg.team_season_stats`;
  - the calculator populates them per match, from inputs known on both sides;
  - penalty attempts come only from a complete, reconciled shot set in `core.shots`:
    - shots coverage `ok`, outside the shoot-out;
    - the team's non-own-goal shots number exactly its `total_shots`;
    - its goals reproduce the score.

    xg = npxg establishes nothing (amendment §1). A match without such a set is outside `xg_per_shot`'s support. In SQL, as in §7.2: every shot is one of the two teams'; each side's non-own-goal shots number its `total_shots`; the club's are each classified (`situation` not null); every shot with `outcome = 'goal'` carries an explicit `is_own_goal` (true or false; a non-goal attempt may have none, as the real fixture's 25 do); the goals reproduce both scores;
  - own goals come from goal events flagged `is_own_goal`, attributed by the score progression, when events coverage is `ok` and the timeline reproduces the score. Every goal event must carry an explicit `is_own_goal`: a goal whose flag is NULL leaves the match unclassified, out of the own-goal-adjusted finishing, conversion and keeper support, while its other statistics stay. A NULL flag on a non-goal event changes nothing (Astra/xhigh interim own-goal review, 17 Nov 2026: `normalize.py` keeps an absent flag as NULL, and an ordinary shot `Goal` does not establish false).
- **Indicator definitions:** a versioned module, read by `models._team_values_sql` with the true per-indicator covered count.
- **`api.team_season`:**
  - replaced by a new migration;
  - its existing columns keep their names, order and types, and new columns are appended;
  - `api_schema.py`, 009 and 012 are untouched, and the generated-file tests stay green.
- **Fallback:** if compatibility fails, the precise handoff is recorded instead. The generated tests are never bypassed.

**Expected outcomes:**

| Test | Synthetic data | Expected | Baseline |
|---|---|---|---|
| Coverage | team 1, possession known on 3 of 8 matches | `covered_matches` 3 | 8 |
| Field tilt | team 2, the opponent's opposition-half passes missing in 2 matches | paired ratio over the other 6 | mixed sums |
| Penalties | team 3: complete shot sets in 3–1 (11 shots, one a penalty) and 3–4; the six others have no set, xg = npxg included | Σnpxg / Σ(shots − penalties) on those 2 matches; `covered_matches` 2 | all 8 matches, all shots |
| Own goals | team 4 scores 2 including an opponent own goal, xG 1.0 | finishing 0 for that match | — |

- **Agreement:** every indicator of `api.team_season` equals the cohort value in `agg.team_percentiles`, for every club.
- **Column guard:** the first N columns of `api.team_season` equal the baseline snapshot `backend/tests/fixtures/api_team_season_columns.json`.

**VI-22 consumer lines (handoff, unchanged here):**
- `ClubScoutTabs.jsx:86, 291-298`: `record.points − xptsTotal`;
- `ClubScoutUI.jsx:1430-1434`: `(values.xg ?? 0) × rows`;
- `ClubScoutUI.jsx:1463, 1528, 1577-1578`.

The replacement expressions are `pairedPointsDelta` and `pairedXgDelta` / `pairedXgDeltaPerMatch`
(§7.3), never `values.xg − values.xga`. The game-state durations' consumer
(`ClubScoutUI.jsx:1015-1037`) belongs to the B7 handoff (§8).

**Tests:**
- `backend/tests/test_audit_club_aggregates.py::ServerIndicatorSupportTest`;
- `backend/tests/test_audit_club_aggregates.py::OwnGoalFlagSupportTest` (Astra/xhigh interim own-goal review: a goal event or a goal shot without its flag; RED before the correction).

`test_2`'s tolerance was corrected in stage 2 from 9 decimal places to a real's precision (rel. 1e-6, as `test_5`): `agg.team_percentiles.value` is a `real` (009), so no implementation can store 49.760765550239235; the baseline's 56.61 still fails it.

## 12. Existing expectations adjusted in stage 1 (they encode a defect)

| File and test | Before | After | Defect encoded |
|---|---|---|---|
| `backend/tests/test_calculator.py::CalculatorTest::test_2_full_refresh` | Alpha game states `(…, 38, 55)` | **reverted to `(…, 38, 55)`**: B7 is a handoff (amendment §2), and the file is byte-identical to the baseline | — |
| `backend/tests/test_models.py::…placed_on_the_axes…` | every player ≥ 450 minutes placed | only the 239 synthetic players placed; the league's own 88 players, who measure 12 of 14 kept statistics, are not | placement with mean-imputed features (B8) |
| `backend/tests/test_worker.py::…recomputes_the_season_in_progress` | the embedding model row inserted as the literal `profile-embedding-v1` | inserted with `embedding.MODEL_VERSION`; an older-version row makes the season due | version-blind due rule (B8) |
| `backend/tests/test_xg.py` | `TRUE` has `distance_sq = +0.15` and `angle_distance = 1.4` | `TRUE` is feasible (`distance_sq = −0.02`, `angle_distance = 0`) | the recovered model sits outside the constrained parameter space (B9) |
| `tests/match-tabs.test.mjs::players board` | threat leader `p_c` (xG unknown) | `p_a` | unknown xG read as 0 (B5) |
| `backend/api/test/players.test.mjs::a player's season by half` | unknown tackles and recoveries read as 0 | 404: neither half of the seed is complete | `coalesce(…, 0)` (B3) |
| `backend/api/test/players.test.mjs::player directory` | `profile.stats` keys | the keys plus `finishing` | missing paired support (B2) |

## 13. Not covered by tests in this stage

- **Out of scope:** production incidence, real coefficients, real temporal xG performance and real return-curve changes. They need an immutable snapshot, which is not available.
- **Display consumers:**
  - the VI-22 UI subtractions (§11);
  - the game-state durations (B7 handoff, §8);
  - `PlayerScoutOverview`, verified end to end by the coordinator (§6.4).
- **Owned elsewhere:** in-play, forecasts, rounds, line-ups, power, nations and sources (§1).

## 14. Stage 5 — reconciled corrections of the first final reviews (written before the tests)

Sources: the Astra/xhigh fresh review of candidate v1 (`review-evidence/astra-review-v1.md`,
F1–F3); the fresh Opus/max review (`review-evidence/opus-review-v1-failed-access.md`, useful analysis,
not an accepted signoff); Astra's reconciliation into seven groups (stage-5 brief). The coordinator's
real-browser RED before any correction: `review-evidence/browser-stage5-red4/` (4 views, all 6
assertions failing, stable source).

### 14.1 [P1] The selected club's shot-backed indicators (club-scout.js)

| ID | Failure |
|---|---|
| FM-S5.1 | The league cohort is read with `detail=summary`, whose match records carry `shots: []`. `buildDossier` takes `self` from that cached cohort, so the selected club's own `finishing`, `keeper`, `conversion` and `xgPerShot` are null although its own full read holds the shot lists. |
| FM-S5.2 | `rebase` (Europe or another reference) takes the reference pool's own member when present, which also has these four values null, and drops any enriched self. |
| FM-S5.3 | An enrichment written on the cached object would leak into later dossiers, the Europe pool or another reference. |
| FM-S5.4 | Once only the selected club is measured, `rankCohort` gives it rank 1 of 1 for these four metrics. |

**Contract:**
- **Values:** the selected club's four values and their coverage come from its own full records, on copies. Every other value (ordinary records, paired fields, other metrics, reference metadata) stays as it is. Peers stay as read: no classification is inferred for them, and no shot list is fetched for them.
- **Matches:** where the club is a member of the reference (its league in the base dossier, a Europe pool, or another competition), the four values are read on the full rows of the matches the member's own rows name (the match ids intersected with the dossier's `allRows`). A summary row without a full counterpart stays unsupported. A domestic measurement is never put into another competition's reference.
- **Inserted club:** where the club is absent from the reference and inserted, it keeps the documented domestic-league values of the base dossier.
- **Isolation:** no cached cohort, member, `values` or `coverage` object, Europe pool or previous dossier is mutated; two dossiers and repeated rebases leave the cached inputs deep-equal to their snapshots.
- **Ranking:** a centile still needs 5 values. For these four metrics, a rank needs 5 measured clubs too: below that it is unavailable (null), never rank 1 of 1. Every other metric's ranking is unchanged.
- **Reference statistics (edge case found while writing the tests):** below 5 measured clubs, the reference's median, quantiles and extremes of these four are unavailable too. With the selected club alone measured, `MetricTable`'s « Médiane » would otherwise show its own value as the league's.
- **Out of scope (VI-22):** the owned finishing and keeper season totals still multiply the mean by all matches and read null as 0. Those displays are not claimed fixed; the browser fixture checks only the direct conversion card (100,0 %).

**Cases:**
- a production-shaped summary cohort (`shots: []`) and the club's full read: all four values and supports, one supported match of three;
- paths: league (the base dossier), Europe with the club present, a foreign reference with the club inserted, another competition with the club present;
- deep snapshots of the cached inputs across two dossiers and repeated rebases;
- the 4-versus-5 measured-club rank boundary;
- controls: a complete shot set, an incomplete one, an unknown classification.

### 14.2 [P2] Finished player summaries and the cohort's role

| ID | Failure |
|---|---|
| FM-S5.5 | `models._player_values_sql` picks a player's position group (`grp`) from the minutes of every match, unfinished ones included, while the statistics read finished matches only: 10 finished attacking matches and 12 canceled defensive ones put him in group D instead of O. |
| FM-S5.6 | The player page and its history summaries aggregate every appearance whatever the match's status: a canceled match counts in the KPIs, the contribution rate and the « Production » sentence, while the directory no longer counts it. |

**Contract:**
- **Server:** `grp` reads finished matches only, as the statistics do. Membership and percentiles follow, and a cancellation after a publication moves the player at the next refresh.
- **Client selector:** one reusable `finishedAppearances(data, rows)` in `season-player.js` keeps the appearances of finished matches. It resolves the status by match id from the read's collected match records and its fixtures: an appearance record carries no status, and a finished fixture may have appearances without a match record. A match of unknown status, or any other status (`in_play`, `canceled`, `postponed`, `not_started`, `suspended`, `awarded`, or a live alias such as `half_time`), is left out.
- **Where it applies:** before the generic `aggregateSeason` / `aggregateSeasonPlayers` at the season-summary boundaries only:
  - the player page's subject and local cohort (`PlayersPage.jsx`);
  - `currentPlayerSeason`, `loadPlayerSeason` and every history rebuild (`loadPlayerHistory`'s supplement path, competition narrowing);
  - the date narrowing (`playerHistoryInPeriod`).
- **Untouched:** the generic aggregators, the raw actor responses and the cached data are not changed. A finished match of unknown minutes keeps its bookkeeping (`unknownMatches`).
- **Logs:** the explicit match and the match logs keep every observation. `playerSeasonGroups` and `playerCareerGroups` take `{ log: true }` to group the raw observations, as `PlayerMatchesPage` lists them.
- **Snapshot:** the UEFA snapshot's matches are played matches; they say so (`status: "finished"`).

**Cases:**
- finished, `in_play`, canceled, postponed and not-started appearances, a live alias;
- a finished fixture without a match record; an unknown status;
- the raw actor data, cached data and logs keeping every row;
- current, cached-history, fresh-history, competition and date narrowing giving the same finished totals;
- cohort role membership.

The coordinator's browser case: 170 minutes, 2 matches, 3 contributions, « 57′ » (it showed 260 and « 87′ »).

**Existing fixtures adjusted** (they had match records without the status the API always sends):
- `tests/navigation-performance.test.mjs`;
- `tests/player-season-history.test.mjs` « date windows »;
- `tests/player-season-selected.test.mjs` « a cached complete season » (found while writing the tests: `selectPlayerCompetition` rebuilds its profile).

They gain `status: "finished"`, and their assertions are unchanged.

**Seams (found while writing the tests):**
- `playerSeasonLog(entry, playerId)` (`player-season-history.js`) gives the season's raw played observations. `PlayerMatchesPage` lists it when no group is selected; it listed `entry.profile.rows`, which becomes a finished-only summary.
- `PlayersPage.jsx` has no unit harness. Its two summary calls go through `finishedAppearances` and are checked by the coordinator's browser case, not by a unit test.
- The match logs' group compatibility (`{ log: true }`, raw observations) is pinned by a characterization test that already passes on the current source and must stay green.

### 14.3 [P2] Shot placement's support

| ID | Failure |
|---|---|
| FM-S5.7 | `placement_sum` and `placement_matches` (calculator) require the opponent's xG, which placement (own xGOT − own xG) does not read: own xG 1, own xGOT 1.5 and no opponent xG give NULL / 0 instead of 0.5 / 1, in the aggregate, `api.team_season` and the cohort's coverage. |

**Contract:** placement reads its own two inputs only. No schema change, no generator or old migration touched; the all-scope recompute applies.

**Cases:**
- the case above, through the aggregate, the API and the cohort coverage;
- mixed supports;
- controls without own xG or without own xGOT.

### 14.4 [P2] Shoot-out shots (club-scout.js)

| ID | Failure |
|---|---|
| FM-S5.8 | `scoringOf`, `penaltiesOf` and `shotProfile` read the shoot-out's shots (`period: "penalties"` in the embedded records, `"Penalties"` in the source shape). A shoot-out goal breaks the score's reconciliation, so the four classified metrics of a complete 1–1 become null, and the shoot-out enters the situation buckets and the maps. The server already leaves them out. |

**Contract:**
- One shared predicate leaves out a shot of the shoot-out (`penalties`, `Penalties`) in the three loops.
- A genuine in-match penalty stays: the non-penalty denominator removes only it.
- No clock, provider own-goal flag or owned-UI change.

**Cases:**
- shoot-out goals and misses appended to an ordinary complete 1–1: the four metrics and their supports are unchanged, and the buckets and maps leave them out;
- an in-match penalty kept.

### 14.5 [P2] Non-finite half xG (129)

| ID | Failure |
|---|---|
| FM-S5.9 | The half's completeness tests `xg IS NOT NULL`: a NaN, +∞ or −∞ half xG passes, and one such half turns its player's half xG into NaN (the route then answers null). |

**Contract:**
- A half is complete only with a finite xG. A non-finite half is left out of every total, count and minute, and counted in the exclusions.
- The structural zero stays: a NULL xG with no shot is 0. A finite xG on a half without a shot stays as published.
- A non-finite xG with no shot is invalid, not a structural zero.
- Columns, order and types unchanged; no new negative policy, no match-level zero flag.

**Cases:**
- each non-finite value next to a valid half: only the valid one contributes;
- all halves invalid: no aggregate row;
- the structural zero, the finite zero-shot xG, and a non-finite zero-shot xG.

### 14.6 [P3] One xPts law per row (130)

| ID | Failure |
|---|---|
| FM-S5.10 | `api.match_xpts` expands `(SELECT (agg.xpts_v2(...)).*)`, which calls the plpgsql law once per output column: 4 calls per row. |

**Contract:**
- One call per row: `CROSS JOIN LATERAL agg.xpts_v2(o.xg, p.xg) x`, a single function scan.
- The four outputs, the rows of an impossible input (all NULL), the view's columns, order and types are unchanged.
- The EXPLAIN VERBOSE plan is recorded before and after. No speed is claimed.

**Test:** the function's calls counted in the transaction (`track_functions = 'pl'`,
`pg_stat_get_xact_function_calls`): one per row (four before), with the numeric and null-row workflow.

### 14.7 Documentation and owner handoff (no code)

- **Clinical and wasteful lists:** their eligibility and gap are paired; their « Buts » and « xG » columns keep their own supports. A player shows 10 goals and 2 xG with a paired gap of 2 when only 4 goals and 2 xG are paired. The home comment is reworded: a complete xG does not prove complete goals, and the home's zero convention predates the branch.
- **Club xG means:** the marginal means now each stand on their own side's support (formerly the joint xG gate); this is not « unchanged ».
- **Summary cohorts:** they lack the four shot metrics. The corrected full self is distinct from the unsupported peers. A future summary read must supply each side's own-goal and penalty-attempt classification with its coverage.
- **Server index:** `models._team_index` still ranks xPts on totals under partial coverage. No route reads that stored position; N7 is done for the client only. This is a recorded producer limitation, not a server fix.
- **The VI-22 consumer map,** by the current owner expressions (owner snapshot in `review-evidence/owner-source/`):

  | Owner expression | Replacement |
  |---|---|
  | `record.points − xptsTotal` | `pairedPointsDelta` with paired actual / expected / matches |
  | `ExpectedGapTable` per match | paired actual / expected / delta ÷ `pairedMatches`, not all matches; unknown → NULL |
  | LeagueTable `(values.xg − values.xga) × rows.length` | `pairedXgDelta` |
  | « Diff. xG / match » | `pairedXgDeltaPerMatch`, no unknown-as-zero or arrow |
  | finishing / keeper / placement season totals | mean × that metric's coverage, with finite / null guards |
  | missing finishing, keeper or conversion | unavailable, no zero or positive arrow |
  | « Buts · xG » and « Encaissés · xG contre » residuals | actual goals and xG on one explicit matched support |

  The existing paired xG fields do not supply paired actual goals: replacing only the xG while keeping `record.gf` stays wrong.
- **Pages:** repair the displaced xGOT/placement rows, the stale « moyenne simple », the xPts position row, the numbering and the validation table's formatting.


## 15. Stage 6 — the finished summary reaches the rendered player profile (written before the correction)

Source: the coordinator's real-browser runs. `review-evidence/browser-stage5-green/` is a **failed**
validation: the club conversion card shows 100,0 %, but the canceled-match player still shows
260 minutes and « 87′ » instead of 170 and « 57′ », while the API's records and fixtures both say
`canceled`. `browser-stage6-red/` used too broad a raw expectation for « Par compétition »: a
contract error, kept and superseded. `browser-stage6-red2/` is the valid RED, run before this
correction. Root cause, found by root and Astra: `PlayersPage` uses its finished `subject` (§14.2)
only for the radar's eligibility; `PlayerSeasonProfile` receives the raw rows and re-aggregates them.

| ID | Failure |
|---|---|
| FM-S6.1 | `PlayerSeasonProfile` builds its one `profile` from the raw `rows`, so every part of the rendered page counts the canceled match: the overview's figures, rail and strip, cohorts, comparisons, shots, competition summaries and season analysis. The service tests of stage 5 do not cover this wiring. |
| FM-S6.2 | `PlayerGames` reads one profile for both its « Par compétition » summary and its « Matchs de la période » log. A finished profile would drop the log's unfinished observations; the raw one counts them in the summary. |
| FM-S6.3 | With no finished appearance, a guard on the finished profile would send a known player with raw observations to the history layout, without tabs or match log. The summary's default name « Joueur » would reach the bookmark and the comparison, and the club would stay unresolved. |

**Contract (Astra's bounded wiring):**
- **`PlayersPage`** passes its finished `subject` as an optional `summaryProfile`, and `summaryRows` as `scopeRows` (the fallback peers). `rows` stays the raw `playerRows`. The legacy `playerView=matches` branch is unchanged: it lists the raw observations.
- **`PlayerSeasonProfile`** keeps `logProfile = aggregateSeason(rows, id)` and reads `profile = summaryProfile ?? logProfile`, so its other callers are unchanged. `profile` serves the season statistics, cohorts, comparisons, shots, competition summaries and season analysis; the role and ranking eligibility; and the rail and strip figures (matches, minutes, goals, grade). The raw `rows` stay the input of `PlayerPresenceCard` and of the playing time (`playerPlayingTime` selects finished fixtures itself; stripping its raw observations could lose presence or coverage). `PlayerPhysical` reads the finished profile's rows, since its match load includes season totals.
- **`PlayerGames`** takes an optional `logRows`, defaulting to `profile.rows`; the profile passes `logProfile.rows`. « Par compétition » aggregates the finished `profile.rows`. The « Matchs de la période » table and the per-match grade plot read `logRows`. No layout change.
- **No finished appearance:**
  - the navigation guard reads `logProfile.matches`: a player with raw observations keeps the tabs and the log, with a finished summary of 0 matches, 0 minutes and no rate (« — »);
  - name and photo come from the existing `resolvePlayerIdentity` fallback to the raw appearances;
  - the club is resolved from the finished rows first, else from the raw rows;
  - the bookmark and the comparison read the resolved identity, never « Joueur ».
  The statistical profile is never replaced by the raw aggregate.
- **Untouched:** `aggregateSeason`, the raw actors and caches, the backend, owner code. No other status is classified.

**Cases:**
- **Focused render regression (`tests/audit-profile-wiring.test.mjs`)**, written and run before the correction. It renders the real `PlayersPage` and `PlayerSeasonProfile` with every other module stubbed, and the real `PlayerGames`.
  - **Mixed:** m1 and m2 finished, m3 canceled; raw minutes 90, 90 and 80.
    - Overview, rail and strip: 2 matches and 170 minutes.
    - « Par compétition »: 2 / 170 / « 57′ », and the log keeps 3 rows.
    - Physical: 2 rows. Presence and playing time: the raw 3 rows.
  - **Only unfinished:** m1 `in_play`, m3 `canceled`, m5 `not_started`.
    - The full tabs, with a summary of 0 / 0 / « — ».
    - Identity « Élie Durand », the club from the raw rows, the bookmark and the comparison named.
    - No « Par compétition » row; the log keeps 3 rows.
  - **`PlayersPage`:** `summaryProfile` is the finished subject, `rows` raw, `scopeRows` the summary rows. The legacy matches view lists the raw rows.
- **Real browser (coordinator):** the stage-6 contract on desktop 1440×1000 and mobile 390×844, and the prior 70-assertion matrix.

**Correction of the stage-5 report (no code):** the server's `keeper_pm` reads
`pair_keeper_sum / pair_keeper_n`, on the opponent's xGOT and a known own-goal classification. The
both-xG gate belongs to the legacy exposed fields `keeper_xgot_against`, `keeper_goals_against` and
`keeper_matches`. No keeper change follows from the stage-5 sentence, which stays in its evidence as
history.

## 16. Stage 7 — bounded corrections after the final review v2 (written before the tests)

Sources: the independent v2 reports (`context/astra-review-v2.md`: no actionable defect;
`context/opus-review-v2.md`: changes requested) and Astra's reconciliation
(`context/astra-reconciled-review-v2.md`), which is this stage's scope; root's read-only probes
(`review-evidence/review-v2-probes*`); the coordinator's pre-fix browser RED for the tooltips
(`review-evidence/browser-stage7-red/`: 8 expected failures, 4 passing zero controls).

### 16.1 Unfinished observations in the two non-compact player paths

| ID | Failure |
|---|---|
| FM-S7.1 | `PlayerDialog` (`PlayerDetails.jsx:84`) ranks an opened performance against every appearance of `f.performanceData`. Canceled or unfinished matches count toward the 30-peer minimum, and their extremes shift the percentiles. |
| FM-S7.2 | `comparisonSamples` (`PlayerComparison.jsx:137-149`) aggregates the raw season appearances in its non-compact fallback, for both the reused page data and a loaded season: a canceled match counts in the compared season. |

**Contract:**
- **Performance peers:** the card's peer population is `finishedReadAppearances(f.performanceData)`, the finished appearances of the read. It is computed once per read object, so that the sorted distributions cached on it (`player-profile.js`) are built once. The context's idle warm-up (`warmProfiles`) prepares that same population instead of the raw one, which no card reads any more.
- **What the card still reads raw:** the opened performance itself (`row`), even of an unfinished match, with its observed values. Also the raw appearance index, the match display and `matchGradeRank`, whose rank among the match's grades stays inspectable.
- **Comparison fallback:** `finishedAppearances(data, rows)` is applied to the scoped rows before `aggregateSeasonPlayers`, for the reused and the loaded branch alike; the competitions listed follow the same finished rows.
  - Raw caches, filters and the compact server branch are unchanged.
  - Without a finished observation, the sample keeps its named empty profile and invents no season statistic.
- **Untouched:** the generic aggregators are not changed, and an unknown status is never read as finished.

**Cases (compiled components, real services; before the correction):**
- 29 finished peers plus canceled ones: below the 30-peer minimum, the card says « Échantillon trop réduit » and gives no centile. 30 finished peers: centiles, and unfinished extreme values added beside them change none.
- An unfinished performance opened explicitly: its values and its raw match rank are shown.
- Mixed comparison rows count finished matches only. This includes a fixture-only finished status, while a match of unknown status is left out.
- The reused and loaded branches agree.
- With no finished match, the sample is the named empty profile. The inputs are left unchanged.
- `finishedReadAppearances` gives the same array for the same read.

### 16.2 Opponent difficulty without a centile

| ID | Failure |
|---|---|
| FM-S7.3 | `opponentStrength` (`club-scout.js:2048`) returns `{ club, centile: null }` when fewer than five clubs have a finite paired xG difference. The owned `Upcoming` (`ClubScoutTabs.jsx:481-483`) reads any object as a strength and shows level 1, the weakest. |

**Contract:** null whenever the centile is unavailable. The existing centile is returned as before
when five or more clubs are measured.

**Cases:**
- Four measured clubs give null; five give the centile.
- An absent or unmeasured opponent gives null.
- A legitimate finite centile is unchanged.

**Residual (VI-22):** with null, the owned `Upcoming` prints « hors référentiel » and hides the position, even for a club of the reference that is too thinly measured. The guard removes the fabricated weakest level; it does not make that wording accurate, and `Upcoming` is not edited here.

### 16.3 Both grade tooltips invent zeros

| ID | Failure |
|---|---|
| FM-S7.4 | The recent-form chart (`PlayerScoutOverview.jsx:513`) and the Matchs tab's grade chart (`:827`) print `goals ?? 0` and `assists ?? 0`: an unknown goal or assist reads as an observed 0. |

**Contract:** both tooltips show an unknown goal or assist as « — », and a known 0 as « 0 ». The grades, points, plots and the raw match log are unchanged.

**Cases (browser RED by the coordinator; a compiled supplement through the charts' `tip`):**
- A known goal with an unknown assist gives « 0 / — » (or « 1 / — »); an unknown goal with a known assist gives « — / 0 ».
- An explicit zero stays « 0 / 0 ».
- Both sites behave alike, on desktop and mobile.

### 16.4 Shoot-out kicks among the match's shooters

| ID | Failure |
|---|---|
| FM-S7.5 | `shootersOf` (`match-tabs.js:54`, read by `MatchKpis.jsx:35`) counts the shoot-out's kicks in a shooter's shots, xG, goals and order. |

**Contract:** a shot of `period` `penalties` or `Penalties` is left out, the same predicate as the club service's (§14.4). An in-match penalty and an extra-time shot stay. A shooter's missing xG stays sticky, and the input is not mutated. No `MatchKpis` layout change.

**Cases:**
- Shoot-out goals and misses (one without xG) added to a match leave every regular shooter's values and order unchanged.
- A shoot-out-only player does not appear; both spellings work.
- In-match penalties and extra-time shots stay; the sticky null and the input hold.
- An actual `MatchKpis` render lists the same shooters.

### 16.5 Optional: `rebase`'s paired fallback

`copy` computes `pairedFields(club.rows)` at most once per copied club, only when a paired key is
nullish; provided values (zeros included) are kept. The existing rebase tests cover it; no new test.

### 16.6 Documentation and owner handoffs (no code)

- **Outcome-dependent measured support:** per-indicator measured support is retained (no whole-scope poisoning, no inferred false flag, no backend marker or migration). Root's probe (`review-evidence/review-v2-probes.json`) shows why it is not an unbiased season estimate. A classified 0–0 and a 1–0 whose goal has a null own-goal flag give finishing −1, keeper 0.7, conversion 0 and xG per shot 1, each on 1 match: the goalless one. If ordinary goals systematically lack the flag, the measured matches are selected by their outcome. The synthetic checks establish the arithmetic, not representative season values. A whole-scope suppression policy would need a new joint design (scope, source channels, rollups, migration and API consequences) before its tests.
- **§7.2 corrected:** rejecting an empty shot list avoids inventing a classification; it does **not** remove the selection bias of nullable goal flags.
- **Evidence corrected:** the committed real events fixture (`match_m_08LEIz/events.json`) holds 13 yellow cards and 7 substitutions, and no goal. Its explicit false flags establish nothing about goal events. Its 25 shots carry no own-goal key and no goal. Both scoring sources' contracts (goal shots and goal events) and their production incidence remain unverified: VI-21.
- **VI-22, SetPieces:** `ClubScoutAdvanced.jsx:235-236` (`setXg`) and `:287-288` (« Contre-attaques et CPA réunis ») add a null category xG as 0. A known 0.4 plus a missing xG in fast breaks beside 1.2 at corners shows 1.2; all-null categories show 0. Owner acceptance cases:
  - a missing xG in any included category makes the combined total unavailable;
  - all-null inputs stay unavailable;
  - all-known values sum normally, and an observed 0 stays 0;
  - « for » and « against » behave alike.

  No unused producer field would fix that display, and reverting the truthful category nulls would restore false completeness elsewhere.
- **VI-22, opponent difficulty:** the « hors référentiel » wording above.
- **Rejected xG refit:** `refresh` drops the current model when the base holds a quarter more shots (`xg.py:313`), and a rejected fit raises before scoring. Until a successful refresh:
  - the scores already published stay;
  - shots ingested since stay without a Vega xG;
  - a shot modified at the source keeps its previously calculated score;
  - during a version transition, the scores stay those of the previous version, which is no longer read.

  The daily step is reported failed and retried after its backoff (§10.3); no older model is used to score in the meantime. The accepted rejection contract (no model and no score written) is unchanged; a fallback policy needs its own joint design and tests.

## 17. Stage 8 — one scoring per match, measured on production (written before the tests)

Taken over on 17 Nov 2026 by the session the user asked to finish VI-23 (Linear comment of that
day). This section **supersedes** the own-goal and penalty-attempt rules of §7.2, §11 and §16.6
where they disagree; the user's go-ahead before the push is the joint design §16.6 asked for.

### 17.1 What production holds (read-only, 17 Nov 2026)

- **Goal shots** (`core.shots`, outcome `goal`): the own-goal flag is TRUE or NULL, never FALSE
  (2026: 991 TRUE, 31,632 NULL, 0 FALSE; the same every season 2021–2026). `normalize.py` writes it
  only when the provider sends it, or TRUE for an `OwnGoal`. The §7.2 rule « every goal carries an
  explicit flag » therefore left 64,712 of 65,116 matches with a goal (2021+) unclassified: the four
  indicators were measured on goalless matches only (Le Havre's conversion 0,0 %, Paris's keeper « — »).
- **Goal events** (`core.match_events`): explicit TRUE/FALSE since 2021; NULL only on archive
  matches, which have no shots.
- **The running score of a goal event** follows two conventions: the score after the goal (first goal
  1–0) in 16,880 goals of 2026, the score **before** it (first goal 0–0) in 15,898. The calculator's
  « each goal raises one side by one » check assumes the first, and classified 6,275 of 11,424
  matches with shots (55 %): every goalless match, about half of the others. Outcome-selected again.
- **The team of a goal event is the side credited**, own goals included: where the running score
  says which side rose (the « after » matches), the event's team is that side for 16,879 of 16,880
  goals and for all 475 own goals (2025: 24,027 of 24,030; 671 of 671).
- **A rule on the teams**: goal events whose teams count exactly the home and the away score, every
  flag known, none of another team, classify 11,300 of 11,424 matches with shots in 2026 (98.9 %;
  10,572 of 10,696 with a goal) and 21,722 of 21,754 in 2025.
- **Shots** reproduce both scores with an unflagged goal read as ordinary in 69,841 of 69,969
  matches (2021+); their own goals (TRUE, carrying the scorer's team) disagree with the events'
  in 226.

### 17.2 The rules

**Own goals of a match** (`agg.match_scoring`, read by the calculator and, through
`api.match_scoring`, by every match record):
- classified when the match is finished with its score, its events were read (`events = 'ok'`),
  and its goal events outside the shoot-out each carry an own-goal flag, each belong to the home
  or the away team, and number exactly the home score for the home team and the away score for
  the away team;
- own goals for a side: its credited goal events flagged TRUE;
- otherwise both sides are unknown (NULL). A goalless match with its events read classifies 0 and
  0: its events were read, the score decides nothing; without events it stays unknown.
- The running score of the events is not read, and the shots never classify a goal.

**Penalty attempts of a side** (same view): known only when, besides the classified own goals:
- the shots were read (`shots = 'ok'`), the shoot-out left out, every shot of the home or the away team;
- each side's shots other than own goals (`is_own_goal` not TRUE) number its `total_shots`;
- the goal shots reproduce both scores, an own-goal shot counting for the other side;
- the own-goal shots of each side agree with the events' own goals of the side they count for;
- every attempt of **that** side (own goals aside) has a situation: one unknown leaves that side
  unknown, the other side's count stands.
Penalty attempts are that side's attempts whose situation is `penalty`. Any other match: unknown on
both sides. A count is NULL when unknown, 0 when established none: never coalesced.

**Shape** of the match records (full and summary detail, the league read, the Europe pool): each side
carries `ownGoalsFor` (own goals of the opponent in that side's score) and `penaltyAttempts`; the
shapes `club-2`, `league-2`, `player-2` and `europe-matches-2` say so to the caches.

**The site** reads those fields only: finishing, keeper, conversion and xG per shot are measured
alike for the club and for every other club of its references (ranks, centiles, phases and the
Vega index come back). The shot lists still draw the maps; they no longer classify the scoring.

### 17.3 Failure modes and expected outcomes

The view, on a disposable database (one match each; home H, away A):

| # | Input | Expected `own_goals_for_home/away`, `penalties_home/away` |
|---|---|---|
| a | 1–0, the goal event FALSE for H, complete shot set whose goal shot has a NULL flag | 0/0, 0/0 |
| b | 1–0, the goal event TRUE for H (A's own goal); A's shot TRUE | 1/0, known |
| c | as b, the shot list holding an ordinary goal of H instead | 1/0, unknown/unknown |
| d | 2–0, shots missing one goal | 0/0, unknown/unknown |
| e | an event flag NULL, a perfect shot set | all unknown |
| f | events counting 2 for H in a 1–0 (a disallowed goal kept) | all unknown |
| g | 0–0 with events read / with events unavailable | 0/0 and penalties per the set / all unknown |
| h | shoot-out events and kicks, one in-match penalty of H | shoot-out ignored, penalties 1/0 |
| i | H's shots one fewer than its `total_shots` | penalties unknown/unknown, own goals known |
| j | one H attempt without situation | penalties unknown/known |
| k | a shot of a third team | penalties unknown/unknown |
| l | b and c with the club away (credited A) | mirrored |
| m | events in the « before » convention (first goal 0–0) and in the « after » one | the same classification |
| n | an unfinished match | no row |

The calculator: its own-goal and penalty supports are the view's (`pair_finishing_n`,
`pair_keeper_n`, `pair_conversion_n`, `pair_xg_per_shot_n`); a goal shot with a NULL flag no
longer leaves its match out (§16.6's probe becomes a regression test: a classified 0–0 and a 1–0
give finishing on two matches); a goal event without its flag still classifies nothing.

The read API: the league summary and the club's full read give each side the same two fields for
the same match; unknown is `null`, a known zero `0`; the shot list stays empty in the summary; the
version of a read changes with the shape.

The site (`audit-club-metrics.test.mjs`): the four metrics read the fields whatever the shot list
says (fields null → the metric unknown on that match); a peer read from a summary is measured; a rank
of the four still needs five measured clubs; the club's values from its summary rows equal those
from its full rows.

End to end (production data, after the migration): Le Havre's conversion near 5 %, not 0,0 %; Paris's
keeper a number; « n sur N » ranks for the four; the pizza and the « Finition et gardien » phase
present.

**Accepted residuals:** about 1 % of the matches with a goal (events not matching the score) and 0.35 %
more for the penalty attempts (shots and events disagreeing) stay unmeasured; only matches with a goal
can fail, so the measured support leans very slightly towards fewer goals — recorded, not corrected.
Values differ from main's, which credited an opponent's own goal to finishing. Readers of the shot
flag left as they are (handed off): `club-game-states.js`, `club-analysis.js`, `home-insights.js`;
the normalizer's NULL for an ordinary goal shot (VI-21).

## 18. A cohort re-marked without pause is never refreshed (VI-26, written before the tests)

### 18.1 What production holds (read-only, 17 Nov 2026, 16:42 UTC)

- `models.process_cohorts` claims a queued cohort only once its `ops.dirty_scopes.queued_at` is 600 s old.
- `mark_cohorts` sets `queued_at = now()` and bumps `revision` each time an edition of the cohort changes.
- `team:2021:europe` (cohort 5146) is at revision 2,853. The 2021 backfill rewrites its seven leagues' team
  rows every few minutes, so the cohort has not been refreshed since 9 Nov: calc run 5466, still on
  `docs-calculs-2026-11-09`.
- Its 2022–2026 counterparts republished in `club-indicators-v2` on 17 Nov at 15:02–15:18 UTC.

### 18.2 The rule

- A queued cohort keeps the time of its first mark not yet refreshed, `first_queued_at` (migration 133). A
  re-mark leaves it unchanged.
- The cohort is due at the earlier of `queued_at + 10 min` (the debounce: a match day refreshes a league a few
  times, not once per match) and `first_queued_at + 60 min` (the maximum wait).
- Each pass claims the 50 cohorts due first, oldest due time first, and refreshes them.
- A cohort re-marked while it was refreshed stays queued. Its wait starts again from the time of the claim:
  the refresh read every change made before it.
- 60 min bounds the age of a cohort that keeps changing to about an hour, which is a long match window.
  Such a cohort refreshes at most once an hour while marks continue, plus once 10 min after they stop.

### 18.3 Failure modes and expected outcomes

| # | Situation | Expected |
|---|---|---|
| 18a | Marked once, 5 min ago | Not due (debounce kept) |
| 18b | Marked once, 11 min ago | Due |
| 18c | First marked 61 min ago, re-marked 1 min ago (starving) | Due |
| 18d | First marked 30 min ago, re-marked 1 min ago | Not due: within the maximum wait |
| 18e | A forced cohort re-marked during its refresh | Stays queued; due again only 60 min after the claim (or 10 min after its last mark), not on every pass |
| 18f | A forced cohort not re-marked during its refresh | Deleted from the queue, as today |
| 18g | More than 50 due cohorts | The 50 with the oldest due time (`least(queued_at + delay, first_queued_at + max wait)`, then id) |
| 18h | `min_age_seconds=0` (tests, `cohort_delay=0`) | Every queued cohort due, as today |
| 18i | `player_season`, `team_season`, `competition_season` scopes | Unchanged: the calculator reads neither column; an insert without the column gets `now()` |
| 18j | Rows already queued when migration 133 runs | `first_queued_at` = the migration's time, so a starving cohort is refreshed within 60 min of the deploy |
| 18k | A cohort marked after its row was deleted | A new row: both times `now()` |

**Not changed (recorded):**
- A refresh that raises still ends the whole pass (`Worker.calculate` logs `calculator error`), so a cohort that
  always fails keeps the cohorts behind it waiting. That was already true before this change.
- The status views' `oldest_dirty_at` still reads `min(queued_at)`.

End to end: on a local database, one cohort is re-marked every minute for 70 simulated minutes while another
is marked once. The first is refreshed at the maximum wait, once only, and stays queued after its last
re-mark. The second is refreshed 10 minutes after its mark.

## 19. Cup and open-matchday snapshots (VI-27, written before the tests)

Batch of [VI-27](https://linear.app/vegainteligence/issue/VI-27), 17 Nov 2026, baseline `8018e0836c`.
Source fixes only: no method version, Elo, forecast or identity rule changes (VI-19 and VI-21 keep
them). This batch replays nothing in production.

### 19.1 What production holds (read-only, 17 Nov 2026, 18:13 UTC)

- `worldcup.json` at `516d3825` and `euro.json` at `7bbf6309`: 26 editions, 1,222 fixtures, the same
  1,222 in RDS. Upstream, 1,170 are played; RDS marks 505 finished. All 665 missing results are the
  array encoding `"score": [2, 1]` in 18 World Cups (1950 to 2014, and 2022). `cups.match_rows` reads
  an object score only: 1962 is 0/32 finished, 1974 0/38, 2022 57/64 (England–USA 0–0 among them).
- 1938 Sweden–Austria is `"status": "canceled"`, without a score. `open-cups.mjs` drops `status`, so
  RDS holds the match as `not_started`.
- `cups.save` digests the projection's raw body. A parser fix alone leaves that digest unchanged:
  no stored edition would be written again.
- `cups.save` and `open_matchday.save` delete every match of the edition absent from the snapshot.
  Local reproduction (`sources/repro/red.log`): a 200 with an empty match list, a CSV with other
  headers and a manifest describing neither file each empty a populated edition. A fixture row with
  the key of a result turns the finished match `not_started`, without score or statistics. An
  unreadable body (502) already keeps the edition.
- `open_matchday.save` updates every match and rewrites its statistics every six hours, without a
  revision: a change cannot be told from a re-read.
- The manifest declares, per folder, the rows of each file (`results`, `fixtures`) and its `errors`.
  At `496e94ec` each of the 65 European files parses to exactly its declared count of distinct keys.

### 19.2 The rules

**OpenFootball scores.** One rule for `open-cups.mjs` and `cups.match_rows`. The display helpers of
`openfootball-history.js` read the same encodings.

| Source `score` | Stored |
|---|---|
| absent, `null` or `{}` | no result: `not_started` (`canceled` when the source says so), every score NULL |
| `[h, a]` | full time: `finished`, score h–a; no 90-minute, extra-time or shoot-out value |
| `{ft}`, `{ft, ht}` | as today: the final score is `ft` |
| `{et, …}` | the final score is `et`; the 90-minute score is `ft` when given, never inferred |
| `{…, p}` | the shoot-out, beside a final score |
| anything else | the edition is invalid (`INVALID_SCORE`) |

A pair is two non-negative integers: no boolean, float, string or `null`. The parts are `ft`, `ht`,
`et` and `p` only. `ht` or `p` without `ft` or `et` is incomplete. A source `status` of `canceled`
(or `cancelled`) is stored `canceled` and comes without a score. Any other status, or a canceled
match with a score, makes the edition invalid (`INVALID_STATUS`). The projection writes every score
in the object form (`[h, a]` becomes `{ft: [h, a]}`) and passes `status`. The read API gives
`status` back for a canceled match.

**One version of what is stored.** A cup edition's digest is the hash of the rows it stores
(`CUP_ROWS_VERSION`, the name, then the key and values of every match in source order), not the hash
of the source's body. A parser change that changes a stored value changes the digest, so the
edition is written again at its next due read, once. An edition whose rows are unchanged is not
written again.

**A match changes only when its values do.** On a write, a match whose stored values equal the new
ones is left alone (no `revision`, no `updated_at`). One that differs is updated with
`revision + 1`. A change of source order alone moves `archive_position` and nothing else. The
edition's `cup_updated_at` moves only when a match is added, changed or removed, or the edition is
renamed. `cup_checked_at` is the last accepted read. Open-matchday statistics are rewritten only when
they differ, and a statistics change is a change of its match.

For Open Matchday, `gw` is optional. An omitted column or an empty cell keeps the round
already published in the same edition. A supplied round replaces it. A new match or a match
moved from another edition without a supplied round has no round.

Concurrent changes are checked when a snapshot updates or removes a match. PostgreSQL
compares the row version with the version read for the snapshot. If another transaction
changed it, `SNAPSHOT_CHANGED` rolls back the edition before removing its provider keys.
The result guard also applies to an existing key read in another edition. Identical match
rows still require no write.

Only a match's current provider key participates in comparing membership. Historical keys
remain attached to a retained match. An incoming historical key refuses the changed snapshot
with `INACTIVE_MATCH_KEY`. A permitted withdrawal of the current key removes the match and
the provider's keys for it, including historical keys.

The writer locks only matches it is about to change or withdraw. It then reads and locks their
provider keys in a separate statement. A changed key set gives `SNAPSHOT_CHANGED`. A match linked
to another provider gives `SHARED_MATCH`. Adding or changing a provider key takes a shared lock
on its match first. An insert waiting on a withdrawal fails if the match has gone. The snapshot
still skips unchanged rows.

A withdrawal refuses `MATCH_HAS_DEPENDENTS` when another input holds the match, including
odds or any match event. It reuses the archive dependency catalogue and also checks plain goals.
Open Matchday may remove the statistics it supplies for the whole match and the corners it
supplies by half. The writer locks the statistics rows before checking for additional fields.
Foreign keys protect concurrent addition of dependent rows through the parent lock.

**A snapshot replaces an edition only when it is complete and keeps its results.** Before any write:
- open-matchday: the folder's manifest declares integer counts (not booleans) and no `errors`. Each
  declared file is read. A results file has `date, home, away, ft_home, ft_away`; a fixtures file has
  `date, home, away`. Each holds exactly its declared number of rows. Every result row has both
  sides, a date and two non-negative integer goals. A fixture row without both sides or a date names
  no match and is skipped, as today. A half-time score is kept only when both halves are integers;
- a result and a fixture with the same key are one match: the result, with its score and statistics;
- a match the base holds finished must still be in the snapshot, finished (a score correction is
  accepted). One that is absent (`SNAPSHOT_DROPS_RESULT`) or no longer finished (`RESULT_DOWNGRADED`)
  keeps the whole edition as it was. The exception is a match listed in the reviewed `RETRACTIONS`
  (`vega/sources/snapshot.py`), with its reviewer, date and reason;
- a match not yet played may leave a complete snapshot (rescheduled, decided, withdrawn).

**A rejected snapshot changes nothing and says so.** A cup edition (one scope) fails with its code in
`ops.source_runs`; its digest, `cup_checked_at`, matches, scores and keys stay unchanged. A rejected
open-matchday folder is skipped and its edition is unchanged. The folder counts in `unmatched`, as an
unreadable one already does, and `ops.parse_failures` holds its code and the folder. The other folders
are written. The removal of an open-matchday copy of a league PitchAPI holds (`drop_copy`, `COVERED`,
`SUPERSEDED`, VI-21) is a separate path and is unchanged.

### 19.3 Failure modes and expected outcomes

| # | Situation | Expected | Class |
|---|---|---|---|
| 19a | `score: [0, 0]` (2022 England–USA), `[2, 1]` | `finished` 0–0, 2–1; 90-minute, extra-time and shoot-out scores NULL | CR |
| 19b | `{ft: [3, 3], et: [4, 4]}` (1954 England–Belgium) | final 4–4, 90 minutes 3–3, extra time 4–4 | BC |
| 19c | `{et: [2, 1]}` without `ft` | final 2–1, 90 minutes NULL | BC |
| 19d | `{ft: [1, 1], et: [1, 1], p: [4, 3]}` | final 1–1, 90 minutes 1–1, shoot-out 4–3 | BC |
| 19e | no score; `{}` | `not_started`, NULL scores | BC |
| 19f | `status: canceled` (1938 Sweden–Austria) | `canceled`, NULL scores; the read API says `canceled` | CR |
| 19g | `[2]`, `[2, -1]`, `[2, 1.5]`, `[true, 0]`, `"2-1"`, `{ft: [1, null]}`, `{ht: [1, 0]}`, `{p: [4, 3]}`, `{ft: [1, 0], x: [0, 0]}` | `INVALID_SCORE`, edition unchanged; the projection answers 502 with that code | NC |
| 19h | a canceled match with a score; `status: postponed` | `INVALID_STATUS`, edition unchanged | NC |
| 19i | the 26 frozen editions | 1,170 finished, 665 of them array-encoded in 18 World Cups, 1 canceled, 51 to play; Python and JS give every match the same final score | CR |
| 19j | 1962 and 2022 stored as the baseline stores them (raw digest, array scores `not_started`), then read again, unchanged, by the new code | written once: every played match finished, same match ids, `revision + 1` on changed matches only; the next read changes nothing | CR |
| 19k | the same edition with its matches in another order | positions follow the source; no revision change, `cup_updated_at` unchanged | NC |
| 19l | a populated cup edition, then a 200 with no match | `SNAPSHOT_DROPS_RESULT` in `ops.source_runs`; edition, digest and `cup_checked_at` unchanged | CR |
| 19m | a cup snapshot without one finished match, or with it unplayed | `SNAPSHOT_DROPS_RESULT`, `RESULT_DOWNGRADED`; edition unchanged | CR |
| 19n | a cup snapshot correcting a score (2–1 to 2–2), adding a match and dropping an unplayed one | accepted: `revision + 1` on the corrected match, the new match written, the unplayed one gone | BC |
| 19o | a reviewed retraction in `RETRACTIONS` | that match alone may go; the others stay protected | NC |
| 19p | open-matchday: a fixture with the key of a result (`fixtures: true`) | one match, finished 2–1, its statistics kept | CR |
| 19q | open-matchday: other headers; a header-only file; fewer rows than declared; manifest `errors`; boolean counts | folder skipped, edition unchanged, `unmatched` + 1, one `ops.parse_failures` row with the code | CR |
| 19r | open-matchday: a result row with an empty or non-integer goal | folder skipped, edition unchanged (`INVALID_RESULT_ROW`) | NC |
| 19s | open-matchday: a finished match absent from the new results, or listed only as a fixture | folder skipped, edition unchanged | CR |
| 19t | open-matchday: one folder rejected and another valid in the same summary | the valid one written, the rejected one unchanged | CR |
| 19u | open-matchday: the same files read twice | no match update or revision, statistics untouched (`updated_at` and statistics rows unchanged); `cup_checked_at` advances | CR |
| 19v | open-matchday: a corrected score or statistic | that match updated with `revision + 1`; `cup_updated_at` moves | NC |
| 19w | open-matchday: a fixture no longer listed in a complete snapshot | removed | BC |
| 19x | open-matchday: a league PitchAPI holds (`COVERED`) | removed by `drop_copy` as before | BC |
| 19y | the display helpers (`historicalScore`, `historicalCsvRow`) on `[2, 1]` | 2–1, full time 2–1 | CR |
| 19z | Football.TXT (`openfootball-cups.js`): `2-1 a.e.t. (1-1)`, `2-1 a.e.t. (1-1, 0-0)` | after extra time 2–1, 90 minutes 1–1 (the first pair in brackets) | CR |
| 19z′ | `2-1 a.e.t.` without brackets | after extra time 2–1, 90 minutes unknown (no `ft`) | CR |
| 19z″ | `5-4 pen. 1-1 a.e.t. (1-1, 0-0)`; `4-3 pen. (2-1, 0-1)`; `4-1 (3-0)` | 1–1 after extra time and 90 minutes, shoot-out 5–4; 90 minutes 2–1, shoot-out 4–3; 90 minutes 4–1 (as today) | BC |

**Football.TXT scores.** A line writes the score after extra time before `a.e.t.`, then in brackets the
90-minute score and the half time: `2-1 a.e.t. (1-1, 0-0)` (2021 Club World Cup final, Chelsea–Palmeiras,
1–1 after 90 minutes). The parser keeps the 90-minute score from the brackets and no longer copies the
score after extra time into it. A line without the brackets leaves the 90 minutes unknown. A shoot-out
without extra time is unchanged: its brackets give the 90 minutes.

**Existing expectations adjusted (they encode the defect).**
- The manifest of the trimmed open-matchday fixture (`backend/tests/fixtures/open_matchday/build_summary.json`)
  declares the full upstream counts (100 results and 280 fixtures for the Premier League, 56 and 4 for
  the ÖFB Cup) beside files trimmed to 5 + 3 and 7 + 4 rows. Under 19q that manifest describes truncated
  files, so its counts become those of the trimmed files. No assertion of `test_open_matchday.py` changes.
- `tests/cup-sources.test.mjs` expects `{ft: [2, 1], et: [2, 1]}` for `2-1 a.e.t. (1-1)` and for the
  Club World Cup final `2-1 a.e.t. (1-1, 0-0)`. Under 19z both become `{ft: [1, 1], et: [2, 1]}`.

**Not changed (recorded):**
- The Coupe de France reader (`openfootball-france-cup.js`) has no `a.e.t.` case. It is outside this
  batch's frozen evidence and is left as it is.
- Football.TXT half times stay unread, as before.
- The Elo and the nation pages read `core.matches` at their next pass. There is no new dirty scope or
  trigger (VI-21 owns the schedule).
- Rows sharing a key still make one match, written from the last of them, as before: two undecided
  fixtures (« N.N. ») of one day, or a result listed twice. The one exception is 19p: a fixture never
  overrides a result.
- `ops.parse_failures.family` is NULL for these rows. The status route's `parseFailures` lists them
  with `family: null`, which the column already allows.

End to end: the frozen 1962, 1938 and 2022 bodies go through the real projection, the real writer and
a local PostgreSQL 18, first stored as the baseline code stores them, then replayed. The cup read
gives the corrected matches back. Each rejection scenario of `sources/repro/probe.py` keeps its edition.

### 19.4 Competition logos (written before the tests)

The user asked for real logos only (17 Nov 2026): an image of the exact competition, with its
provenance, or the missing state. In production 126 of 208 competitions have no logo link.
`curated.cup_logos` skips the `open-matchday:` keys of `shared/cup-logos.json`, yet the eleven domestic
cups they name are in the base (`cup:open-matchday:<folder>`, ids 87–97, no logo). The nine national cup
archives (`cup:open-cups:<key>`), OpenLigaDB's DFB-Pokal (`cup:openligadb:germany-cup`) and
International Results' Nations League (`cup:nations-results:nations-league`) have none either. The site
shows each as an edition of one of those cups (`cup-archives.js` `NATIONAL_CUP_ARCHIVES` and
`GERMAN_CUP_FOLDER`; `cup-catalog.js`, Nations League « Ligues A à D »).

Rules:
- An `open-matchday:<folder>` key gives its logo to the competition keyed `cup:open-matchday:<folder>`.
- The same cup under another source's key takes that logo through the site's own mappings above,
  never through a name.
- One asset per URL. A competition keeps its logo when the file has none for it, and a PitchAPI
  competition's own logo is never replaced.
- The continental and national-team cups (Libertadores, Sudamericana, CONCACAF, CAF, AFCON, Copa
  América, Asian Cup, Gold Cup), the open-matchday leagues and the archive competitions have no
  reviewed image in the repository. They stay without a logo and are listed as missing.

| # | Situation | Expected | Class |
|---|---|---|---|
| L1 | an `open-matchday:<folder>` key and its competition in the base | logo linked, kind `logo`, author `SportScore` | CR |
| L2 | an archive, OpenLigaDB or International Results edition of the same cup | the same asset as its cup | CR |
| L3 | a key whose competition is not in the base yet | counted unmatched, nothing created | BC |
| L4 | a PitchAPI competition with its own logo | unchanged | BC |
| L5 | a key or an alias that no source family or site mapping names | the drift test fails | NC |
| L6 | the same pass twice | no new asset, no competition update | BC |

## 20. Archive producer: statuses, labels, stable keys, safe replay (VI-27 lot 2, written before the tests)

### 20.1 What production holds (read-only, 17 Nov 2026)

- `football.json` at `e6744429`, 2019/20. Seven files mark 520 matches `"status": "cancelled"` with
  `"score": {}`: be.1 8, en.3 106, en.4 112, fr.1 101, fr.2 100, nl.1 74, sco.1 19. `archives.match_row`
  knows only `not_played`, so all 520 are stored `finished` without a score. ru.1 holds 236 results and
  4 `"status": "awarded"` (0–3), all stored `finished`.
- `2019-20/ru.2.json` (SHA-256 `7eda7c91…6597`) has exactly ru.1's match array (SHA-256 `66b0f56e…ef22`).
  Both are published: 240 Russian results appear twice, under two divisions.
- 1,783 goal-only archive matches (`g:` keys, worldclub) have no away team. Their label carries tabs and
  line breaks (`1. FC Köln vs. Bayern München 5:1 \t…\n…(Hinspiel 0:3)`), which `parseGoalMatch` does
  not read. The whole label became an invented home team: 1,781 team rows. Normalized, 1,782 labels give
  two sides; 1,735 of their scores equal the stored score, 47 differ, 1 label does not parse.
- A goal-only key is `g:<league>:<date>:<index>`, the index being the group's place in the season's
  group list. Grouping events differently renumbers every later group of the season.
- `Loader.season` deletes every stored archive match of the season absent from the edition, so a
  missing source family or a partial input prunes. A moved `archive_position` bumps the revision.

### 20.2 The rules

**Statuses** (shared/openfootball-history.js notes, edition.mjs, `archives.match_row`):

| Source | Stored | Notes |
|---|---|---|
| no status, a score | `finished`, as today | as today |
| `not_played`, `cancelled`, `canceled`, no score | `canceled`, NULL scores | « Rencontre non disputée » (with the source's reason) |
| `awarded`, a score | `awarded`, its score | none added |
| `cancelled` with a score; `awarded` without one; any other status | the season is refused (`ArchiveError`) before any write | |

A status-less row without a score keeps today's storage and is counted, never reclassified here.

**Reviewed copy.** `build_openfootball_history.py` holds the reviewed exclusion of `2019-20/ru.2.json` at
its SHA-256, a copy of `2019-20/ru.1.json`. At that hash ru.2 is left out of the season and listed
under `excluded` in the index. Other bytes fail the build until re-reviewed. Two other competitions of
one season with identical non-empty match arrays fail the build: no winner is chosen.

**Labels and stable keys** (`dashboard/shared/archive.js`):
- `parseGoalMatch` reads a label with its whitespace collapsed (tabs, line breaks, NBSP). The raw label
  stays as it is.
- Keys keep their legacy numbering. A group's index is the legacy index of the constituent the legacy
  parser understood, else of its earliest constituent. Every other legacy key it now contains, and every
  legacy goal-only key whose goals now belong to a results match, is listed in `absorbed` with the key
  that holds those goals.
- A label that still does not parse names no team: no team entity is created, and the raw label is the
  displayed home name.
- A label the legacy parser did not read whose parsed score differs from the legacy score keeps its
  legacy values (`held: score_conflict`): label parsing never chooses a score.

**Suffixes.** « n.V. » and « i.E. » are read as words with their dots. The former case-insensitive pattern
also matched the « ie » of « (Hinspiel 0:3) ». It turned 1,741 of the 1,782 parsed census labels into
penalty shoot-outs, with their score taken from the last goal. A published goal-only match with such a
suffix therefore shows in the plan as a corrected note or score, to review like any change.

**Replay guard** (`Loader.season`). A stored archive match or edition the candidate no longer holds is
removed only when explained:
- the edition is not imported because PitchAPI holds it (existing rule after 2020/21);
- its edition is a reviewed exclusion;
- its key is `absorbed`.
The last two also need the match to have no dependent row besides its own goal events. Any other removal
(a missing source family, a partial input, an unexplained key) refuses the season with `ArchiveError`, and
nothing of it is written. A change of `archive_position` alone updates that column only.

**Plan and apply.** `python -m vega.archives --sources … --plan out.json` reads only: no insert, no
sequence, no rollback. It lists, sorted, every season's matches by class: new, changed (before and
after values), position only, absorbed, removed (with the rule) or refused. It also gives the stored id
and revision, the teams to create (by key, no id), and the source and parser hashes. Two plans of the
same inputs and base are byte-identical. `--apply out.json --plan-sha256 <digest>` recomputes the plan
under an advisory lock and refuses on any difference (drift). Otherwise it writes the seasons through the
normal loader.

### 20.3 Failure modes and expected outcomes

| # | Situation | Expected | Class |
|---|---|---|---|
| 20a | The seven pinned 2019/20 files | 520 `canceled`, NULL scores, the note; no `finished` row without a score among them | CR |
| 20b | ru.1 | 240 results: 236 `finished`, 4 `awarded` 0–3, keys and ids unchanged | CR |
| 20c | ru.2 at its reviewed hash | not imported, listed `excluded` | CR |
| 20d | ru.2 with other bytes; another identical pair | the build fails | NC |
| 20e | `cancelled` with a score; `awarded` without one; `postponed` | the season is refused, base unchanged | NC |
| 20f | The twelve witness labels | two sides, score and suffix | CR |
| 20g | The full census (1,783 production rows) | per-row disposition summing to 1,783: 1,735 repairable, 47 held, 1 unparsed | CR |
| 20h | An unparsed label | match kept, no team created, the raw label as home name | NC |
| 20i | Legacy keys against new keys | every legacy key kept, or listed `absorbed` | CR |
| 20j | A stored season replayed after the change | repaired rows keep their id with `revision + 1`; a second run writes nothing | CR |
| 20k | A replay without one source family; an unexplained removal | refused; the other family, its goals and editions intact | CR |
| 20l | A removal before later matches | they move position only | NC |
| 20m | A–B and B–A the same day; one pair in two competitions | distinct | BC |
| 20n | The plan twice on the same inputs; with the files in another order | identical bytes; identical season plans (the archive's own hash differs) | NC |
| 20o | An excluded or absorbed match with a dependent row | refused, nothing deleted | NC |

**Not changed (recorded):** the 1,781 invented team rows stay; their ids, keys and dependents are listed
for VI-21. No team is deleted or merged. The 47 score conflicts and the unparsed label wait for an
authoritative source. Status-less rows without a score are counted, not reclassified.

## 21. Authentic artwork: pack import, UEFA crests, the image gate (VI-27 lot 2, written before the tests)

### 21.1 What production holds

- 9,854 of 11,329 clubs and 126 of 208 competitions have no image link. `uefa.save` stores each club's
  `img.uefa.com` logo on its ranking row and never on the club. The site's image gate (`format.js`
  `safeImageUrl`, repeated in `media-registry.js`) accepts PitchAPI, Commons and TheSports only. `Media`
  needs it even when a mirrored copy exists, so any other image renders as initials.
- The reviewed pack (`artwork-release/manifest.json`, SHA-256 `385e97b4…cf4d`) has 613 records (516 teams,
  97 competitions) and 576 display files. Each record binds an entity (`resolve_using` provider and key)
  to an original file (`origin_sha256`) and a display raster (`display_sha256`, `display_format`), with
  its publisher URL, page and evidence. The pack's directories are `originals/<sha256>` and
  `images/<sha256>`. 41 vector or AVIF/GIF originals were converted offline to PNG.

### 21.2 The rules

**One reference per packed image.** A pack asset without an accepted provider URL is stored as
`https://media.vega.invalid/sha256/<display sha256>.<png|jpg|webp>`. That is a reference the base
resolves, never fetched and never a provider's URL. Its S3 key is the existing content address of the
display bytes. The publisher's URL, page, author and licence stay in the asset (`source_page_url`,
`author`, `license`, as stated) and in the import receipt, with both hashes.

**The importer** (`python -m vega.artwork --manifest M --pack D --expected-manifest-sha256 H --plan R`,
`--apply` to write):
- before any write it checks the manifest's digest against H, its schema and counts, and that every path
  stays in D. Each original and display file must have its byte count and hash; each display must be a
  PNG, JPEG or WebP of at most 4 MB, read by its bytes. One entity bound to two different displays is a
  manifest conflict. Any failure stops everything;
- per record it resolves `(entity_type, provider, key)`, following a merged team to the club it is. The
  entity's kind, name and country must match the record (national team against club, ranking row for a
  UEFA key). Otherwise the record is coded and nothing is written for it;
- it writes the display bytes, checks them, then links the asset only where the entity has none
  (`… WHERE crest_asset_id IS NULL`). It never overwrites an image, an asset or its provenance. It bumps
  the team (or each edition of the competition) and `home`, only on a new link;
- every record has one outcome: `linked`, `already_linked`, `kept_existing`, `entity_not_found`,
  `identity_drift`, `proof_missing`, `asset_conflict`, `manifest_conflict`, `storage_failed`. The outcomes
  sum to the manifest's count. A second apply writes nothing.

**UEFA crests in the ongoing source.** `uefa.save` fills an empty club crest from that row's exact
`https://img.uefa.com/imgml/TP/teams/logos/70x70/<its id>.png`, for a club linked by that UEFA id. It
keeps an existing crest and writes nothing on a second run. The mirror accepts this exact form; a
redirect must stay in it.

**One image gate in the site** (`services/image-source.js`, used by `format.js` and `media-registry.js`).
It accepts the three existing shapes, the Vega reference and the UEFA form, with no credentials and no
port. The two new forms take no query or fragment and need the exact path, hash and extension. The
API's `/api/assets` and `media=1` lookups stay the only way to a copy: no address is built from a
reference.

### 21.3 Failure modes and expected outcomes

| # | Situation | Expected | Class |
|---|---|---|---|
| 21a | A UEFA record: key, ranking row, crest NULL | linked; `/api/assets` 307 to its copy; the gate accepts | CR |
| 21b | An official club or league page's image, a vector rendition | linked by its Vega reference, both hashes kept, rendered | CR |
| 21c | An entity with an image (PitchAPI's, lot 1's cup logos) | `kept_existing` or `already_linked`, unchanged | BC |
| 21d | The same pack twice | no new asset, link or version | NC |
| 21e | Key absent; national team for a club record; name or country drift; UEFA key without its ranking row | coded, nothing written | NC |
| 21f | A wrong hash, a short file, SVG or GIF bytes as display, over 4 MB, a path leaving the pack, another manifest digest | refused before any write | NC |
| 21g | An entity bound to two displays | `manifest_conflict` | NC |
| 21h | An existing asset with the reference but other bytes | `asset_conflict`, nothing overwritten | NC |
| 21i | The storage write fails | `storage_failed`, no link | NC |
| 21j | A crest written by PitchAPI between check and link | the importer's link does not land; `kept_existing` | NC |
| 21k | `uefa.save` on a club without a crest, with one, then again | filled once; kept; no second write | CR |
| 21l | The gate: the three shapes; the reference; UEFA; credentials, port, query, other host or path | accepted; accepted; accepted; refused | CR |
| 21m | The real pack (613 records) on a seeded base | outcomes sum to 613; API and browser show the images | CR |

## 22. Corrections after the Astra and Fable reviews (VI-27, 17 Nov 2026, written before the tests)

The reviews (`reviews/corrections.md` C1–C6, `reviews/astra-review.md` F1–F9) showed that the first lot 2
candidate was unsafe. These are the rules of the correction. Where safety cannot be proved, the stored
fact is kept and the record is listed as held. A hold is never counted as a repair and never changes a
stored row, so it cannot change what is scored.

### 22.1 Rules

**Source measurements (C1).**
- In open-matchday, a statistic cell missing from a later file, as an absent column or an empty cell, is
  not an instruction to clear it: the stored value is kept. A cell that states a number, `0` included,
  replaces the stored value, once. Score and result guards (§19) are unchanged.
- In `/api/cups/edition`, a match with an extra-time score and no known 90-minute score has no `ft`. The
  final score stands in for `ft` only when there is no extra time. 0–0 and penalties are kept.

**Archive producer: one legacy reading, units and holds (C2).**
- The published rows are rebuilt by the baseline code itself (`dashboard/shared/archive-legacy.js`, a
  frozen copy of `8018e0836c`'s `buildArchiveSeason`, with its label reading, score selection, notes and
  attachment). The corrected reading is compared with it unit by unit. A unit is the set of legacy and
  corrected rows sharing a source goal event, plus each results row.
- When a unit's corrected keys equal its legacy keys, the corrected rows are the candidate, unless one
  of them changes a legacy score, drops a legacy note or loses goals. When the keys differ (an
  absorption, a merge, a split), the whole unit keeps its legacy rows, flagged `held`. A results row of
  such a unit keeps its results-file values and its published goals (`heldGoals`). Nothing is
  absorbed or deleted in this lot: an absorption needs a reviewed transfer of its dependents (VI-21).
- Exact names first: a goal's side is the side whose name equals the goal's team (case, accents and
  punctuation folded). Similarity decides only when neither side is exact.
- In footballcsv europe `champs.csv` only, each side must read `Name › ASSOCIATION (N)`, with `(N)` an
  appearance ordinal. Any other form stops the build. Such a side is never a new team: its existing
  binding is used, otherwise it names no team (`provisional`). The raw label stays the stored name.
- Reviewed quarantines (`QUARANTINE` in `vega/archives.py`, exact keys, source file and SHA-256):
  - the 33 CONCACAF matches filed under `g:champions-league` 2008/09;
  - Paris FC–Lyon `g:fra-coupe-de-france:2021-12-17:2247` (abandoned; no stored status represents
    "both lost");
  - Bradford–Luton `g:eng-league-cup:1990-10-10:389` (its candidate target's 1–1 contradicts its 0–2).

  They are held as stored. On an empty base they are not written.
- Loader holds, per stored match, all reported with their reason. The match is kept as stored when the
  candidate:
  - changes its score pair or its status (other than finished → canceled without a score, or
    finished → awarded with the same score);
  - clears a team id of the match or of a goal;
  - drops a note, or loses goals;
  - would rewrite goals beside goal facts the archive does not write (player ids, own goal, penalty,
    period).
- Only `event_type = 'goal'` rows are ever deleted or rewritten. Cards and other events stay.
- A source family recorded in `core.source_revisions` (results, goals) that is missing from the inputs
  refuses the run before any write. A season the goals index lists without its file refuses the run.
- A held malformed label never creates a team. It uses the team its exact label is already bound to,
  if any.

**Plan and apply (C3).**
- `season_plan` is the only decision. `Loader.season` executes a plan's entries and nothing else.
- Each entry carries the exact stored and candidate columns, the exact stored and candidate goal rows,
  every stored event of the match, the team bindings it reads and its revision.
- Apply re-plans each season under its lock and writes it only if that plan equals the approved one.
  Teams created by this apply are the only `new:` identities accepted later.
- The team cache lives one season.
- `core.source_revisions` and `ops.resource_versions` change only with a season that writes, and only
  when their values differ. A refused, drifted or no-op apply changes neither, so the archive API's
  ETag stays.
- Outcomes are `complete`, `partial` (a season held or drifted) or `refused`. The exit codes are 0, 3
  and 1.
- A run with no mode refuses (exit 2). `--fresh` imports only into seasons that hold no archive match.

**Role, package and transport (C4).**
- Dependencies are read through `ops.archive_match_dependents(bigint[])`, a fixed-search-path
  `SECURITY DEFINER` function (migration 134) executable by `vega_collect` only. It reports:
  - every `match_id` or `*_match_id` column of core, agg and ops;
  - every `(entity_type, entity_id)` reference to a match;
  - events the archive does not own.

  `vega_collect` gains no table privilege.
- The parser fingerprint names its files logically: `vega/archives.py`, `vega/store.py`,
  `archives/edition.mjs`, `archives/builders/*.py`, `shared/*.js` (the shared files the edition
  imports), each resolved from the running module, `VEGA_ARCHIVE_EDITION` and `VEGA_ARCHIVE_SCRIPTS`.
  A missing file is an error. The checkout and the image give the same manifest for the same bytes.
- Plan transport: `--plan-store` writes the plan into `ops.archive_plans` under its SHA-256. `--show-plan`
  reads it. `--apply-stored SHA` applies it and stores the receipt in the same row. A second apply of
  the same plan writes nothing.

**Artwork (C5).**
- Records are grouped by resolved canonical entity as well as by binding. Two displays for one
  entity are a `manifest_conflict` for every record involved. Identical duplicates are one link plus
  `duplicate`.
- The upload happens outside any transaction and lock. The link transaction then re-reads, under
  `lock_timeout`:
  - the binding, the merge chain and the entity's image (`identity_drift` or `kept_existing` on a
    change);
  - the asset's key, hash and URL (`asset_conflict` on a change).
- Any exception of `put` is `storage_failed`. The run stops there. The receipt, rewritten after every
  record, lists the done, failed and unattempted records. The exit is non-zero.
- `uefa.save` follows the existing merge pointer to its canonical club (one level, the canonical not
  merged, not national). It fills that club's empty crest and holds an inconsistent chain. It never
  writes the alias.

### 22.2 Failure modes and expected outcomes

| # | Situation | Expected | Class |
|---|---|---|---|
| 22a | Open-matchday: same result, later file without the statistic columns, or with empty cells | stats, ids, revision, `cup_updated_at` kept | NC |
| 22b | Open-matchday: a stated `0` replaces a stored 11; replayed | one update; replay writes nothing | CR |
| 22c | Cups: source `{et:[2,1]}`; `{ft:[1,1],et:[2,1]}`; `{ft:[0,0],et:[0,0],p:[4,3]}` through `cups.save`, PostgreSQL and `/api/cups/edition` | `{et:[2,1]}`; both kept; all three kept | CR |
| 22d | Legacy-readable `M vs. N 3:1 (Hinspiel 0:0)`, last goal 2–1 | the legacy 2–1 row kept, held `score_change` | NC |
| 22e | Goal-only `Wien vs. Rapid 3:1 (Hinspiel 0:0)` and result Wiener–Rapid 3–1 | both legacy keys kept, the result without these goals, held `absorption` | NC |
| 22f | Goal teams Manchester United / Real Madrid against a City / Atlético opponent | home / away | CR |
| 22g | A stored goal with a team, a candidate goal without | the match held, its goals kept | NC |
| 22h | A corrected scorer on a match with a card | goals rewritten, the card kept | CR |
| 22i | The goals family missing; a listed goals season without its file | run refused, nothing written | NC |
| 22j | Fewer goals for a stored match | held `goals_lost`, goals kept | NC |
| 22k | `champs.csv` sides with ordinals, fresh and stored; another feed's `Club (2)` | no team minted; stored ids kept; other feed unchanged | NC |
| 22l | A `champs.csv` side not of the exact form | build fails | NC |
| 22m | Quarantined keys (CONCACAF, Paris–Lyon, Bradford) stored, and on an empty base | kept as stored; not written | NC |
| 22n | Two seasons sharing a new team, plan then apply | both applied, one team; repeat apply writes nothing | CR |
| 22o | Between plan and apply: a card added, a binding moved, a team created by someone else | that season `drift`, nothing written | NC |
| 22p | Refused, drifted and no-op applies | source revisions, versions and the real `/api/read/archive` ETag unchanged | NC |
| 22q | No mode; `--fresh` on a season with archive rows | exit 2; refused | NC |
| 22r | A season with a held record and a repair | the repair applied, the hold listed, outcome `partial`, exit 3 | CR |
| 22s | Plan and apply under `SET ROLE vega_collect`; agg read directly | works; denied | CR |
| 22t | The image layout; a parser file missing | same manifest as the checkout; error | NC |
| 22u | Plan stored, applied by digest from another process, applied again | receipt stored; second apply writes nothing | CR |
| 22v | Two aliases of one canonical club with two displays; with one display | `manifest_conflict` ×2; one link + `duplicate` | NC |
| 22w | During the upload: the binding moves; the asset's hash changes; a crest lands | `identity_drift`; `asset_conflict`; `kept_existing`; no wrong link | NC |
| 22x | `put` raises a non-`MediaError` (botocore `ClientError`) | `storage_failed`, receipt with done and unattempted records, exit 1 | NC |
| 22y | `uefa.save` with the UEFA id bound to a merged alias, twice | the canonical club gets the crest once; the alias untouched | CR |
| 22z | 613 pack applied, then the 958 pack, then again | 613 `already_linked` + 345 new, counted apart; repeat writes nothing | CR |

## 23. Archive deletions, primary overlaps, durable applies and typed facts (VI-27, 18 Nov 2026, written before the tests)

Two controlled local data losses were reproduced under `vega_collect` on clones of the 494,713-row reconstruction
(`full-archive-verification/stored-ru2-goal-repair-2251-v2.json`, `empty-primary-repair-2251-v2.json`):
- a goal recorded on a reviewed ru.2 copy after its removal was planned was deleted with it (1 → 0), the stored
  plan reporting `partial`;
- registering an empty 2024/25 PitchAPI Ekstraklasa edition made the stored Polish archive edition "covered": its
  119 matches and 339 goals were deleted, the plan reporting `complete`.

The accepted plan (`tracks/4-history/accepted-plan.md`) fixes these rules.

### 23.1 Rules

**A deletion binds everything it would delete.**
- Each planned removal carries:
  - the match's full stored row and its revision;
  - every event row of the match, goals included;
  - its round and edition;
  - the dependency inventory (`ops.archive_match_dependents`, which now also counts every event);
  - for a reviewed copy, the retained twin: key, date, sides, score and provenance.
- A match with any event or dependency is held, never deleted (`removal_has_dependents`).
- Apply locks the season's archive matches and the removed matches' events. It then re-plans, and any difference
  in what a removal binds is a refusal of the season before any write.
- Just before the deletion, the apply takes SHARE locks on every relation naming a match without a foreign key
  (`ops.archive_lock_match_references()`, migration 140, bounded by `lock_timeout`). It re-reads the inventory and
  deletes only if it is still empty. Writers with a foreign key wait on the match lock and then fail on the deleted
  match, so their conflict is exposed. Writers without one wait for the commit. That residual race is reported (the
  receipt's post-commit reference check). The rollout requires writers drained (C4).
- An edition is removed only with no match, round or other fact left on it.

**A primary edition is routing, not proof of coverage.**
- After 2020, a competition PitchAPI holds that season is not imported when the base has no archive edition of it
  (the existing route).
- An archive edition already stored for it keeps its matches, goals, ids and provenance: every match is held
  (`primary_overlap`) and the edition is kept. This holds with an empty, partial or complete primary edition.
  Reconciling the two is VI-21's.

**Durable, owned applies.**
- `ops.archive_plan_seasons(sha256, label)` records each season's decision in the transaction that writes it (outcome,
  counts, created identities).
- A stored plan is applied by one session at a time (`pg_try_advisory_lock` on its digest): a second gets
  `ArchiveError`, writing nothing.
- A season already decided is not attempted again. The identities it created are restored for the following
  seasons, so a run can resume after a crash.
- `applied_at` and the receipt are stamped only when every planned season has a decision. A subset run stamps
  nothing beyond its own seasons.
- `--show-plan SHA` writes the stored bytes, whose SHA-256 is the digest.

**Published observations change only when reviewed** (per field, on a stored match):
- The score pair: held `score_change`.
- The status: only finished → canceled (no score, source `cancelled`) and finished → awarded (same score, source
  `awarded`). Any other change is held `status_change`.
- Extra-time, penalty and shoot-out columns: a value may be added where none was stored. A stored value never
  changes or goes (`phase_change`).
- Goals: never fewer (`goals_lost`); never a cleared team (`team_cleared`).

**Typed facts from reviewed sources.**
- `VERIFIED_SHOOTOUTS` (`vega/archives.py`) lists the seven UEFA shoot-outs of
  `verified-seven-shootouts-repair-2251-v2.json`. Each has its goal-only key, date, both sides as the label names
  them, the sporting tally, the home/away kicks and the UEFA document's SHA-256. Kicks are written only when the key,
  date, sides and tally all match. Otherwise they stay unknown.
- A goal's side in an OpenFootball UEFA results row (`YYYY-YY/uefa.*`), whose team names carry their association
  (`Real Madrid (ESP)`): after exact names fail, the name without its ` (ABC)` suffix is compared exactly. Only one
  side may match; otherwise the side stays unknown. The stored names and suffixes are kept.

### 23.2 Failure modes and expected outcomes

| # | Situation | Expected | Class |
|---|---|---|---|
| 23a | A reviewed copy planned for removal gets a goal before the apply | season refused (`drift`), the goal and the match kept | NC |
| 23b | A second connection inserts a goal on it while the apply holds its locks | the apply deletes; the late insert fails on its foreign key and is retried by its writer; no orphan | NC |
| 23c | A second connection's uncommitted goal before the apply takes its locks | the apply waits, sees it, refuses the season | NC |
| 23d | A clean reviewed copy (no event, no dependency) | removed, with its binding in the receipt | CR |
| 23e | A provider binding of a removed match planned or added before the apply | held, or refused; nothing deleted | NC |
| 23f | A stored archive edition, then an empty, partial or complete PitchAPI edition of it | every match, goal and id kept, held `primary_overlap`; repeat writes nothing | NC |
| 23g | No archive edition stored and a PitchAPI edition | not imported (unchanged route) | BC |
| 23h | Two processes apply one stored plan | one applies, the other is refused | NC |
| 23i | A crash after the first of two seasons | per-season decision kept; restart applies the second with the first's created teams; plan stamped once | CR |
| 23j | A subset of a stored plan's seasons | only those decided; the plan not stamped applied | NC |
| 23k | `--show-plan` output | byte-identical to the stored plan, SHA-256 = digest | CR |
| 23l | A stored score, status or phase value differing from the candidate | held with its field; a reviewed cancellation or award applies | NC |
| 23m | The seven verified shoot-outs; one with another tally | kicks typed; the other left unknown | CR |
| 23n | `Real Madrid` scoring in `Real Madrid (ESP)`–`Atlético Madrid (ESP)`; two sides with one base name | home; unknown | CR |

## 24. Removal guards that hold after the commit (VI-27, 18 Nov 2026, written before the tests)

The pinned Astra review of §23 (18 Nov) found that §23's SHARE locks close the window before the commit only. A
writer without a foreign key that is blocked by them resumes after the commit with the removed match's id. So does a
writer starting later. The review also found four other faults:
- rounds and editions were deleted without an inventory of what references them (FKs with CASCADE or SET NULL from
  agg, ops and core);
- the twin of a reviewed copy was compared with the compiler's candidate, not with the stored row;
- `apply_stored` read `applied_at` before taking the plan's lock;
- an edition's name, country or order changed without a new publication.

### 24.1 Rules

- **Tombstones** (`ops.archive_removals`, migration 141). The transaction that deletes an archive match, edition or
  round records its kind, id, season, key and plan digest. A tombstone is never removed.
- **The guard.** Every relation of core, agg and ops that names a match or an edition without a foreign key carries
  the `archive_removed_reference` trigger. It covers:
  - `match_id` and `*_match_id` columns without a foreign key to `core.matches`;
  - `competition_season_id` columns without a foreign key to `core.competition_seasons`;
  - polymorphic `(entity_type, entity_id)` references to a match;
  - `ops.resource_versions` of kind `match` or `competition_season`.

  An insert or update naming a tombstoned id fails with `foreign_key_violation`, so a writer that resumes after the
  commit, or starts later, is refused and can retry.
  - Writers with a foreign key wait on the row lock, then fail on the missing row.
  - A test lists every such relation and fails if one has no guard.
- **Editions and rounds.** One goes only when `ops.archive_edition_dependents` reports nothing, at the plan and again
  under its locks. That function covers every column naming it, with or without a foreign key, its versions and its
  emblem. Otherwise the edition is kept and its plan entry says why (`edition_has_dependents`). Edition and round rows
  are locked `FOR UPDATE` for the deletion.
- **The twin is the stored row.** A copy goes only beside its twin's stored match: same date, team ids, names, score
  and status. The plan binds that row in full, so a change to the twin refuses the season.
- **Ownership.** `apply_stored` takes the plan's lock, then reads its state.
- **Publication.** An edition whose stored name, country or position changes is a write: the season's version moves.
- **Conflicts.** A deadlock or a serialization failure in an apply is `lock_timeout`, never `applied`. Nothing is
  decided, so a later run retries.
- **Edition emblem storage.** Migration 141 also adds `core.competition_seasons.emblem_asset_id`: nullable, FK to
  `core.assets`, distinct from the family logo (the joint edition-emblem arbitration of 18 Nov). An edition with an
  emblem has a dependency and is never removed.

### 24.2 Failure modes and expected outcomes

| # | Situation | Expected | Class |
|---|---|---|---|
| 24a | A writer without a foreign key (provider binding, match version) blocked by the deletion's locks, released by its commit | its insert fails (`foreign_key_violation`); no orphan | NC |
| 24b | The same writer starting after the removal | refused the same way | NC |
| 24c | A removed copy's edition with a version, a scope or an emblem | the matches go, the edition stays (`edition_has_dependents`) | NC |
| 24d | The twin's stored row differs from the copy (name, team, score) | the copy held `twin_mismatch` | NC |
| 24e | A plan stamped applied while its applier read it unstamped | refused after the lock | NC |
| 24f | A stored edition's name changed | the season's version moves | CR |
| 24g | A deadlock between the apply and another writer, both under their real roles | `lock_timeout`, nothing written, the other writer goes on | NC |
| 24h | Every relation naming a match or an edition without a foreign key | carries the guard | NC |

## 25. OpenLigaDB DFB-Pokal match phases (VI-27, specified before tests)

The typed reader applies to the 2025/26 and 2026/27 DFB-Pokal editions. The two sealed OpenLigaDB
responses have 119 unique matches, eight fixtures and 111 finished matches. The DFB sheets attest
110 native half-times, a missing native 0–0 for 80173, 21 regulation and extra-time pairs for
matches going to extra time, and 13 shoot-outs. Eight native type-2 pairs are wrong; 11 shoot-out
tallies differ from actual kicks. Match 79584 lacks an extra-time row. The 111 playing finals
remain as published.

| Input or replay | Expected |
| --- | --- |
| Exact frozen editions | Keep keys, sides, dates, order and finals. Add phases by native match ID; preserve 0–0. |
| 79584, provider type 2 changes to 1–1 and ET is still missing | Keep official final 2–1, 90 1–1 and ET 2–1. |
| 80173, provider adds half-time 0–0 or publishes direct 4–5 | Accept convergence with zero sporting writes. |
| Attested third result, swapped sides, changed date or contradictory tuple | Refuse with match key and retain edition. |
| Completed match loses a known HT, ET, regulation or penalty phase, or is downgraded | Refuse refresh, retain known observations, edition and digest. |
| Unattested ET previously unseen | Preserve actual final/ET; keep regulation unknown even with a type-2 pair. |
| Unattested P 5–6 after level ET 1–1 | Store 4–5; a subsequent unverified 4–5 raw tally conflicts with the accepted kicks. |
| P without ET, P below ET, non-level ET for a shoot-out, or tied P | Refuse as unreviewed. |
| Missing or unordered/contradictory observation | Missing or malformed data and contradictory duplicates are invalid; source tuple order alone has no sporting effect. |
| Future fixture carrying known result tuples | Remain scheduled, with no score or published phases. |
| Other OpenLigaDB editions, Nations League and direct penalties from OpenFootball | Published behavior and digest remain stable. |
| Two more reads of each frozen edition | Zero match writes; keep revisions, row versions, match timestamps, digest and edition publication timestamp. |
| Accepted or refused new native observation | Keep its immutable, independently inspectable phase evidence with decision and ledger digest; keep raw evidence away from the public response. |

Read contract uses optional `periods`. A 90-minute score is omitted when the match reached
extra time and regulation is unknown. Separate the official kicks from the raw native tally.

## 26. Verified emblems for individual competition editions (VI-27, specified before tests)

The loader verifies all input byte hashes before upload and accepts only records explicitly
typed as `competition_edition` with role `edition_emblem`. Exact source identity is required
through the family binding, the edition key plus season (for archives), or the certified
family/season pair (for native editions). Its pointer is separate from the family logo.

| Input or concurrent change | Expected |
| --- | --- |
| 18 FIFA, four continental cup, 23 archive and two native attestations in their respective sealed packs | 47 edition links to 41 display images, including two native and their correct internal season IDs. |
| Same display shared by several editions | Reuse the verified asset; distinct edition links retain their own provenance. |
| Old envelope without a role, documentary poster, bad key, wrong family or year | Reject input or hold the binding clearly. No link. |
| Two aliases to one exact edition, two different displays | Both held as manifest conflicts. |
| New edition pointer, changed identity or asset during upload | Keep the winning state; no stale attachment. |
| Destination upload or checksum failure | No link; receipt retains prior committed results and next unattempted records. |
| Apply repeated or ordinary cup refresh after apply | Preserve links, provenance and publication versions. |
| Family contains a wrongly used edition logo | Clear only the sealed family/URL/hash association and retain the asset. Reject unqualified reimport for that family. |
| Explicitly scoped archive/native link | Invalidate the corresponding archive resource or native publication path without reusing an emblem in the family catalogue. |

## 27. Apply reviewed deletions and updates in the same archive season (VI-27, specified before test)

A reviewed ru.2 copy can have an exact stored ru.1 twin whose order or other permitted field
will be updated by the very same approved plan. Guard and delete the copy against the twin's
locked pre-image before updating the twin. Both changes commit together. A late external
change or a new dependent still aborts the whole season. The frozen 52-object replay observed
the self-conflict at `r:2019-20/ru.2:237` and rolled back every one of the 240 approved removals.

## 28. Attested scores and publication for OpenFootball cups (VI-27, specified before replay)

For Tours–Lorient, the exact [awarded] marker, score, edition, oriented sides and date
identify the attested FFF decision. Preserve the administrative 0–3 and qualification as
awarded and keep all playing phases absent. A later snapshot that omits the marker or
match cannot undo an accepted award. Other markers do not authorize a status change.

The national World Cup has 67 exact reviewed halftime repairs (six corrections and 61 fills).
The native final, raw halftime and both explicitly timed goal arms must agree with the reviewed
case, or the candidate contributes no correction. Source-earned goals stay on the recorded
beneficiary's side, including own goals, and 45+ stays in the first half. Missing arms, implausible
or out-of-order clocks, wrong totals and the official minute-0 anomaly provide no new halftime.
Those 67 decisions keep the original keys, all playing finals, ET, penalties and cancellation.

The 2021–23 Club World Cup text has 22 explicit halftimes; apply the bracket syntax only for the
three scoped texts. Keep the first pair after extra time distinct from the 90-minute and
halftime pairs. Preserve known phases when a later response loses the supporting observations.
Only an accepted change bumps the cup's edition publication resource. Repeated identical inputs
and refused updates leave sporting versions and API bodies intact.

## 29. Scoped World Cup family-logo cleanup (VI-27, specified before replay)

The two verified wrong logos are detached only by exact provider binding, family identity,
source URL and content digest. Existing different logos survive migration. Refreshes and
an older writer retain their unrelated competition updates while the scoped attachment is
suppressed. A verified family-specific pack may supply a new logo with explicit provenance.
Edition-specific links and the old source asset remain available independently.

## 30. Attested Bundesliga pair and date decisions, 1963–1967 (VI-27, specified before tests)

The 100 published pairs and 17 dates come from exact adjudicated source observations. Use
the surviving result key, keep every old goal's non-identity columns and rebind by its
reviewed side. A fresh import constructs the canonical shape and text alias. A reviewed
upgrade retains the target's ID and the old numeric link. Timestamps, scores, event order,
sequence IDs and all other annotations in stored transfers stay intact.

An occupied target, enriched or incomplete event family, source key or member drift,
non-foreign-key dependent, mismatching date, or contrary alias holds the whole affected
case. One late competing write aborts the signed season. Add the former match tombstone
before exposing the commit. A stale worker cannot recreate an alias key, remove the
canonical goals, or restore the pre-correction date. The archive read checks its edition
version after fetching the data, including through the commit.

## 31. Three reviewed Scottish archive observations (VI-27, documented before replay)

Queen's Park–St Mirren on 30 August 1924 and Queen's Park–Hamilton on 23 November 1946
are independently attested 2–1 results. Edit only the scoped final, with exact native input
hash, key, date and oriented participants, the known old score, no attached events or other
dependent, and an atomic amendment receipt. Preserve the raw score and public key. Repeated
inputs produce no new writes. An old worker cannot reinstate the erroneous result.

The 4 January 1919 Clydebank–Morton winner and score remain as observed. Neither archive
binding labelled Clydebank has an appearance around this date in the measured clone. Keep
the existing match and identify the missing dated participant binding in the plan; adding
a name-only team or merging the Airdrieonians root would not repair that missing proof.
The return ties and verified shared grounds in 1903 remain exactly as previously published.

## 32. Match grade precision in ranking and report JSON (VI-32)

The ranking exposes the grade rounded to a tenth. Reusing that value for a whole-number
display can round twice. In Orenburg–CSKA, Tataev's recorded grade was 48.4903434662912
and the ranking's 48.5 displays as 49 with the site's French integer formatter. The
rankings API keeps the tenth and exposes the precise value of the same SQL row as
`gradeExact` for an already visible grade. The report propagates it beside the tenth in
`grades`, `best` and `playerOfMatch`, leaving all existing picks and ordering intact.

| Situation | Expected |
|---|---|
| Two source grades on opposite sides of 48.5 both publish the tenth 48.5 | Each exact value survives JSON; the grade's integer can be formatted directly and the original ranking order survives |
| SQL stores a new index that takes the same visible row from 48.49 to 48.51 | Legacy response fields remain identical; exact value, report JSON and ranking ETag change with the revision |
| Grade is exactly 0 or 100 | Both representations retain the measured number |
| Grade is hidden by the existing minutes and index rules, or the source value is non-finite | Precise field is null and legacy visibility, ordering and rank remain as before |
| Older ranking result lacks the precise field | The report keeps its historical row shape and grade |
| Incoming precise field is invalid, out of range, disagrees with the historical tenth, or accompanies a hidden legacy grade | The report keeps the legacy grade and discards the invalid precision |
| Unknown match or invalid query | Ranking retains its 404 or 400 response |

The PostgreSQL-to-ranking-to-report check uses the normal read role, HTTP responses and
the public report handler. The recorded football witness is replayed with the captured
grades as inputs. The database fixture also models a new publication within the same
tenth. Changes to the match tabs, images and share text are outside this transport step.

## 33. Transfermarkt refreshes keep what was accepted (VI-31, written before the tests)

Batch of [VI-31](https://linear.app/vegainteligence/issue/VI-31), 18 Nov 2026, baseline `1b28961a88`
(the reader code is the deployed `8018e0836c`'s). Reader and migration 139 only: no identity merge, no
replay, no repair of production rows (VI-21 keeps merges and global links). Values, injuries and squads
still replace their lists; they are separate exposures with their own owners.

### 33.1 What the deployed reader does

- `write_transfers` deletes every Transfermarkt transfer of the player, then inserts the response. A 404 is
  read as an empty history and recorded as a 200. A 200 without `history`, an empty list or a list cut to
  one move each therefore empties or shortens a stored history, and the next read gives the same moves new
  row ids. Two real histories (26 and 29 moves read from RDS) fall to 0, 0 and 2 on a local copy
  (`transfer-read-queue/verification-original.json` in the track evidence).
- `contract` deletes every other Transfermarkt contract of the player, so a move, a renewal or a key held
  by another source drops the earlier spells. It changes nothing when the profile's club is not one of
  ours: the earlier spell stays published as confirmed after the player left.
- `api.confirmed_player_contracts` has no quarantine filter: a link doubted after its contract was written
  keeps it published. The profile view finds a doubt through `ops.provider_links.entity_id` only.
- `write_search` writes the provider's player rows without the contract step, so the next profile read
  sees no change and never asks for the transfers again.
- `failed()` builds `timedelta(hours=2 ** attempts)` before its cap: from 35 attempts it raises
  `OverflowError` and the reader process stops.
- A list of the wrong type (`"terminated": {}`) raises a `TypeError`, which also stops the process.

### 33.2 The rules

**A transfers response is checked whole before anything is written.** The response must hold a
`history` object with at least one of its two lists (`terminated`, `pending`). Every element must be an
object with a numeric `id`. The same `id` twice is one move when the two records state no different fact;
otherwise the response is refused. A refusal writes no fact and goes through `failed()`: the true HTTP
status, a code, the attempts and the bounded wait are stored, and `read_at` and `rows_written` keep the
last accepted read.

| Response | Player holds | Facts | Queue |
|---|---|---|---|
| 404 | no Transfermarkt move | none | 404, no code, normal period |
| 404 | a move | unchanged | 404, `HISTORY_MISSING`, backoff |
| 200, no `history`, `data: null`, no list | anything | unchanged | 200, `HISTORY_MISSING`, backoff |
| 200, both lists empty | a completed move | unchanged | 200, `HISTORY_EMPTY`, backoff |
| 200, both lists empty | nothing, or announced moves only | the announcements marked absent | 200, no code |
| 200, a list or `history` of another type | anything | unchanged | 200, `SCHEMA_CHANGED` (schema stop as before) |
| 200, an element without object or numeric `id` | anything | unchanged | 200, `HISTORY_INVALID` |
| 200, one `id` with two different facts | anything | unchanged | 200, `HISTORY_CONFLICT` |
| 200, valid | anything | upserted by key; absent moves marked absent | 200, no code, `rows_written` = moves listed |

**A listed move updates its own row.** The row is found by player, source and native key, and keeps its
id. A field the record states replaces the stored one; a field it omits or gives as null keeps it. A fee
of 0 is stated only by a free transfer (`fee.value` 0 with the label « free transfer »); any other 0 is
no amount, as for the values. When the kind of move changes and no fee is stated, the old fee is cleared.
A club key that changes takes the new key and its canonical club, or NULL; never the old club's. The same
club key keeps the canonical club resolved now, else the one stored. A completed move listed again as
announced keeps its completed facts (an older snapshot). An announced move listed as completed becomes
completed in place. A listed move has `absent_since` NULL and `as_of` the read day.

**A move missing from an accepted history keeps its facts.** It gets `absent_since`, the first day it was
missing, until a later history lists it again. A shorter list proves no withdrawal, and an absent
announcement is not a cancellation. Rows of other sources, and Transfermarkt rows without a key, are
never touched. One row per player and Transfermarkt key (unique partial index, migration 139). Writers of
one player are serialized (a transaction lock per player): two readers at once give one row per key.

**A contract is a dated fact; the current one is a dated choice.** A profile record changes contracts only
when it has its `attributes` and `clubAssignments` blocks, one current club key, and valid dates
for both the start and expiry. The expiry cannot be before the start. Then:
- its spell, when the club is ours and the expiry known, is written at (player, club, start) or updated in
  place (same source); `superseded_on` NULL. A key another source holds is left as it is;
- every other Transfermarkt contract of the player not yet set aside is superseded:
  - from the new start, when that start is later than its own (a move, a renewal; a future start keeps
    today's contract until then);
  - from the read day, when the new start is not later but the record's expiry is current (a return from
    a loan, a correction);
  - otherwise not: an older record without a current expiry is a stale one.

A superseded contract keeps its end date as observed; no end date is invented. A record of a club that is
not ours supersedes the same way and writes nothing. `api.confirmed_player_contracts` reads a contract
while `superseded_on` is NULL or later than today, and no Transfermarkt contract of a doubted link. A link
is doubted when a quarantined `ops.provider_links` row names the player or the key of his current link,
so a quarantine still holds when `entity_id` names an older player. `api.player_profiles` finds its doubt
the same way. Both keep their columns.

**One step for a player record, from the profile or the search.** Both reads compare the record with the
provider row first (club, start and expiry: transfers due now; value: values due now), then write the
row, then, for a linked player, the contract. A record without its `attributes` or `clubAssignments`
blocks or carries a malformed contract keeps the known contract fields. A search with such a record
makes the profile due now. Player 30095's two expiries (contract 2028-06-30, provider row 2027-06-30) stay as they are: the
next complete record of either path decides.

**Health.** The wait of a failed unit is `2 ** min(attempts, 8)` hours, at most 7 days: no overflow. A
refusal of one player returns `failed` and the reader reads the next unit; only `SCHEMA_CHANGED` counts
toward the schema stop.

**Rollback.** A Transfermarkt transfer or contract is never deleted by a refresh. Migration 139 refuses
such a deletion (`TRANSFERMARKT_HISTORY_KEPT`) unless the transaction sets
`vega.allow_history_delete = 'on'` (a person's decision). The reader before VI-31 deletes on every read, so
a rollback first stops the reader (`UPDATE ops.transfermarkt_state SET gave_up_at = now() WHERE id = 1`,
honoured by both versions) and keeps it stopped until a preserving version runs again. If the stop is
forgotten, its deletions fail and its process restarts every 5 minutes; nothing is deleted. Dropping
the index would not make that reader safe.

### 33.3 Failure modes and expected outcomes

| # | Situation | Expected | Base |
|---|---|---|---|
| 20a | 404 on a first read | no fact; 404, no code, next due after the period | red (200) |
| 20b | 404 after an accepted history | ids, keys, dates, clubs and kinds unchanged; 404, `HISTORY_MISSING`, attempts 1, backoff; `read_at` and `rows_written` of the accepted read | red |
| 20c | 200 without `history`, or `data: null`, on a first read or after a history | no fact; 200, `HISTORY_MISSING` | red |
| 20d | 200, empty lists, after a completed move | unchanged; 200, `HISTORY_EMPTY` | red |
| 20e | 200, empty lists, on a first read | accepted; 200, no code, 0 rows | green |
| 20f | 200, empty lists, announcements only | announcements kept, `absent_since` today; 200, no code | red |
| 20g | `terminated` an object; `history` a list | unchanged; `SCHEMA_CHANGED`; no exception | red (TypeError) |
| 20h | an element not an object; an `id` empty or not numeric | unchanged; `HISTORY_INVALID` | red |
| 20i | one `id` twice with another date | unchanged; `HISTORY_CONFLICT`. The same record twice: one row | red |
| 20j | a valid history without one completed move, then with it again | listed moves updated in place; the missing one kept, `absent_since` its first day (kept on a second short read), NULL when listed again, same id | red |
| 20k | the same history twice | same ids, keys and facts; no new row | red (new ids) |
| 20l | stated date, fee, free transfer, value, expiry, season, kind; omitted or null fields | stated fields replaced in place, 0 for the free transfer; omitted and null fields kept; a kind change without fee clears the fee | red |
| 20m | a club key changed; a club linked between two reads | new key with its own canonical club or NULL; same key keeps the re-resolved club | red |
| 20n | announced → completed; completed → announced in a later response | completed in place, same id; completed facts kept | red |
| 20o | another source's transfer, a Transfermarkt row without key | untouched by every read | red (the keyless row) |
| 20p | two readers on one player at once | one row per key, the second's facts on the first's row | red |
| 20q | a unit failing for the 41st time | no exception; due in 7 days | red (OverflowError) |
| 20r | normal entry (`step`): one player's history refused, another's valid | `failed` then `ok`; the reader not paused; the refused unit counted failing in `api.provider_reader_progress` | red |
| 20s | a move to another of our clubs | old spell kept, superseded from the new start; profile shows the new club | red |
| 20t | a renewal at the same club | old spell kept, superseded from the renewal; profile shows the new expiry | red |
| 20u | a move starting tomorrow; the same move started yesterday | today's contract still confirmed; after the start, the new one | red |
| 20v | another source holds the observed key | its row unchanged; earlier Transfermarkt spells kept and superseded; profile: its expiry confirmed, the provider's observed beside it | red |
| 20w | a move to a club not ours | no row; earlier spells superseded from its start; no confirmed contract; observed contract of that club | red |
| 20x | no club, no start, expiry before start, record without its blocks | nothing changes | green |
| 20y | an older record whose expiry is past or missing | nothing superseded | red |
| 20z | back from a loan: the parent's superseded key with a current expiry | parent revived, loan spell superseded from the read day, one confirmed contract | red |
| 20aa | the same profile twice | no new row; `as_of` only | green |
| 20ab | the expiry corrected on the same key | end date updated in place | green |
| 20ac | the link quarantined after the contract, `entity_id` naming another player | no confirmed contract, no observed Transfermarkt contract, through the view and `/api/players/{id}` | red |
| 20ad | a search reads a linked player whose club changed | contract step applied; transfers due now; provider row written after the comparison | red |
| 20ae | a record without its blocks, from a search or a profile | provider row keeps its fields; no contract change; from a search, profile due now | red |
| 20af | an unlinked or doubted player's record | provider row only, no contract | green |
| 20ag | migration 139 over NULL Transfermarkt keys and repeated keys of another source | applied; the index covers Transfermarkt's non-null keys | — |
| 20ah | migration 139 over a repeated Transfermarkt player/key | stops with `TRANSFER_KEYS_NOT_UNIQUE` and the first pair; nothing changed; 139 not recorded | — |
| 20ai | the deployed writer's deletions after 139 | refused with `TRANSFERMARKT_HISTORY_KEPT`; every row kept; with `vega.allow_history_delete = 'on'`, allowed | — |

End to end: the real `Reader` (`read` and `step`), controlled HTTP answers, all migrations on a local
PostgreSQL 18, the queue, `api.player_profiles` and the read API's `/api/players/{id}`. Contract dates
are relative to the base's `current_date`. Independently, the 55 real moves of two players
(`replay.py --expect protected`) and the thirteen observations of `reproduce-history.py`.

### 33.4. Expiry evidence on a new club observation (VI-31 continuation)

A record can contain both profile blocks and still omit or corrupt the contract expiry. It may
refresh independent profile facts, but the last dated contract and its staging provenance remain
authoritative. Missing, invalid and explicit null have distinct meanings:

| Situation | Expected |
|---|---|
| A new club and start with `contractUntil` omitted | Keep the last accepted staging tuple, both views and every contract. Profile HTTP 200 keeps the accepted values. The profile queue reports `CONTRACT_MISSING` and a bounded retry |
| A new club and start with `contractUntil` malformed, including trailing garbage after a valid date prefix | The same preservation, with `CONTRACT_INVALID` in the profile queue |
| An incomplete expiry comes from the club search | Preserve the same observations. Make the player's ordinary profile read due now |
| The provider explicitly gives `null` | No date is measured. Preserve any dated observation and treat the profile payload as accepted, without inventing a contract or a termination. A valid current club remains available for club linking when no dated claim exists |
| A valid later club spell or a valid correction to the same spell, now expired | Publish the new dated spell or apply the stated correction. Keep the historical row and its source. An expired observed end can remove its current presentation |

An empty assignment or an undated profile reply supplies no documented release date. Historical
transfer events and dated end corrections still retain their existing independent meaning.

## 34. Tournament editions: group tables, placings, phases and navigation (VI-27 B, 18 Nov 2026, written before the tests)

Main's tournament pages (`2f25e3e58f`) ranked every group with three points a win, then goal difference, goals
and the name; read a round it did not know, or no round, as the first round; and gave 1950's final pool no placing.
The Astra–Fable decision of 18 Nov (`decision-plan.md`, registry C27–C30) sets the rules below. A rule the site does
not hold leaves the rank undetermined: no ordinal, medal or filled gauge is ever drawn from it.

### 34.1 Rules

**Points a win.** World Cup groups: 2 to 1990, 3 from 1994. Euro final-tournament groups: 2 to 1992, 3 from 1996
(Sweden 1992: two wins and a draw, 5 points; UEFA). Any other competition or edition: unknown, so neither points nor
positions are given.

**Separating teams level on points**, per edition, each step only where the regulation is attested:

| Editions | Steps, in order | Then |
|---|---|---|
| World Cup 1954, 1958 | the group's play-off (`Group N Play-off`), the winner ahead; it never counts in the group's totals | level |
| World Cup 1974–1990 | goal difference, goals scored | level (lots) |
| World Cup 1994–2014 | goal difference, goals scored, then among the teams level: points, goal difference, goals | level (lots) |
| World Cup 2018, 2022 | the same | level (fair play: cards the reader does not hold) |
| Euro 2020, 2024 | among the teams level: points, goal difference, goals, applied again to a remaining subset; then goal difference, goals | level (disciplinary points, qualifying ranking) |
| World Cup 1930, 1950, 1962–1970, 2026; Euro 2028; the rest | none declared | level |

Teams still level share the position (« 2= » for both, the next one 4th); the cell says « Départage indisponible ».
Inside such a block the rows are listed by goal difference, goals and name, as display order only.

**Groups.** A group is the match's `group`, else a round named `Group X` (Euro 2028), else 1950's `Final Round`
(« Poule finale »). A finished match counts with its final score, after extra time (England–Belgium 1954, 4–4). A
canceled match never counts. A group with a match dated before today and neither scored nor canceled has no
positions, and its teams with such a match have no points or difference. A group with nothing played yet has no
positions. 1950's final pool is ranked only when its six matches are scored and its points equal the attested table
(Uruguay 5, Brazil 4, Sweden 2, Spain 1).

**A nation's run (`/api/nations/{id}`).** The stage is its last match's round. A round the reader does not know,
or none (International Results' tournaments), is « Phase non renseignée »: no tone and no gauge. Group rounds are
`Matchday N`, `Group …` (play-offs included), the collected source's day numbers (`1`, `2`, `3`), `First round` and
`Preliminary round`. A 1950 final-pool run takes its placing from the attested table only when the nation's three
final-pool matches are those of the table (each opponent once, each score as attested, the nation named as in the
table): 1st « Vainqueur » gold, 2nd « 2e » silver, 3rd « 3e » bronze, 4th « 4e ». Otherwise « Poule finale », no tone.
The site shows « Phase non renseignée » for a run whose matches carry no round, whatever the API says (an older API).

**Navigation.** A run links only to an edition the site holds (the collected World Cup's 2022 and 2026, the
archive's own editions, the other tournaments' seasons), on a view that edition has: the matches for International
Results' tournaments, the groups for 1950, the bracket otherwise. Since the C28 refresh, an explicit « Tableau »
for 1950 shows its final pool and only names its champion when the six results match the attested table. The collected World Cup's
edition is in the address when it changes, so a reload keeps it. A national team's French name finds its matches
(« Italie », 1982) as its source name does (« Italy »). A match the source canceled (Sweden–Austria 1938) reads
« Annulé », never « À venir » or a missing score. A replayed tie shows its replay and carries the replay's identity,
the first match kept apart. A phone's chosen round stays within the bracket it is given.

### 34.2 Failure modes and expected outcomes

| # | Situation | Expected | On A |
|---|---|---|---|
| 34a | 1950 final pool, frozen archive through the projection | Uruguay 1st 5, Brazil 2nd 4, Sweden 3rd 2, Spain 4th 1 | red (7, 6, 3, 1 points) |
| 34b | 1950 final pool with one score missing (older API) | no positions | red |
| 34c | 1950 final pool whose scores disagree with the attested table | no positions | red |
| 34d | 1950 group 2: England, Chile, USA on 2 points | Spain 1st; the three share « 2= » | red |
| 34e | 1954 group 2 and its play-off (West Germany 7–2 Turkey) | Hungary, West Germany, Turkey, South Korea; West Germany and Turkey 2 matches, 2 points | red (Turkey 2nd) |
| 34f | 1958 group 1 and its play-off (Northern Ireland 2–1 a.e.t., 1–1 at 90) | West Germany, Northern Ireland, Czechoslovakia, Argentina; play-off outside the totals | red |
| 34g | 1954 group 4: England–Belgium 4–4 a.e.t. (3–3 at 90) | England 3 points, 6 goals for; Belgium 5 for | green on goals, red on points |
| 34h | Euro 2020 group F | France, Germany, Portugal, Hungary, none level | red (Portugal 2nd) |
| 34i | Euro 2024 group E, four teams on 4 points | Romania, Belgium, Slovakia, Ukraine | to observe |
| 34j | World Cup 1994 group E, four teams on 4 points | Mexico, Ireland, Italy, Norway | to observe |
| 34k | World Cup 2018 group H | Colombia 1st; Japan and Senegal « 2= », « Départage indisponible »; Poland 4th | red |
| 34l | World Cup 1982 group 1 | Poland, Italy, Cameroon, Peru (goals scored) | red (Poland 5 points) |
| 34m | Euro 1992 group 1 (UEFA witness, outside the catalogue) | Sweden 5, Denmark 3; France and England 2, « 3= » | red |
| 34n | Euro 2028: 36 matches, groups named in the round | six groups A–F, four slots each, no positions | red (« pas jouée en groupes ») |
| 34o | A group without its edition (rule unknown) | no positions, no points | red |
| 34p | A canceled group match | not counted, not a missing result | to observe |
| 34q | Nation run, last match without a round (Argentina, Copa América 2024) | « Phase non renseignée », no tone, 6 matches, link kept | red (« 1er tour ») |
| 34r | Nation run, an unknown round name | « Phase non renseignée » | red |
| 34s | Uruguay, Brazil, Sweden, Spain 1950 (attested matches) | Vainqueur gold, 2e silver, 3e bronze, 4e | red (1er tour) |
| 34t | Uruguay 1950 with Sweden twice and no Brazil (still 5 points) | Poule finale, no tone | red |
| 34u | Uruguay 1950: Spain 3–2, Sweden 3–2, Brazil 1–1 (still 5 points) | Poule finale, no tone | red |
| 34v | Uruguay 1950, the Brazil match without a score | Poule finale, no tone | red |
| 34w | Existing stages: final won, lost, unscored; third place; penalties; twice-held edition | unchanged | green |
| 34x | Site: a run with no round in its matches, older API saying « 1er tour » | « Phase non renseignée », no gauge, no medal | red |
| 34y | Site: gauge of « Poule finale », « 2e », an unknown stage | 4, 5, none | red |
| 34z | Run links: World Cup 2021, 2030 | none | red (collected World Cup) |
| 34aa | Run links: Copa América 2024, CAN 2023; World Cup 1950; 1998 | `view=matchs`; `view=groupes`; `view=tableau` | red |
| 34ab | 1950's page | opens on « Groupes »; explicit `view=tableau` shows the final pool | red |
| 34ac | Collected World Cup, 2026 then 2022 in the head, then reload | `edition=2022`, 2022 after reload | red |
| 34ad | Phone: « Finale » chosen in 2026, then a bracket with one round fewer | the last round shown, no error | red |
| 34ae | 1982 matches, search « Italie », then « Italy » | the final found both times | red |
| 34af | Sweden–Austria 1938 (`status: "canceled"`) | « Annulé » in the list; no missing-score notice for it | red |
| 34ag | A replayed tie whose two matches have ids | the replay's id and score; the first match under `replayOf` | red |

## 35. Main's twin merge and purge on the branch, and the VI-27/29/31 corrections (19 Nov 2026, written before the tests)

The branch merges main `840414438c` (`goalTwins`/`merge_twins` of `0f368fd389`, `scope.purge(conn, calc)` of
`cb32089578`) and corrects what the 34ca reviews reproduced (`delivery/corrections-34ca/brief-corrections.md`, Fable's
plan of 19 Nov). Every check runs the real writers under `vega_collect`/`vega_calc` on a disposable PostgreSQL 18.6
and reads back through the real read API under `vega_read` where a route serves the data.

### 35.1 Rules

**Archive twins.** The edition (`buildArchiveSeason`) ends with `goalTwins` over its final rows: a goal-only row
(« g: ») that is a result (« r: ») becomes that result, which keeps its key and takes the goals (their sides) and the
goals' date. Rows of a held unit (`held`, `heldGoals`) and the keys the importer names (`options.keep`: `QUARANTINE`
and both attestation ledgers) are never merged; such a pair is listed in `twinsHeld` with its reason, and every merged
pair in `absorbed`. The importer refuses a season whose stored rows still hold a `g:` the edition absorbed
(`TWIN_NOT_MERGED`, named pairs, nothing written); once `merge_twins` has run, the plan holds nothing for the pair.
`merge_twins` takes the archive apply lock with a try first (`vega.archives.apply`): taken, the pass stops without an
error. It never merges a pair with a quarantined key, a key of either ledger, or a row named by
`core.archive_match_attestations` (its match, former key or former id); each such pair is printed with its reason.
Each merged `g:` gets its tombstone (`ops.archive_removals`, no plan) in the deleting transaction. One season failing
is rolled back alone and printed; the next seasons still run. `twins.mjs` sits beside `edition.mjs`: `TWINS` defaults
to that directory (the image sets `VEGA_ARCHIVE_EDITION` only), and `code_manifest()` names `archives/twins.mjs`.

**Purge.** For each competition, before its calculations' half, the purge reads the rows that would block its
deletion in the tables the collection role may not delete from. One such row holds the competition: nothing of it is
removed, agg included, and the result names the table (`held`). Otherwise the two halves run as on main, and a DELETE
is only sent to a table holding matching rows. No privilege is added.

**Cup snapshots.** Every cup edition takes its edition lock before its first read (stored digest, baseline): two
imports of one edition are applied one after the other, the stored rows are those of the body whose digest is stored,
and a replay of it writes nothing. A period pair a body omits (half time, extra time, the 90 minutes, the shoot-out)
keeps the stored pair, zeros included; an explicit different pair replaces it (the publication families' guard still
refuses a known phase changing). A body omitting a stored pair while it changes the full time is refused
(`PERIODS_CONFLICT`): it cannot be told from another reading of the score.

**Open Matchday reschedules and withdrawals.** A stored fixture whose key leaves the files is rescheduled when exactly
one new fixture of the edition has the same home and away teams, no other stored fixture of that pair leaves, and its
key was never a match's: the match keeps its id and everything naming it (`snapshot.rekey`), and its date and round are
written. Any other case of a pair is ambiguous: no rekey, and the scope records `AMBIGUOUS_RESCHEDULE` naming it. A
fixture withdrawn (not finished: a result is guarded) is deleted when nothing holds it but an ordinary forecast
(`agg.match_forecasts`, which the forecast pass rewrites). Odds, events, another authority's statistics, a line-up
forecast, another source's key, or a parent field no snapshot writes (`kickoff_at`, `venue_id`, `referee_id`,
`attendance`) keep it: it stays as stored, the rest of the files is written, and the scope records
`MATCH_HAS_DEPENDENTS` (or `SHARED_MATCH`) naming it. A resource version naming a match locks that match as a key
does (migration 152): written after a withdrawal's check, it waits for the deletion and is refused.

**SportScore.** Under the publication lock the run reads again what qualified the response (the edition, its
members, the names' teams, the counted and kicked-off matches) and qualifies it again with no provider call. A response
that no longer qualifies is refused with its rule's code (`INCOMPLETE_TABLE` for a club of the table missing): the
accepted table keeps its rows, its date and its ETag. A fresh organiser proof is fetched before the lock or not at all.

**Transfermarkt transfers.** The list of a player whose transfers were accepted once is served after any later
refusal or failure: same body, same ETag. Never accepted: 404. Accepted empty: an empty list. Quarantined: 404. A
move the last accepted history omits stays, served with `absentSince`; listed again, it loses the mark, keeps its row
and id, and its absence is kept in `core.player_transfer_absences`. A fee of 0 and an unknown fee stay apart.

### 35.2 Failure modes and expected outcomes

| # | Situation | Expected | Before the corrections |
|---|---|---|---|
| 35a | Edition of a season with a twin (result 3 days before its goals) | one `r:` row, the goal and the goals' date; the pair in `absorbed` | red: the goal-only row stored beside its result |
| 35b | Base merged by main's `merge_twins`, then the branch's plan | no entry for the pair; `merge_twins` again: `{}` | red: `goals_lost` on the result, the goal-only row `new` again |
| 35c | Base still holding both rows, then a plan | refused `TWIN_NOT_MERGED` naming the pair, nothing written; after `merge_twins`, no entry | red: no refusal, both rows kept |
| 35d | A pair with a quarantined key, or a ledger key, or an attested row | never merged, edition and `merge_twins`; listed with its reason | red: no exclusion in `merge_twins` |
| 35e | `merge_twins` while an apply holds `vega.archives.apply` | the pass stops, no error, nothing written | red: merged while an apply held the lock |
| 35f | A season whose merge fails (the attested date trigger) | that season rolled back and printed; later seasons merged | red: the first error stops the pass; the later twin stays |
| 35g | After `merge_twins` | tombstone of the `g:` id; `r:` key and id 200 with goals and date; an attested alias 200; the `g:` key 404 | red: no tombstone; the alias refused (149) |
| 35h | A plan stored before `merge_twins`, applied after | `drift` with its reason; nothing written | green (manifest refusal); the stored plan drifts |
| 35i | The image's file set | `TWINS` exists there; `archives/twins.mjs` in the manifest | red: `TWINS` outside `/app`, not in the manifest |
| 35j | Purge under both roles, a competition with no protected row | removed whole, as on main | red: 42501 on `core.archive_match_attestations` |
| 35k | Purge under both roles, a competition an attestation (or an artwork proof) names | held with the table; its agg rows and rankings untouched; the next competition removed | red: 42501 after agg was cleared |
| 35l | Main's purge on this schema, a competition left to purge | fails (42501) after its calculations' half: a release condition | red (main's code, witness) |
| 35m | Two imports of one cup edition, disjoint changes, then a replay | the stored rows are the digest's body; the replay writes nothing; cup and match routes agree | red: rows of both bodies under one digest |
| 35n | Euro 2024 file without Germany–Scotland's half time; then an explicit half time; then 0–0 kept | 3–0 kept, 200/304 unchanged; the explicit one written; a stored 0–0 kept | red: 3–0 and 0–0 erased, new ETag |
| 35o | Extra time and shoot-out omitted; full time changed while extra time omitted | stored pairs kept; `PERIODS_CONFLICT` | red: extra time and shoot-out erased; the changed full time accepted |
| 35p | Open Matchday fixture moved 29→30 Nov with an ordinary forecast, another result corrected 2–1→3–1 | same match id, forecast kept, 3–1 written, scope ok, old ETag 200 | red: `MATCH_HAS_DEPENDENTS` by the forecast, 2–1 kept, 304 |
| 35q | Two fixtures of one pair leave and one arrives, or one leaves and two arrive | no rekey; `AMBIGUOUS_RESCHEDULE`; no fact lost | red: no reason named |
| 35r | Fixture withdrawn: nothing / an ordinary forecast / odds / events / a line-up forecast / `kickoff_at` / another key | deleted / deleted / held, the rest written, the code named | red: forecast refused, `kickoff_at` deleted, the rest frozen |
| 35s | A match resource version written after a withdrawal's check | refused; no orphan after the commit | red: the version written, orphaned |
| 35t | A fourth club's result and membership written between qualification and publication | refused `INCOMPLETE_TABLE`; the accepted table, its date and ETag kept | red: the three-club table published |
| 35u | An older observation (08 h after 11 h), homonyms and reserve sides | unchanged rules (existing tests) | green |
| 35v | A repeat needing a fresh organiser proof | no provider call under the lock | green (no case reaches the organiser under the lock) |
| 35w | Three moves accepted, then 404 / empty / malformed refresh | 200, same body, 304 on the old ETag | red: 404 |
| 35x | Never read; first read refused; first 404; quarantined | 404; 404; 200 empty list; 404 | green |
| 35y | Partial history without one move, then the move again | `absentSince` served, old ETag 200; mark cleared, same id, absence kept | red: no mark, 304 |
| 35z | The 55 keys of the two witness players, fees 0 and unknown, the value curve | served unchanged; fees apart; the curve's club changes unchanged | red: 404 |

### 35.3 With main dc65d69's football-data.co.uk (19 Nov 2026, written before the tests)

Main added `core.footballdata_matches` (140_football_data.sql, applied in production by the run 44439499486): one row
per row of a season file, its one link `match_id` (an archived match, unique, `ON DELETE SET NULL`), written by the
collection role, read before the transaction (`prepare`). It creates no `core.provider_ids` key. Production held, on
19 Nov at 05:06 UTC (read only), main's migrations up to 138 and 140_football_data.sql and none of this branch's.

| # | Situation | Expected | Before the corrections |
|---|---|---|---|
| 35aa | The restorer on the merged schema, the reviewed captures | dry run, apply (35 identities, 70 Elo sides of 2097), a second pass writing nothing; a football-data pair on a restored identity refuses a new apply and stays | red: `unreviewed destination dependency inventory` |
| 35ab | `merge_twins` on a goal-only match football-data paired | the pair cleared (`SET NULL`), its row kept, the tombstone written, no error | green on arrival (no change needed) |
| 35ac | The purge under both roles of a competition whose match football-data paired | removed; the football-data row kept without a pair; nothing held | green on arrival (no change needed) |
| 35ad | An archive copy football-data paired, in a plan | held `removal_has_dependents`, never deleted | green on arrival (no change needed) |
| 35ae | Migrations from production's set (main dc65d69) to the head | names and checksums equal the head's; the catalogue equals a fresh installation's | green: 20 files after 140_football_data, 7 of them out of order; same catalogue |
| 35af | football-data.co.uk's row of a stored twin pair, dated as the goals archive dates it; `merge_twins`; the reader's next pairing (`footballdata._link`) under the collection role | before the merge, not the result's (the goal-only twin's, or none: two candidates); the merge clears it; the next pairing gives it the result, whose id is unchanged; another row's pair unchanged | green on arrival (no change needed): before the merge, the twin's (its own clubs in this base) |

## 36. Fable's review of 5a16b1aa: what the CI runs, the absences' privileges, an attested purge (19 Nov 2026, written before the tests)

Fable's first verdict on the merged candidate 5a16b1aa (CHANGES_REQUESTED) found no defect of behaviour in VI-27/29/31
or in the merge of main dc65d69, and four gaps. The CI's tests job runs the Python suites before
`npm ci --prefix backend/api`: on a fresh checkout the end-to-end tests that read through the real API skip (M1;
36a's first run found eight other tests failing there on the missing module). The image job checks `archives.EDITION` but not `archives.TWINS`, the path production's twin errors
came from (m5, 35i). 153 revokes `core.player_transfer_absences` from PUBLIC only, and 017's default privileges leave
the collection role UPDATE and DELETE on it (m1). The purge's hold is tested with an artwork proof only, not with a
match attestation and its composite key (m2, 143).

### 36.1 Rules

- The tests job installs the read API's dependencies before the Python suites, then runs the API suites with them.
- This lot's end-to-end classes need a disposable database, psycopg, node and `backend/api/node_modules/pg`. They are
  the snapshot roles (35m–35s), the served transfer history (35w–35z), the archive twins with 35g's HTTP read, and the
  SportScore race (35t, 35v). Outside CI, a missing prerequisite skips them with its reason, as before. Under CI
  (`CI=true`, which GitHub Actions sets), it fails them with that reason, which lists their prerequisites.
- The image job checks that `archives.TWINS` is in the image, with the other files the adapters read.
- `core.player_transfer_absences`: the collection role reads it and adds to it (the reader's
  `INSERT … ON CONFLICT DO NOTHING`); it may neither change nor remove a row, as with the proofs of 142, 143 and 146.
  An authorized deletion of a move (139) still takes its absences (`ON DELETE CASCADE`). The read role has nothing on
  it. 153 has been neither published nor deployed: it is corrected in place.
- A removed competition whose match a match attestation names is held whole, as for an artwork proof.

### 36.2 Failure modes and expected outcomes

| # | Situation | Expected | Before the corrections |
|---|---|---|---|
| 36a | ci.yml's tests job, its steps in their order, on a fresh checkout (no `backend/api/node_modules`), `CI=true` | the Python suites run every end-to-end class and pass: nothing skipped | red on 5a16b1aa: 15 tests skipped (35m–35s, 35w–35z, 35g, 35t and two §20 HTTP tests), and 8 others fail on `Cannot find package 'pg'` (test_dfb_periods, 22p, five of test_source_snapshots): the step is red, not green |
| 36b | These classes with `backend/api/node_modules` missing | `CI=true`: they fail, naming it; `CI` unset: skipped with their reason, the suite passes | red on 5a16b1aa: under `CI=true` the 13 selected tests are skipped with their reasons |
| 36c | The image job's path check in the worker container | `archives.TWINS` among the paths: main dc65d69's image refused (twins.mjs outside /app), the candidate's accepted | red: main's image passes its own check, the check with `archives.TWINS` refuses it (`missing: /backend/archives/twins.mjs`) |
| 36d | `core.player_transfer_absences` under the real roles, an absence written by the real reader under vega_collect | vega_collect: SELECT and the reader's INSERT work, UPDATE and DELETE refused (42501); vega_read refused; an authorized deletion of the move takes the absence | red: vega_collect updated and deleted the absence (one row each); the rest already held |
| 36e | The purge of a removed competition whose match a `core.archive_match_attestations` row names | held whole: competition, edition, both matches, agg and the ranking stay, the attestation too; a second purge holds it again; no privilege changes | green on arrival (no change needed) |

Recorded, not corrected by this review (Fable's m3 and m4):
- A withdrawn fixture that another authority holds stays `not_started`, with a new `ops.parse_failures` row at each
  read (`snapshot.py:212-225`, `open_matchday.py:390-396`). This conforms to 35r but has no reviewed way out yet: a
  follow-up of VI-27, this lot's issue.
- A football-data pair holds an archive copy's removal (`archives.py:586-587`, 35ad), although the link is
  `ON DELETE SET NULL` and the reader pairs again every week. The arbitration between ignoring `SET NULL` links in
  reviewed removals and a documented manual release is VI-21's.

## 37. Collection wake-ups and shared reads: the Elo after a complementary change, one International Results read, an empty statistics answer (19 Nov 2026, written before the tests)

Reproduced on `2088d36e60` before any change. E04k: with the National League North CSVs of the audit capsule
(`declenchement-elo.zip`), the real `Worker.daily` under `vega_collect` and `vega_calc` writes the four new results and
leaves 8 of 258 admitted sides without an Elo for three passes; a native match due in another season then publishes
260/260. `refresh_elo` runs only when `due_seasons` names a season, and `due_seasons` reads PitchAPI editions only
(`cs.cup_key IS NULL`). In production the live native seasons are due once a UTC day, so the wait there is bounded by
the next UTC day; in a base without a live native season it has no bound. E02b: each International Results edition
is one `node bridge.mjs projection` process, each fetching the same `results.csv` (3.76 MB): eight editions due
together, eight reads. E02d: a 200 answer whose player statistics list is empty, for a finished match whose family
already holds rows, is a batch without rows and coverage `ok`; `Store.save_family` sees another fingerprint, deletes
the rows and records `ok`; the backfill planner skips `ok` families, so nothing asks again.

### 37.1 Rules

- **The Elo is due after a complementary change.** At each daily pass, after the sources ran, the Elo is due without a
  due season when the last published Elo run (`agg.power_runs`, `kind='elo'`) is older than the population it would
  read now: a finished, scored match of a cup-source edition (`cup_key` set, no `archive_key`: Open Matchday,
  OpenFootball, OpenLigaDB, International Results, Fjelstul-paired cups) written or changed after the run started
  (`core.matches.updated_at > started_at`: a new result, a corrected score, a restored match), or a side the run wrote
  whose match is gone, no longer finished with its score, or now in an archive edition (a withdrawn match). No run yet
  and such a match: due. Native changes keep their own rule (`due_seasons`, with its waits). The Elo then runs once for
  the pass, as before. No new column and no migration: the run's own `started_at` and `agg.team_elo` are the record.
- **And only then.** A pass that changed nothing makes nothing due: the run started after every change it read, and
  each side it wrote still has its match. The same CSV read again, an edition whose digest is unchanged, a source in
  error: no Elo run.
- **One International Results read per pass.** The editions of `nations-results` due in one `sources.run_due` pass are
  projected in one bridge process (`bridge.mjs projections`), in which a URL is fetched once and its answer (success
  or failure) given to every projection of the pass. Each edition keeps its own validation, `save`, digest
  (`cup_digest`), `cup_checked_at`, `ops.source_runs` status and `last_success_at`. A failed read fails every edition
  of the pass with its code, writes nothing, keeps their last success, and leaves them due after the usual retry
  delay; the next pass reads once. A bridge process that fails (timeout, exit) fails each edition with its code. An
  adapter offers this with `prepare_due(conn, get, scopes, now)`; the others are unchanged.
- **OpenFootball and OpenLigaDB** are not batched: each of their editions reads its own file (checked by listing
  the URL each edition's projection fetches), so a shared read would save no request.
- **PitchAPI summaries read twice in Ligue 1 (E02b's second witness)** are the planner's correction read: a match seen
  final is asked again `CORRECTION_DELAY` (24 h) later (`planner.after_summary`), and its details again when the
  summary changed. Intended; not changed.
- **An empty statistics answer does not erase an accepted observation.** In `Store.save_family`, for a finished match,
  an answer of a detail family with no row at all (an empty list, or `unavailable`) while that family's tables hold
  rows for the match is refused: `StoreError("EMPTY_AFTER_OBSERVATION")`. Nothing is deleted or written, the match's
  revision does not move, and the worker's failure path records it (`ops.parse_failures`, `ops.family_state` status
  `error`, the job failed and revived after a day as any non-permanent failure). The family is then not `ok`: the
  backfill planner asks for it again. The same rows given again later make it `ok` with its old fingerprint. A first
  empty answer (no rows held) is written as before. A partial answer (fewer rows) is not refused: telling a provider's
  correction from a partial answer needs a rule this section does not give.
- **A held withdrawal is traced once (§36 m3).** An Open Matchday read that keeps a withdrawn fixture another
  authority holds (35r) adds an `ops.parse_failures` row only when no row of the same edition, code and message exists:
  the refusal stays visible, a read in the same state adds nothing. 35r's guard is unchanged.

### 37.2 Failure modes and expected outcomes

| # | Situation | Expected | Before the corrections |
|---|---|---|---|
| 37a | Native 2019 match and the previous NLN CSV, one daily pass | Elo published, 250/250 | green |
| 37b | The current NLN CSV (four new results), no native season due | the same pass publishes the Elo: 258/258 | red: 250/258, no run |
| 37c | The next pass, one hour later, nothing read | no new Elo run, `agg.team_elo` unchanged | green (nothing ran) |
| 37d | The same CSV read again seven hours later | no new Elo run | green (nothing ran) |
| 37e | A complementary score corrected by its source (International Results 1–0 becomes 0–1) | the Elo is due and runs once; the next pass none | red: no run |
| 37f | A complementary match withdrawn (its row deleted), then restored | each makes the Elo due once; the side then gone / back | red: no run |
| 37g | Eight International Results editions due together, real bridge and projection, fetch counted in node | 1 request; 8 editions `ok`, each its digest, `cup_checked_at`, `last_success_at` | red: 8 requests |
| 37h | The next pass at once | nothing due, 0 requests | green |
| 37i | The editions due again, the source answering 503 | 1 request; 8 editions `error` (`HTTP_502`), rows and `last_success_at` kept | red: 8 requests |
| 37j | The next pass after the retry delay, the source back | 1 request, 8 editions `ok` | red: 8 requests |
| 37k | A finished match's player statistics (75 minutes) then a 200 with `[]` | rows kept, family `error`, a `EMPTY_AFTER_OBSERVATION` failure, revision unchanged, the backfill asks again | red: rows deleted, `ok`, nothing asked |
| 37l | The same rows given again | family `ok`, nothing rewritten | — |
| 37m | A first empty answer (no rows held) | written `ok`, as before | green |
| 37n | A held withdrawn fixture read three times unchanged | one `MATCH_HAS_DEPENDENTS` row | red: three rows |

### 37.3 The four planner cases of E04k

The registry names four data changes the planner does not wake, without listing them. Found in the audit pages:

1. A complementary change alone does not wake the Elo (this section, 37b–37f).
2. An empty statistics answer erases and is never asked again (37k).
3. A correction written between the players' read and the levels' start of `models.refresh_daily` does not make the
   season due again (`PIPELINE-NOTES.md` §4): `due_seasons` compares with the levels run's `started_at`.
4. A result corrected in a later season moves the Elo of earlier seasons, whose player grades read the Elo before the
   match, and only the corrected season is ranked again (`RECALCUL-JOUEURS.md`).

3 and 4 are recorded, not corrected here: 4 means ranking every season after any Elo change (a whole pass per
season, the memory limit of 13 November) and is a decision of the grades' owner; 3 belongs to the same reading point.

### 37.4 A way out for a held withdrawal (§36 m3, recorded)

No reviewed path releases a held, not-started fixture. `snapshot.RETRACTIONS` releases only a finished result the
guard would keep. The smallest coherent mechanism is a reviewed map of the same kind, `{(provider, key): "reviewer,
date: reason"}`, read by `snapshot.remove(held=…)`: a listed fixture goes with what holds it, the others stay held.
What goes with it (odds, events, a line-up forecast, another authority's fields) is the decision that needs the user;
it is not written.

## 38. Player match grades: the first award year, a third team's row, the board's rule, the reasons by key (E04e/f/i/l, VI-21, 19 Nov 2026, written before the tests)

Reproduced on `2088d36e60` with the real writers on a disposable PostgreSQL 18.6 (`vega_calc` for the
calculations, `vega_read` for the reads): a calendar-year league whose edition 2021 holds 30 matches dated before
1 August 2021 (award year 2020) and 26 after it, beside an August–May league 2021/22.

**E04f, award year 2020.** The daily path never computes award year 2020, for three reasons that hold together:
`worker.due_seasons` lists only seasons with PitchAPI editions (2020 holds archives only); `models.refresh_daily(2021)`
runs `refresh_players(2020)` only when `power.previous_year_changed(2021)` is true, and that query requires player
statistics in physical season 2020 (`EXISTS … s.season_id = 2020`), which no source ever writes; `stale_rankings`
re-ranks only a season that already has a published players run. The participations of 1 January–31 July 2021 stored
in the 2021 editions (MLS, Eliteserien, the first July rounds of 2. Bundesliga, …) are read by no run: 0 of 682 graded
in the reproduction, 14 418 in production (11 562 once Allsvenskan, `scope.py` `l_1XsMdH`, is set aside). The gate is
deliberate (its docstring: « the first half of the calendar-year leagues alone would rank a year the European seasons
are missing from »; `test_models` asserts it). A direct `refresh_players(2020)` grades all 682 against award year
2020's own references (`grade_reference_year`: a finished year is its own), and publishes a 2020 ranking and award race
of the calendar-year leagues alone. Which references grade that partial year, and whether it is ranked, is a method
decision: this section records it as open and changes neither.

**E04l (a), a third team's row.** A statistics row whose team is neither side of its match, with a position, in a match
whose two Elo sides exist, joins both sides as « opponent » (`opp.team_id <> s.team_id`): two rows for one
player-match, and the COPY into `agg.player_power_matches` stops the publication on 23505. The whole award year keeps
its previous rows.

**E04l (b), the board.** `GET /api/matches/{id}/players` reads `api.match_grades.grade`, which no rule masks; the
performance page, the player's matches and the match ranking show a grade only from 20 minutes or when |z| ≥ 1. A
7-minute and a 1-minute cameo show 54 and 55 on the board and nothing elsewhere.

**E04l (c), reasons.** Nothing published tells, for one participation, a hidden grade from a missing grade, nor why
one is missing: the rows `assign_roles` leaves without a role and the rows the read refuses are kept nowhere.

### 38.1 Rules

- The read of an award year keeps the match's two sides only: a statistics row whose team is not one of the match's
  two teams is not graded; the run records it (`agg.player_grade_exclusions`, reason `team_not_in_match`) and
  publishes every other grade of the year. A player-match without a role after `assign_roles` is recorded the same
  way (`role_undetermined`). The exclusions of an award year are replaced with its run, in its transaction.
- Every reader of a match grade applies one rule, the performance page's: a grade is shown when `minutes >= 20` or
  `|z| >= 1`, else it is `null`. The board's `Vega grade` keeps its field and its form; a hidden grade is `null`
  there too. The match ranking's order and ranks are unchanged.
- `api.player_grade_status` (migration 155) gives, for every participation key (edition season, match, player) of
  the statistics or the line-ups, its award year and one status, the first that applies:
  `graded`, `below_display_threshold` (a grade exists, the rule above hides it), `competition_not_admitted` (an
  archive or cup edition: `PLAYER_MATCHES` reads neither), `match_not_finished`, `no_statistics` (no statistics row,
  the match's player statistics not collected), `not_played` (no row while the match's statistics are, or 0 minutes),
  `no_minutes` (a row without minutes), `team_not_in_match`, `outside_award_window` (no date, or an edition the award
  year does not read), the run's recorded reason (`role_undetermined`), `missing_inputs` (a role, no contribution),
  `no_reference` (a contribution, no reference for the role), `award_year_not_computed` (no published players run for
  the award year: award year 2020 today), `pending` (the statistics row changed after the year's last published run),
  `unrecorded` (read by that run, ungraded, and no reason recorded: a run before 155 recorded none, so the 615 rows
  without a role of the years ranked before the deployment say `unrecorded` until their year runs again). The
  performance read returns it as `gradeStatus` beside `row` (additive). A zero is a grade (`graded`), never a status.

### 38.2 Failure modes and expected outcomes

| # | Situation | Expected | On 2088d36e60 |
|---|---|---|---|
| 38a | The ordinary daily pass (`due_seasons`, `refresh_elo`, `refresh_daily(elo=False)`) on the two leagues | every positive-minute participation of award year 2020 graded; a second pass changes nothing | red: 0 of 682 graded, 2020 never due; **kept open: method decision** (test marked as an expected failure) |
| 38b | A third team's row with a position, both Elo sides present, then `refresh_players(2021)` | the run publishes; the row is in `agg.player_grade_exclusions` (`team_not_in_match`), not graded; every other row graded; a second run changes no grade | red: `UniqueViolation` 23505 on `player_power_matches_pkey`, the year's previous rows kept |
| 38c | A row without position, line-up slot, role history or keeper data | not graded, recorded `role_undetermined`; status `role_undetermined` | red: dropped silently, no trace |
| 38d | `api.player_grade_status` under `vega_read` over the base of 38a–38c plus a 0-minute row, a minutes-less row, a line-up-only player of an uncollected match, a cup edition's row | one row per key, each status above as stated; `graded`/`below_display_threshold` agree with the grade rule on every graded key | red: no such view |
| 38e | The board of the read API's seed match, one of its players made a 7-minute cameo with z = 0.3 | `Vega grade` absent (`null`) for him, the same values as before for the others; the match ranking and the performance page unchanged (no grade) | red: the board gives him 54.3 |
| 38f | `GET /api/performance` on a hidden, a graded and an ungraded appearance | `gradeStatus` `below_display_threshold`, `graded`, and the key's status; `row` unchanged | red: no field |
| 38g | 38c's row with its recorded reason removed and its statistics older than the run, then changed after it | `unrecorded`, then `pending` | red: no such view (written after 38a–38f, before the view's last two statuses) |

Recorded, not changed here: E04e (`PLAYER_MATCHES` reads no archive or cup edition, and no writer stores individual
statistics for one: only `store.py`, the PitchAPI path, writes `core.player_match_stats`); E04i (two native copies of
one match: `archives.merge_twins` handles archive `g:` twins only and `identity.duplicates` pairs a cup copy with a
PitchAPI match only; a guard for native copies belongs with the match identities); the player page's recent form
(`PlayerScoutOverview.jsx`: `seasonGrade([]).grade` is `null` and the card writes `?? 50`, a copy change that needs a
validated mock-up).

## 39. Identities: FC Barcelona's sides, administrative results, ranking spellings (19 Nov 2026, written before the tests)

Lot « identités » of the audit's resumption (E03b–E03f, E04b, E04g, E04i), on `main` 2088d36e60.

Reproduced on the public API at 13:22 UTC on 19 November: the six Copa del Rey 2024/25 matches of FC Barcelona
(`/api/cups/edition?competition=l_v0000071&season=2024/2025`) name `t_2fucJi`, Barcelona SC of Ecuador (707), as
FC Barcelona's side, and 707's club Elo of 2024/25 ends on the final of 26 April 2025. The cause is in
`curated.club_aliases`: the reviewed UEFA spelling « Barcelona » → « FC Barcelona » is written on every club named
« Barcelona », without a country, with `ON CONFLICT DO NOTHING`. FC Barcelona (740) already holds `fcbarcelona` as a UEFA
`source_spelling` (uefa.link_team writes `normalize(name)`), so only Barcelona SC gets the alias. The identity pass reads
aliases, not source spellings (`identity._pitch_teams`, `_pitch_clubs`): « FC Barcelona » of a national cup archive (no
country) and of a European archive (every club) names exactly one club, 707, and the merge moves the source's teams, their
keys (`openfootball:name:FC Barcelona`, `vega:archive:europe:fc barcelona`) and their matches onto it. A later import
resolves by those keys (`cups._team`, `archives.Loader.team`) and writes 707 again.

### 39.1 Rules

- A reviewed club spelling (`curated.CLUB_ALIASES`) whose name several clubs bear goes only to the club of the country
  reviewed for it (`CLUB_ALIAS_COUNTRIES`: « Barcelona » is Spain's); with no reviewed country nothing is written and
  nothing is removed: each club keeps what it holds, and the name is counted unmatched and logged for review
  (amended by the coordinator on 19 November, before the test 39l: production's homonyms among the 301 reviewed names
  are not measured, and taking an alias from a club that resolves by it would make the next cup import create a second
  club). It replaces a `source_spelling` of the same normalized form on that club (the alias is the stronger
  statement), and it is removed from the other clubs of that name that hold it.
- A reviewed side correction (`identity.SIDE_CORRECTIONS`) names: the club a side was given to and the club that played,
  each by its PitchAPI key; the provider keys that came with the merge; and each match, by its Vega id or its provider
  key, with its side, day, opponent, score and the source's name of the side. The identity pass applies it before any
  merge, under the collection role, whatever `identity.MERGES` says: the side, every core row of that match naming the
  wrong club (events, statistics, line-ups…), the keys, the pointers of the merged source teams named like the side,
  the source spellings of that name, and the edition memberships the wrong club holds only through these matches.
  The match keeps its id, its provider keys, its status, scores and everything hanging from it. Each moved side is
  recorded once in `core.team_side_corrections` (156: the collection role may only add to it).
- A correction is idempotent: a side already on the club that played is left and counted done. A match whose stored row
  differs from the reviewed preimage (another day, opponent, score or name, or a side on a third club) is held: nothing
  of it moves, the others go on. A correction whose clubs the base does not hold does nothing.
- Nothing else of the wrong club moves: its other matches, its keys, its names, its Elo before and after.
- The Open Matchday restoration (`open_matchday_restore.py`) counts `core.team_side_corrections` among the match
  dependencies created after its captures (checked empty for its 35 ids) and accepts 156 as its reviewed latest schema.
- The Elo is not rewritten by the correction. The next daily Elo (`power.refresh_elo`, run once per pass when any season
  is due, i.e. every UTC day) reads the corrected sides.
- A result a federation decided without the match being played (forfeit, administrative qualification) keeps its stored
  status and score (the table, the cup's page), and is never a played match for the Elo, hence for the forecasts fitted
  on Elo (`forecast.FITTED` joins `agg.team_elo`). Its source says so (`awarded`, kept out by `status = 'finished'`), or a
  reviewed decision names its provider key and its authority (`power.ADMINISTRATIVE`). No rule is drawn from a score.
- A SportScore spelling (`source_spelling`, source `sportscore`) is evidence for SportScore's table of the edition it was
  read in. It names no club for UEFA's linking (`uefa._candidates`, `reconcile_teams`), whose clubs are identified by
  country and their own spellings; the identity pass already ignores every source spelling.

### 39.2 Failure modes and expected outcomes

| # | Situation | Expected | Before the corrections |
|---|---|---|---|
| 39a | `club_aliases` on two clubs named « Barcelona » (ECU, ESP), the Spanish one holding `fcbarcelona` as a UEFA source spelling | the alias on 740 only (kind `alias`), none on 707 | red: alias on 707, 740 keeps a source spelling |
| 39b | A fresh base: club_aliases, a Copa del Rey 2024/25 OpenFootball edition naming « FC Barcelona », a European archive team « FC Barcelona », then the identity pass (vega_collect) | both source teams merge into 740; their matches and keys are 740's; 707 keeps its LigaPro and Libertadores matches | red: both merge into 707 |
| 39c | A base in production's state (15 sides, 2 keys, 2 pointers and the alias on 707; events and statistics on two of the matches), identity pass | 15 sides, their events/statistics, both keys, both pointers on 740; alias gone from 707; 15 rows in `core.team_side_corrections`; 707's own matches, keys and names unchanged; match ids, provider keys and scores unchanged | red: nothing moves |
| 39d | The pass again | nothing changes; still 15 records | red (39c) |
| 39e | The Copa del Rey edition read again, and `Loader.team('FC Barcelona', 'Europe')` | same match ids, sides on 740, no new team | red: 707 |
| 39f | One match's stored score differs from the preimage | that match held (still on 707, not recorded), the 14 others moved | red (39c) |
| 39g | The Elo's admitted rows after the pass | the six cup matches admitted with 740 against the same opponents; the nine archive matches not admitted (archive editions); 707's league match unchanged | red: 707 |
| 39h | Tours–Lorient stored `finished` 0–3 under its reviewed key (production on 19 Nov), and stored `awarded` 0–3 | not an Elo match in either state; the cup read keeps 0–3 | red for `finished`: admitted |
| 39i | Seraing U21–Beerschot U21 (open-matchday, 0–5, forfeit: voetbalvlaanderen match 7631244), stored `finished` | kept `finished` 0–5 and counted by `core.table_results`; not an Elo match | red: admitted |
| 39j | A UEFA row « Andorra CF » (ESP) while FC Andorra (845) holds « Andorra CF » as a SportScore spelling | a new UEFA team: 845 is not linked | red: linked to 845 |
| 39k | SportScore's own linking of a table naming « Andorra CF » in FC Andorra's edition, and the 838 spellings of the 18 November register in their editions | linked as before | green on arrival (no change there) |
| 39l | `club_aliases` on two clubs named « Inter » (ITA, FIN), a reviewed name with no reviewed country, the Italian one holding the alias « Internazionale Milano » | nothing written, nothing removed: the Italian club keeps its alias, the Finnish one gets none; one name unmatched; the pass again changes nothing | red on the lane's first rule: the alias is removed from the Italian club |

Recorded, not corrected here:
- 33 CONCACAF Champions League 2008/09 matches stored in edition 3333 (`g:champions-league`, « Ligue des champions »,
  Europe), still served so on 19 Nov (`/api/read/archive?season=2008/2009&competition=g:champions-league`). The worldclub
  goals file names the CONCACAF competition with UEFA's slug. `archives.QUARANTINE` (main) holds the 33 keys: never
  rewritten, never removed. Their move needs a reviewed CONCACAF edition, archive plan territory (VI-27).
- J1 (`l_2ApGa4`) and the Saudi women's league (`l_1SGwQT`) are out of scope (`scope.REMOVED`).

## 40. The writers still active: repetition, partial answers, authority (audit E02c, E02d, E03h; 19 Nov 2026, written before the tests)

The audit asks for guarantees on every writer still active, not only on those already corrected (VI-27/29/31). The
inventory and the matrix of guarantees (writer × domain × repetition, partial answer, authority, explicit
correction, traced refusal, real role) are kept with the evidence of this lot
(`evidence/writers/MATRICE.md`). This section specifies the end-to-end replays written for the cells the existing
suites left without a test. They change no writer: a replay that fails on `2088d36e60` is a defect, kept as
`unittest.expectedFailure` with the defect named, so the suites stay green and the defect visible. The replays live
in `backend/tests/test_writer_replays.py` (database `vega_v2_writer_replays_test`).

### 40.1 Rules of the replays

- Each replay calls the real writer through its real entry point: `transfermarkt.Reader.read` (fetch → `data_of` →
  `write_*` → queue row) or `sources.run_due` (prepare → run → `record_run`), on a connection under `vega_collect`.
  Only the provider is replaced (a fake `fetch`, `get`, Wikidata bridge or honours collector), with synthetic
  answers; nothing is downloaded.
- State is compared by a fingerprint: every row of the tables the writer writes, as JSON, sorted, without
  `updated_at` (and without the surrogate `id` of `core.player_injuries`, which nothing references). Bookkeeping
  (`ops.source_runs`, `ops.transfermarkt_reads`, `ops.transfermarkt_state`) is checked separately.
- "Kept" means the fingerprint of the domain rows is the one before the answer. "Traced" means an `ops.*` row names
  the refusal (`ops.source_runs.error_code`, `ops.transfermarkt_reads.error_code`, `ops.parse_failures`) and the
  scope or unit is due again within its retry delay.

### 40.2 Failure modes and expected outcomes

| # | Writer, domain | Situation | Expected |
|---|---|---|---|
| 40a | Transfermarkt values (`write_values`) | the same history (two points) read twice | the second read changes no row of `core.player_market_values` |
| 40b | Transfermarkt values | `{"history": []}` after two accepted points | both points kept |
| 40c | Transfermarkt values | a valid history that omits one of the two accepted points | both points kept (an omission is not a deletion), or the read refused and traced |
| 40d | Transfermarkt values | `history` of the wrong type | both points kept; the unit carries `SCHEMA_CHANGED` and is due again within a day |
| 40e | Transfermarkt injuries (`write_injuries`) | the same two episodes read twice | the second read changes no episode (content; the ids are recorded in the evidence) |
| 40f | Transfermarkt injuries | `{"injuries": []}` after two accepted episodes | both episodes kept, or the read refused and traced |
| 40g | Transfermarkt injuries | a valid list that omits one of the two episodes | both episodes kept, or the read refused and traced |
| 40h | Transfermarkt injuries | `injuries` of the wrong type after an accepted read | episodes kept; `api.player_injury_reads` under `vega_read` still names the player (the last accepted read), so the route does not turn a refusal into a 404 |
| 40i | Transfermarkt squads (`write_squad`) | the same squad (two members) read twice | no change in `core.provider_squads` |
| 40j | Transfermarkt squads | `{"squad": []}` after two accepted members | both members kept, or the read refused and traced |
| 40k | Transfermarkt squads | a valid squad without one of the two members | both members kept, or the read refused and traced |
| 40l | Transfermarkt clubs (`write_club`) | the same club record read twice | no change in `core.provider_clubs` |
| 40m | UEFA coefficients (`uefa.save`) | the same complete pages read twice | the edition's rows unchanged (`core.ranking_rows`, `core.ranking_season_points`, `core.ranking_editions`) |
| 40x | UEFA coefficients | the same complete pages read twice (40m) | the edition's resource version (`ops.resource_versions`, kind `ranking`) unchanged: a repeat publishes nothing new and recalculates no cohort |
| 40n | UEFA coefficients | a page with `totalElements: 0` and no member after a stored edition of two clubs | the two rows kept; the scope fails and is traced |
| 40o | FIFA ranking (`fifa.save`) | an edition first read with one row of three, then complete at the source | the complete edition replaces it (or the short one is refused and read again) |
| 40p | Wikipedia honours (`honours.save`) | the same honours read twice | no change in `core.player_honour_titles` |
| 40q | Wikipedia honours | after two titles, the collector gives nothing (identity not unique, no Honours section, no row parsed: `collect_player` returns `None`) | both titles kept; the player is checked again after the period |
| 40r | Wikidata clubs (`wikidata.save_club`) | the same club answer read twice | team, venue and coach tenure unchanged |
| 40s | Wikidata clubs | an answer without `founded` and without `coach` (a partial answer of the bridge: it cannot be told from a removal) | the founded year kept; the current coach's tenure stays open |
| 40t | Wikidata stadiums (`wikidata.save_stadium`) | an answer without capacity and coordinates | capacity and coordinates kept |
| 40u | Wikidata player facts (`player_facts.save`) | the same club answer read twice | no player changed |
| 40v | Wikidata player facts | an empty `bindings` list | birth dates and heights kept |
| 40y | Native PitchAPI (`Store.save_references`, `save_matches`, `save_family`) under `vega_collect` | the same league, match summary and player statistics written twice | the second pass changes no row of the match, its statistics, teams, players or provider ids, and the match revision stays |
| 40z | Native PitchAPI under `vega_collect` | the summary corrected at the source (score 1–0 → 2–0), then the statistics corrected (1 goal → 2) | each correction is written once and raises the revision once |
| 40w | Wikidata player facts against the Transfermarkt snapshot | a player whose birth date the snapshot attested (`birth_date_source_url`), Wikidata giving another plausible date | the attested date and its provenance stay together: either kept, or replaced with Wikidata's provenance; never Wikidata's date under the snapshot's URL |

Out of these replays, by the existing suites (cited in the matrix): the native PitchAPI families (`test_store`,
`test_worker`), the cup and Open Matchday snapshots (19a–19w, 22a–22c, 35m–35s), SportScore (S1–S25, 35t, 35v),
the Transfermarkt transfers and contracts (§20, §33, 35w–35z), the archives and their corrections (§22–§24, 35a–35h),
Fjelstul and football-data.co.uk (pinned files), the scope purge and the twin merge (a second pass removes nothing).
The native statistics' empty answer is the « collecte » lot's (VI-21) and is not replayed here.

## 41. Open Matchday's sliding window: left-edge exits, results published then dropped, the 35, the score of 8625 (19 Nov 2026, written before the tests)

Reproduced on `d3e96a097b` (main `2088d36e60` and the collection lot) before any change, on PostgreSQL 18.6 by the real
writer (`sources.run_due`) under `vega_collect`, with consecutive real versions of the source's results files (Git
history of `oladeeayo/open-matchday`, `evidence/historique/rouge/gel-*.json`):

- the export is a sliding window: the results file of the season keeps the recent dates only. Over 125 versions of
  eight folders, every result a version drops leaves by its left edge (dated before the version's first result),
  but six: a moved or replaced result (Kleczew–Podhale 31 Jul → 1 Aug, Emley–Bamber Bridge 6 Oct → 3 Nov, Livyi
  Bereg–Bukovyna 1 → 14 Nov), Ashton United–Warrington Rylands of 31 Oct (played 1–2 according to the organizer, then
  dropped), Weston-super-Mare–Billericay of 24 Oct (absent from the organizer's results) and FC Kharkiv–Karpaty of
  7 Nov (`evidence/historique/fenetres.json`);
- in a folder without an attestation (`open_matchday_history.for_edition` empty: Poland I and II Liga, Cymru
  Premier, the FA Cup and every other folder but the three English ones), a version that drops a stored result by
  its left edge is refused (`SNAPSHOT_DROPS_RESULT`), and so is every later version: the edition is frozen. Poland I
  Liga 06b3cf48 → 772fb543 (9 dropped), Poland II Liga 77e35fdb → 3a3ac507 (8), Cymru Premier fd27c060 → 772fb543
  (14), FA Cup 55a7b8e0 → 772fb543 (78): each keeps its old results, never writes the new ones, and adds an
  `ops.parse_failures` row at each read. Production serves today exactly the latest file of each (its guard reached
  production on 18–19 Nov, after their last slide): the next slide freezes them;
- the three English folders keep a dropped result only under `rolling_prefix`'s conditions (at least 50 overlapping
  results and half the declared rows, four dates, identical scores, dates in 2026/27); a score corrected inside the
  window while results leave refuses the version, and since the stored score never changes, every later one;
- nothing creates a result the base never stored: 236 English results (201 never stored, the 35 removed on 18 Nov)
  and 158 others (Poland 20 + 36, Wales 22, FA Cup qualifying rounds 80) were published by the source and are absent;
- a live line contradicting an attested final (`final_score`) refuses the whole version: with 8625's organizer final
  (Ashton United–Warrington Town 0–1, the source 1–2) attested, the NPL edition would be frozen.

### 41.1 Rules

- **A left-edge exit is neither a deletion nor a refusal.** Let *start* be the earliest day of the version's results.
  When the results file holds exactly its declared rows (`read_files`), every stored finished result of the edition
  dated on or after *start* (an attested one aside) is in the version as a result, at least one stored result is in
  it, and no result leaving has its two sides, in the same order, arriving in the version under another key within 31
  days (a moved result, not a slide), the stored results absent from the version and dated before *start* stay as
  stored (no write, no removal) and the version is written. Otherwise the guard is unchanged (`SNAPSHOT_DROPS_RESULT`):
  a result missing inside the window, a result missing on the first day, a version that shares no stored result. A
  score corrected inside the window is a correction (§19), with or without an exit. In the three English editions
  `retained`'s identity checks still apply to the kept results. This replaces `rolling_prefix`'s minimum of
  corroborating observations: the rule deletes nothing either way, and that minimum only decided whether a complete
  version was written or the edition frozen.
- **Attested results** (`backend/vega/sources/data/open_matchday_published.json`, its SHA-256 pinned in
  `open_matchday_history.py` like the 35-result ledger, rebuilt by `evidence/historique/scripts/attestations.py` from
  the Git history and the organizer capsule `angleterre-575.zip`). Each result: its provider key (the live key's
  format, `folder:season:date|home|away`), its score, its round when the source gave one, the commit of the version
  that last published it, and for the English ones the organizer's match id, page and capture digest. Kept, non-COVERED
  folders only. Excluded: a result whose score varies across versions, one a later version moved (same sides, same
  order, another day within 31 days) or renamed (another result of its day with one of its sides), one of the 35,
  an English one the organizer does not confirm (day, sides, score), another folder's one that left from inside the
  window. 8625's organizer final is attested with the source's contradicting score and commit.
- **Creation.** In a written version, each attested result of the edition that the base does not hold is created
  once, after the version's rows: not one of the 35 (`id_at_incident`), not in the version, no `open_matchday` match
  key equal to it anywhere (current or retired), no match of any edition on its day between its two teams (either
  orientation, teams resolved as the version's names are), and, without an organizer proof, dated before *start*.
  Teams by the same resolver as the version's rows (`cups._team`), its round when given, status finished, its score,
  no half-time and no statistics, the next free position. A result not created for another reason than being one of
  the 35 is recorded once (`ATTESTED_RESULT_NOT_CREATED`, `sources.failure_once`). An attested result the base holds
  and the version omits stays as stored, wherever its day. The Elo wakes through `worker.elo_due` (§37): the created
  match was written after the last run.
- **The 35** stay to `open_matchday_restore`: creation skips them while they are absent; one of them in a version
  while absent still refuses it (`ATTESTED_HISTORY_RESTORE_REQUIRED`). Restored, they are attested results the base
  holds: kept, never duplicated.
- **An organizer final prevails over the source's line, for that match only.** A live result whose score contradicts
  an attested final with an organizer proof is written with the attested score (a stored different score is corrected,
  `revision + 1`, same id), the rest of the version is written, and one `ATTESTED_FINAL_KEPT` row records the
  contradiction while it stays the same. An attestation from the source alone that a live line contradicts, and an
  attested final listed as a fixture, still refuse the version (`ATTESTED_HISTORY_CONFLICT`).

### 41.2 Failure modes and expected outcomes

| # | Situation | Expected | Before the corrections |
|---|---|---|---|
| 41a | Poland I Liga 06b3cf48 then 772fb543 (9 leave by the left edge, 9 new), real writer under `vega_collect` | the 9 kept (same id, revision, `updated_at`), the 9 new written: 115 finished; no failure row; the next read writes nothing | red: `SNAPSHOT_DROPS_RESULT` at each read, 106 kept, the 9 new never written |
| 41b | Cymru Premier fd27c060 → 772fb543 (14), FA Cup 55a7b8e0 → 772fb543 (78), Poland II Liga 77e35fdb → 3a3ac507 (8) | accepted the same way | red: frozen |
| 41c | Poland II Liga 3272e1f9 → b90bce70: Kleczew–Podhale moved from 31 Jul (inside the window) to 1 Aug | refused, edition unchanged | green (unchanged) |
| 41d | A stored result of the version's first day missing; a stored result after it missing | refused | green (unchanged) |
| 41e | A version sharing no stored result (all of them before its first day) | refused | green |
| 41f | A result leaving by the left edge whose two sides arrive under another key 3 days later | refused | green |
| 41g | A score corrected inside the window while results leave (attested English folder, and another) | written: the correction with `revision + 1`, the left results kept | red: refused |
| 41h | The three English files of 18 Nov (13a43495) on an empty base | 339 written and 201 created: 540; each created result's teams are those of its names; 8625 written 0–1 | red: 339, 8625 1–2 |
| 41i | The same files read again | nothing written: no revision, `updated_at` or `cup_updated_at` change, no new failure row | — |
| 41j | Poland I, Poland II, Wales, FA Cup latest files on an empty base | 106 + 20, 105 + 36, 105 + 22, 142 + 80 | red: no creation |
| 41k | An attested result whose key another edition holds, or retired; one whose day and teams another match has | not created; `ATTESTED_RESULT_NOT_CREATED` once; nothing else changes | — |
| 41l | A source-attested result dated on or after the version's first day | not created | — |
| 41m | The 35 absent, the English files | none created; with one of them in the version: refused `ATTESTED_HISTORY_RESTORE_REQUIRED` | green (unchanged) |
| 41n | The base after 41h, then `open_matchday_restore` with the reviewed captures (dry run, apply), then two passes | restore 35 with their ids (no collision); next pass keeps them: 575, no duplicate; the pass after writes nothing | — |
| 41o | `Worker.daily`: a pass whose only change is the creation of attested results | the Elo runs once in that pass and covers their sides; the next pass runs none | — |
| 41p | 8625 stored 1–2, version still 1–2, organizer 0–1 attested | 8625 becomes 0–1 (`revision + 1`, same id), the rest written, one `ATTESTED_FINAL_KEPT`; read again: nothing, no new row | red: `ATTESTED_HISTORY_CONFLICT`, version refused |
| 41q | A source-attested final contradicted by a live line; an attested final listed as a fixture | refused `ATTESTED_HISTORY_CONFLICT` | green (unchanged) |
| 41r | A byte of either attestation file changed | import refused (pinned SHA-256) | green for the ledger |

**Existing expectations adjusted.** `test_source_snapshots.OpenMatchdayGuardTest` and `test_collection_wakeups.EloWakeTest`
name real folders (National League North, Cymru Premier) with built or capsule rows and count the matches written: the
results attested for those folders would now be created beside them (22 in Cymru Premier, 59 in the North). Both
classes keep the 35-result ledger alone; no assertion changes. 41o tests the Elo wake after a creation.

## 43. A league table mixed from three phases, a World Cup listed twice on the nation pages, a native match stored twice (audit E02c, E03f, E04d, E04i; 19 Nov 2026, written before the tests)

Lot « classements », branch `claude/audit-classements` from `74970d7fe3` (main `2088d36e60` and six lots). Migration
159 is additive (functions and views); no published migration changes; no row is deleted or rewritten by it.

### 43.1 Veikkausliiga 2026: three phase tables served as one (E02c)

**What production serves (19 Nov, lot « production »).** `GET /api/standings?competition=l_3Ci5Cg`: one table of 12
rows, `source` SportScore, `fetchedAt` 2026-11-19T09:01:50.914Z (before the 10:05 UTC deployment), positions
1,1,1,2,2,3,4,4,4,5,6,6, clubs at 32, 27 or 22 matches; ΣW 123 ≠ ΣL 114.

**Why.** SportScore's widget (`?sport=football&slug=finnish-veikkausliiga`, captured 19 Nov 17:26 UTC) answers three
tables, each with `"group": ""`: the regular season (12 clubs, 22 matches, ranks 1–12), the championship group (6
clubs, 32 matches, ranks 1–6) and the relegation group (6 clubs, 27 matches, ranks 1–6). The writer deployed before
10:05 (main `21b6fa74f2`, `sportscore.py` of `dc65d69`) stored every row under group NULL (`len(tables) > 1` keeps the
group, but `""` reads None), sorted by (group, team, position, …), and inserted with `ON CONFLICT DO NOTHING`: each
club kept its row of lowest rank. KuPS (1st of the regular season, 3rd of the championship group) kept its 22-match
row, Inter Turku (2nd, 1st) its 32-match row, Lahti (7th, 1st) its 27-match row — exactly the 12 rows served. The
rows have no basis (written before 138's column). Since the deployment the writer refuses the answer
(`check`: `DUPLICATE_GROUP`, three tables named None) and keeps the stored rows; migration 150's view still serves
them because nothing in it reads the ranks.

**Rules.**
- A response's tables are refused when two or more of them carry no name: the source does not tell its phases apart,
  and Vega does not name them by position or by count. Code `DUPLICATE_GROUP` (unchanged), its detail naming « N
  tables without a name ». The accepted table keeps its rows, its date and its ETag; the scope is tried again at the
  content cadence. Distinct named tables are published as today (one table per group).
- The rank invariant the writer applies (`check`) is now also applied when the table is read: within one stored
  table of an edition (SportScore's rows, no stage, one `group_name`), two clubs sharing a rank have equal points,
  and a table that is the edition's only table holds all its ranks (its highest rank is at most its number of rows).
  Shared ranks of equal points stay admissible: the writer has admitted them since VI-29 (cases S11, S34 of
  FAILURE_MODES_SPORTSCORE.md; « 1…n without repetition » is read as « no rank shared between clubs of different
  points »). No played-count rule is added: a split league's official single table (ranks 1–6 at 32 matches, 7–12 at
  27) is one phase-consistent table.
- An edition whose stored SportScore rows break it is withheld (`api.standings_rank_conflicts()`): its official rows
  are not the authority, so `api.standings` serves Vega's own table of the edition when one exists (as for an edition
  without an official table), and nothing otherwise. The edition stays the one `/api/standings` selects (it is listed
  by `api.standings_withheld()`, with J1's exclusion of 147/150): a withheld current edition answers 404 « Donnée
  indisponible. », never the previous season's table. Rows that satisfy the invariant again (a later accepted
  response replaces them) are served again: the rule reads the content, not an edition.
- 159 raises the resource version of each edition it withholds, once, as 150 did for J1.

**Failure modes and expected outcomes.**

| # | Situation | Expected | On `74970d7fe3` |
|---|---|---|---|
| 43a | The captured widget answer, through `sources.run_due` under `vega_collect`, over the stored rows | refused `DUPLICATE_GROUP`, detail « 3 tables without a name »; stored rows, `as_of` and version unchanged; one `ops.parse_failures` row | refused `DUPLICATE_GROUP` (« two tables named None »): green on arrival but for the detail |
| 43b | The 12 stored rows of production (no basis, `as_of` 09:01:50.914Z), no Vega table; `GET /api/standings?competition=l_3Ci5Cg` and `&season=2026` under `vega_read`, a 2025 edition with its own table present | 404 both, not the 2025 table | red expected: 200, the mixed table |
| 43c | The same with Vega's table of the edition (`agg.standings`) | 200, `source` « Vega », Vega's rows | red expected: the SportScore rows |
| 43d | The same rows re-ranked 1–12 (an admissible table) | 200, SportScore, served as stored | green |
| 43e | A shared rank of equal points (S34's table), a multi-table edition whose groups each start at 1 (World Cup groups, USL's two conferences) | served | green |
| 43f | Two clubs at the same rank with different points inside one group of a multi-table edition | withheld | red expected |
| 43g | The edition's only table ranks 1–11 and 13 (12 rows) | withheld | red expected |
| 43h | 159 applied over a base holding 43b's rows | the withheld edition's resource version raised once, the previous edition's unchanged | red expected: no 159 |
| 43i | The 47 SportScore answers of `/api/standings` read in production on 19 Nov (`evidence/prod/raw/standings-*-1.body`), replayed through `check` (as widget tables) and through `api.standings_rank_conflicts()` (as stored rows) | 46 admitted by both; Veikkausliiga refused (`DUPLICATE_POSITION` as one stored table) and withheld | — |

Not covered: whether production's `agg.standings` holds a Vega table for this edition (no public read shows it).
If it does, the route serves it after deployment; if not, 404 until SportScore answers an admissible table. Naming
SportScore's unnamed phases (« saison régulière », « groupe championnat ») would need a source that names them.

### 43.2 The World Cup 2026 twice on the nation pages (E03f, E04d)

**What production serves (19 Nov).** `GET /api/nations/t_0WmIZB?season=…` (Argentina): 11 World Cup 2026 matches for
8: three copies dated the day before (06-16, 06-27, 07-11), `competition` « World Cup 1930 », `edition`
`open-cups:world-cup-history:2026`. Mexico: 9 for 5. France, Ivory Coast and Qatar: their copies share the native
day. Every archive match of the family reads « World Cup 1930 » (Argentina: 84, France: 66), the Euro's « Euro
2021 », International Results' « Copa América 2024 » and « Coupe d'Afrique des nations 2021 ».

**Why.** `api.nation_matches` (120) keeps one copy per (day, pair of teams): OpenFootball dates a match on its local
day, PitchAPI on the UTC day of its kick-off, and an evening match in the Americas is one day earlier in the archive.
The label is `core.competitions.name` of the edition's competition; `cups.save` creates the family's competition once,
named after the body of the first edition it imports (`name = body.get("name")`: « World Cup 1930 »). The edition's
own name is `core.competition_seasons.cup_name` (« World Cup 2026 »).

**Rules.**
- Two copies of one match: the same two teams (the merged identities, as the function reads them), the same score
  by team (two unscored copies agree), days at most one apart, in two different editions. Only one is listed: the
  native copy first (no cup key, no archive key), then a scored one, then the lowest id. Copies of one day stay
  merged as before (whatever their edition or score).
- Kept distinct: the same teams one day apart in the same edition, or with a different score, or two days apart.
- The kept copy takes the round and the penalties from the copies it absorbs when it has none (as 120 does for a
  copy of the same day).
- A match's `competition` is its edition's name when the edition has one (`cup_name`), else its competition's:
  « World Cup 2026 » for the 2026 archive, « World Cup 1978 » for 1978; a native edition keeps « World Cup ».
- Nothing changes in the base: the read only.

**Failure modes and expected outcomes** (`GET /api/nations/{id}?season=2025/2026` under `vega_read`).

| # | Situation | Expected | On `74970d7fe3` |
|---|---|---|---|
| 43k | A native match and its archive copy dated the day before, same score, other edition | one match, the native one (`id` present, native round) | red expected: both |
| 43l | The same with another score in the copy | both | green |
| 43m | Two matches one day apart, same score, same edition | both | green |
| 43n | Two copies on the same day | one (120 unchanged) | green |
| 43o | An archive match no native copy holds | listed, `competition` « World Cup 2026 » (its edition's name) | red expected: « World Cup 1930 » |
| 43p | A copy two days apart | both | green |
| 43q | The native copy without penalties, the copy of the day before with them | one match, the copy's penalties | red expected |
| 43r | Argentina's World Cup 2026 as production holds it (8 native, 3 copies J−1, 5 copies the same day) | 8 matches; one run « Coupe du monde 2026 » of 8 games | red expected: 11 |

### 43.3 Lanús–Estudiantes stored twice as a native match (E03f, E04i): specification, not code

**What production serves (19 Nov, 17:30 UTC, `evidence/classements/raw/lanus/`).** Two matches of Liga Profesional
2026 (`l_45VZuL`), both PitchAPI keys, both finished 2–1 at 2026-09-22T00:15Z, Lanús (`t_0rsFNq`) – Estudiantes
(`t_1HsET8`): `m_0Feldm` and `m_1bi3Az` (RDS ids 40022 and 40023 per the audit's `sql/controles/lanus.sql`; the
public reads do not show which id is which). Each serves its line-ups (2 × 11 starters, 2 × 12 substitutes, the same
players), 17 events, team statistics, player statistics and 32 grades: 64 grades for 32 appearances, and the match
twice in the lists and in the Elo.

| | `m_0Feldm` | `m_1bi3Az` |
|---|---|---|
| round | « Clausura - Round 10 », the name the other 9 round-10 matches carry | « 10 » |
| referee, stadium | Nicolás Ramírez, Estadio Ciudad de Lanús | no referee, stadium |
| player statistics | 46 rows (one with `goals_prevented`) | 45 rows |
| events, line-ups, grades | 17, 46 players, 32 | 17 (one `minute_added` 6 for 5), 46 players (two starters' order swapped), 32 |
| team statistics | the same families | three period values differ (0 against 2, 0 against 1) |

**Canonical: `m_0Feldm`.** It is the more complete copy (referee, one more player-statistics row), and it carries the
league's round naming. The organiser publishes one match (« Fecha 10 », 21 Sep 21:15 local: the audit's
`INTEGRITE.md`). Not verified: which copy PitchAPI serves today (no provider call is permitted to this lot). The other
round-10 fixtures of the edition have a twin too, `postponed`, without a round and without a score (`m_14LPSW`,
`m_0jdOYm`, …): the provider's superseded copies, which `m_1bi3Az` resembles by its key, round and missing referee.

**Correction (specified, not written).** A reviewed list, `identity.MATCH_TWINS = {"lanus-estudiantes-2026-09-22":
{"keep": "m_0Feldm", "drop": "m_1bi3Az", "proof": …}}`, on the model of `SIDE_CORRECTIONS` and
`core.team_side_corrections` (156):
- Preimage, both rows `FOR UPDATE`: edition of `l_45VZuL` 2026, `pitchapi` current keys `m_0Feldm` and `m_1bi3Az`,
  status `finished`, kick-off 2026-09-22 00:15Z, home `t_0rsFNq`, away `t_1HsET8`, score 2–1. Any difference: the pair
  is held (nothing written, a line printed), as a held side correction.
- Effect: one row in a new journal `core.match_twin_corrections(match_id, canonical_id, correction, proof_sha256,
  applied_at)` (additive migration, the collection role may insert, nobody may update or delete), nothing else
  written. Every reader of a match skips a journaled `match_id`: the Elo (`power.ELO_MATCHES`, next to
  `ADMINISTRATIVE`), the grades (`agg.player_match_grades` and the board), the lists (`api.fixtures` and the views
  over `core.matches`: league fixtures, club and player pages, `api.nation_matches`), `core.table_results` and
  `agg.standings`. Its rows, keys, statistics, events, line-ups and grades stay stored; its public id answers 404
  (or a redirect to the canonical id, a site decision).
- Idempotent: a second pass finds the journal row and writes nothing. A PitchAPI refresh of the dropped key writes
  the row as before; the journal keeps it unread.
- Why no code here: the readers to change are outside this lot's write scope (`power.py`, the grades, `api.fixtures`
  and the club and player views); the correction cannot be bounded to the pair and tested end to end from
  `identity.py` alone. A deletion of the match is excluded (user decision required).
- Preimage to read before writing the entry (read-only, as the schema owner; the audit's `sql/controles/lanus.sql`
  and `lanus-appearances.sql` count the dependents):
  `SELECT k.provider_key, m.id, m.season_id, m.competition_season_id, m.status, m.kickoff_at, m.home_team_id,
  m.away_team_id, m.home_score, m.away_score, r.name FROM core.provider_ids k JOIN core.matches m ON m.id = k.entity_id
  LEFT JOIN core.rounds r ON r.id = m.round_id WHERE k.entity_type = 'match' AND k.provider = 'pitchapi' AND k.is_current
  AND k.provider_key IN ('m_0Feldm', 'm_1bi3Az')`. Expected: two rows, one edition, `finished`, 2026-09-22 00:15Z, the
  same two teams, 2–1, rounds « Clausura - Round 10 » and « 10 »; the entry binds the keys, never the ids.
- The audit counts five finished/finished PitchAPI pairs (`INTEGRITE.md`; another is Estudiantes de Río Cuarto–
  Instituto, 39992/39993) and 46 finished/postponed pairs: each needs its own reviewed entry, never a rule.

### 43.4 What 159 costs: the reads stay as fast as before (second review, 19 Nov 2026, written before the change)

The second independent review (`evidence/relecture-2/CONSTATS.md`, base `relecture_b_159`: 530 500 matches, 50 500
of national teams, 30 000 SportScore rows over 1 500 editions) measured 159 right but slower, under `vega_read` with
`db.mjs`'s session settings and bound parameters: `api.nation_list` 217 → 710 ms (production-like volume) and 499 →
2 777 ms (whole base); `/api/standings` 41–47 → 186–193 ms; `api.nation_matches` 5.8 → 34 ms, 26 → 653 ms for a
nation of 416 copies. Causes: `nation_list` read `core.matches` a third time only to fetch columns its two branches
had, and its anti-join on `abs(k.d - g.d) = 1` cannot hash, so it compares every pair of meetings of two teams;
`api.standings_rank_conflicts()`, a SECURITY DEFINER function with no argument, aggregates every SportScore row of
every edition at each call, and `standingsBody` calls it three times; `nation_matches`' lateral join re-reads its
materialized CTEs once per kept match.

**Properties.**
- 43s. `api.nation_list`: at most 1.5 times its pre-159 time (119) on both volumes; `core.matches` is read twice
  (its two branches, as in 119), never a third time; the copy test is a hash join on equal keys (pair, day ± 1,
  score), not a join filter on `abs()`.
- 43t. `/api/standings`: the rank check reads only the editions the statement selects. No function aggregates the
  whole table; the withheld editions are read per edition (`api.standings_withheld(edition)`); on the review's base,
  under `enable_seqscan = off`, every scan of `core.standings_official` in the route's statement (custom and generic
  plans) has an index condition on `competition_season_id`. On the small test base the planner may check the Vega
  branch's authority once over the whole table, as it did with 150: the test requires no more such scans than with
  150's view. Time: at most 1.5 times 150's on the measurement base; `/api/cup-snapshot?kind=standings` (the same
  statement) and the worker's `count(*) FROM api.standings` likewise.
- 43u. `api.nation_matches`: linear in the nation's copies: no node re-executed once per kept match over a
  materialized CTE; at most 1.5 times 120's time on both volumes.
- The semantics of 43a–43r are unchanged (same tests, same expectations), the 46 SportScore tables stay admitted.

**Result** (medians of five runs, ms, `evidence/classements/perf/summary.md`; « small »: the review's production-like
volume, the International Results archive removed):

| Read | 119/120/150, full | first 159, full | 159 now, full | before, small | first 159, small | 159 now, small |
|---|---|---|---|---|---|---|
| `/api/standings` statement, three leagues | 37–42 | 128–160 | 31–50 | 21–36 | 67–86 | 20–36 |
| idem, generic plan | 38 | 128 | 30 | 19 | 139 | 31 |
| `api.nation_list` | 440 | 2 671 | 598 | 169 | 395 | 242 |
| `api.nation_matches(100001)` | 25 | 649 | 27 | 6.2 | 23 | 5.6 |
| `count(*) FROM api.standings` | 4 032 | 3 880 | 4 034 | 1 837 | 2 128 | 2 590 |

What changed: the rank check is written inside `api.standings` as windows partitioned by edition (a condition on the
edition reaches the scan), `unqualified` reads its edition's rows directly, `api.standings_withheld(edition)` takes
the edition; `nation_list` carries the columns in its two branches, finds the candidate copies by a hash aggregate
on (pair, score, day or day before) and tests only those by equal keys, and counts by two hash aggregates;
`nation_matches` tests a copy by two equal-key joins and joins what the copies lend once, by day. The small volume's
standings times vary by ±15 ms from one run to the next (the same statement over the same rows read 21 and 38 ms
before 159).

## 44. Guarantees of the writers §40 found wanting: an omission is not a deletion (audit E02c, E02d, E03h; 19 Nov 2026, written before the tests)

Lot « garanties », branch `claude/audit-garanties` from `4fb0082d51` (main `2088d36e60` with the « collecte »,
« notes » and « writers » lots). It corrects the twelve defects §40 proved (40c, 40f, 40g, 40h, 40j, 40k, 40n, 40o,
40s, 40t, 40w, 40x) and `write_search`, which the matrix names without a replay. The model is VI-31's for the
transfers (§33, 35w–35z, migration 153): the last accepted read stays served, an element the provider stops listing is
kept and marked absent from the day of the read instead of being deleted, a refusal is traced and the unit stays due.
Migration 160 is additive (columns and views); no published migration changes; no row is deleted or rewritten by it.

### 44.1 What the code does on `4fb0082d51` (the §40 replays, red with `WRITER_REPLAY_STRICT=1`)

- `write_values` deletes every Transfermarkt point of the player absent from a non-empty history (40c); an empty
  history is acquitted without a write (40b holds, but the unit is not refused).
- `write_injuries` deletes all the player's episodes and inserts the answer: an empty list erases them (40f), a short
  one drops the omitted episode (40g), every read gives the episodes new ids (40e). A refused read sets `error_code`,
  and `api.player_injury_reads` (116) requires `error_code IS NULL`: the route answers 404 although the accepted
  history is stored (40h).
- `write_squad` and `write_search` delete a club-season's members and insert the answer: empty (40j) or short (40k)
  answers erase members, acquitted.
- `uefa.fetch` accepts `totalElements: 0` with no member and `uefa.save` deletes the edition's rows (40n); every read,
  identical or not, deletes and rewrites the rows and raises the edition's `ranking` resource version (40x).
- `fifa.run` reads an edition once: one stored short (one row of three) is never read again (40o).
- `wikidata.save_club` writes `founded_year` as the answer gives it (NULL when absent) and closes the open Wikidata
  tenure when the answer names no coach (40s); `save_stadium` writes capacity, its date and the coordinates as given,
  NULL included (40t).
- `player_facts.save` replaces `core.players.birth_date` whatever its provenance and leaves `birth_date_source_url`:
  a date the Transfermarkt snapshot attested is served under the snapshot's URL with Wikidata's value (40w).

### 44.2 Rules

**Empty answers (40b, 40f, 40j, 40n).** An answer that is valid in form but holds no element never removes an
accepted observation. For a Transfermarkt history (values, injuries) or squad, when the player (club-season) holds at
least one row of the provider, the read is refused: `Failed` with HTTP 200 and a code (`HISTORY_EMPTY` for values and
injuries, `SQUAD_EMPTY` for a squad), nothing is written, `ops.transfermarkt_reads` keeps `read_at` and
`rows_written` of the last accepted read and carries the code, the attempts and the bounded backoff (the unit is due
again within the retry delay). Holding nothing, the empty answer is an ordinary one (a player never injured, a season
without a squad): acquitted, 0 rows. An empty UEFA edition is refused whatever is stored (`EMPTY_EDITION`): it would
otherwise delete the rows, or create an empty edition marked current; the scope fails, `ops.source_runs` traces it and
the next attempt comes after `RETRY_AFTER`.

**Malformed answers (40d, 40h).** Unchanged refusals (`SCHEMA_CHANGED`, schema stop). A refused or failed refresh
never hides an accepted read: `api.player_injury_reads` names the player once one read was accepted (`read_at IS NOT
NULL`; the reader sets `read_at` only in `done`, never on a refusal), whatever the last attempt gave, as 153 does for
the transfers. A first read refused stays unknown (404); a quarantine still hides everything.

**Histories (values 40c, injuries 40g).** An element a valid, non-empty answer omits is not deleted: it keeps its facts
and is marked `absent_since` = the day of the read (the first day it was missed; a later omission keeps that day).
Listed again, the mark is cleared. Nothing of the provider's rows is deleted by the reader any more.
- A value point is keyed by its day (the table's key). A listed point is written only when its value, club, team or
  mark differ: a second identical pass changes no row and records `rows_written` 0; a real correction (another value
  on that day) replaces it. A point of the 6 July 2026 snapshot (`market_value_snapshot`, same source) that the
  reader's history omits is marked like any other: it no longer oscillates (deleted by the reader, re-inserted by the
  snapshot the next day), since the snapshot only rewrites a point whose `as_of` is not later than its vintage.
- An injury episode has no provider id. It is keyed by (start date, label). An answered episode matches the stored one
  of the same key; then, inside one start date, one stored episode left unmatched and one answered episode left
  unmatched are the same episode whose label the provider corrected. Otherwise the answered episode is new. A matched
  episode keeps its id and is updated in place when a fact differs (end, days, games, season, kind, label). The same
  key twice in one answer is one episode when both state the same facts; with different facts the answer is refused
  (`HISTORY_CONFLICT`), as for the transfers.
- Served: **with the mark, as 153 serves the transfers**. `api.player_market_values` and `api.player_injuries` gain
  `absent_since` as their last column; `GET /api/player-market-values` adds `absentSince` to a point and
  `GET /api/players/{id}/injuries` to an episode only when it is set (additive fields: a body without absence is the
  same bytes as before). The site reads neither field: an absent point stays on the value curve and can remain the
  « latest value » of the profile (139), and an absent episode stays in the list. This keeps what the site showed
  before a truncated answer; the price is that a real removal by the provider (a value or an episode deleted, a start
  date corrected) stays shown, marked in the API, until a person decides.

**Current state (squads 40j, 40k, `write_search`).** A member may leave for real; a truncated answer cannot be told
from a departure. The squad response carries no size of its own, and the club record's `squadSize` (`/clubs`) counts
the current squad, not a season's: it cannot check a past season, and nothing proves it counts the same members as
`/club/{id}/squad` for the current one. No threshold is invented. The rule: a member omitted by a valid, non-empty
squad is kept and marked `absent_since` (listed again: the mark goes); the linker (`link_players`) reads the present
members only, so a departure or a truncation weighs on the links exactly as the deletion did, but the observation and
its day stay. `read_on` is the day the row last changed: a second identical pass writes nothing. `write_search` writes
the candidates' squads by the same rule (it never wrote an empty one). What this lets through: a truncated answer
still removes a member from the link candidates until he is listed again; a real departure is kept marked, never
removed.

**Fields absent from an answer (40t, 40s).** A field an answer omits does not set a known field to NULL.
- Stadium: the capacity, its observed date and its day are written together when the answer gives a capacity, else
  all three kept; the coordinates when both are given, else both kept; the opening date (and its year) and the
  creation date each when given. A different given value replaces the stored one (a correction).
- Club: `founded_year` when given (a different year replaces), else kept; the stadium was already kept (coalesce).
- Coach: a Wikidata tenure is closed only when the answer names another coach; it closes on the day of that read and
  the new one opens. An answer without a coach changes no tenure. A real departure without a successor named is not
  seen: the tenure stays open until the next named coach. This is the known limit of the rule.

**Birth dates (40w).** A birth date with a recorded provenance (`core.players.birth_date_source_url` set: the
Transfermarkt snapshot writes it only with the date it fills) keeps its value and its URL. A different plausible date
from Wikidata does not replace it and never takes its URL: the conflict is traced once in `ops.parse_failures`
(`BIRTH_DATE_CONFLICT`, the player, the stored date and URL, Wikidata's date and person). The link and the height are
still written. A date without provenance (empty, or written by Wikidata, which records none) is replaced as before: a
Wikidata correction applies. The dates already overwritten in production are not repaired by the code (it would change
the date the site shows): §44.4 gives the query that lists them.

**FIFA editions (40o).** The source states no edition size (the overview lists rows only), so a completeness check
would need an invented threshold. The rule is a re-read: the latest stored edition, while it is the latest of the
catalogue, is read again when its last read (`core.ranking_editions.checked_at`, new) is at least `REREAD` (7 days)
old. An identical re-read writes no row and raises no version (only `checked_at`); a re-read with at least as many rows
and other content replaces the rows and raises the version once; a re-read with fewer rows than stored is refused: the
stored rows stay, `ops.parse_failures` records `EDITION_SHORTER` once for that edition and count, and the next re-read
comes a week later; an empty re-read (not published) changes nothing. Older editions keep main's rule (never read
again). What it lets through: an edition read short and superseded before its re-read stays short.

**UEFA editions (40x, 40n).** `uefa.save` builds the edition's rows (links, logos and crests as before) and compares
them with the stored rows and season points: equal, it deletes and inserts nothing and raises no `ranking` version;
the edition's own record is updated only when one of its fields differs. Any difference replaces the edition and
raises its version once. The emptiness refusal is in `fetch` (above). Only `fetch` and `save` change (the « identités »
lot holds the rest of `uefa.py`).

### 44.3 Failure modes and expected outcomes

| # | Writer | Situation | Expected |
|---|---|---|---|
| 44a (40b) | values | `{"history": []}` after two accepted points | both kept; `HISTORY_EMPTY`, 200, due within a day |
| 44b (40c) | values | a valid history without one of the two points | both kept; the omitted one `absent_since` = read day; read acquitted |
| 44c | values | then the whole history again | the mark cleared; a third identical pass writes no row (`rows_written` 0) |
| 44d | values | a point's value corrected at the source | the new value replaces it |
| 44e | values | the absent point through `GET /api/player-market-values` under `vega_read` | served with `absentSince`; the other points without the field |
| 44f (40f) | injuries | `{"injuries": []}` after two episodes | both kept; `HISTORY_EMPTY` |
| 44g (40g) | injuries | a valid list without one episode | both kept, the omitted one marked; listed again: mark cleared, ids unchanged (40e: same ids on a repeat) |
| 44h | injuries | an ongoing episode's end date and games filled; another's label corrected | updated in place, same ids, no new episode |
| 44i (40h) | injuries | `injuries: "x"` after an accepted read | `api.player_injury_reads` names the player; `GET /api/players/{id}/injuries` 200 with both episodes |
| 44j (40j) | squad | `{"squad": []}` after two members | both kept; `SQUAD_EMPTY` |
| 44k (40k) | squad | a valid squad without one member | both kept, the omitted one marked; not a link candidate; listed again: cleared |
| 44l | search | a candidate's squad without one stored member | the member kept and marked, not deleted |
| 44m (40n) | UEFA | `totalElements: 0`, no member | stored rows kept; scope `EMPTY_EDITION` |
| 44n (40x) | UEFA | the same pages twice | rows and `ranking` version unchanged |
| 44o | UEFA | one club's points changed | the edition replaced, version raised once |
| 44p (40o) | FIFA | the latest edition read with one row of three, complete at the source a week later | three rows, version raised once; an identical re-read after another week writes nothing |
| 44q | FIFA | a re-read shorter than stored | stored rows kept; `EDITION_SHORTER` in `ops.parse_failures` once |
| 44r (40t) | stadium | an answer without capacity and coordinates | both kept; a later answer with another capacity replaces it |
| 44s (40s) | club | an answer without `founded` and coach | founded year kept, tenure open; a later answer naming another coach closes it that day and opens his |
| 44t (40w) | player facts | a snapshot-attested date, Wikidata another | date and URL kept; `BIRTH_DATE_CONFLICT` once; height written; a date without provenance is still corrected |

### 44.4 What stays open or for the operator

- The six birth dates Wikidata overwrote before this change are listed by
  `SELECT p.id, p.birth_date, o.birth_date, p.birth_date_source_url FROM core.players p JOIN core.player_fact_observations o
  ON o.player_id = p.id AND o.source = 'transfermarkt_snapshot' AND o.source_url = p.birth_date_source_url
  WHERE o.birth_date IS NOT NULL AND o.birth_date <> p.birth_date`; restoring them changes what the site shows and is a
  user decision (closed question: « restore the snapshot's date for these players, yes or no? »).
- Absent values and episodes stay served; whether the site should hide or mark them is a design decision (mock-up
  first).
- A squad departure without a later listing stays marked forever; a FIFA edition superseded before its re-read stays
  as read; a coach leaving without a named successor keeps an open tenure.
- No history table of absences ended (153 has one for the transfers): the mark is cleared on reappearance and the
  absence is not kept for values, injuries and squads.

## 45. Residuals: an Open Matchday copy kept until its native edition covers it, a football-data pair no longer holds a reviewed copy, the Transfermarkt search refuses a reserve (audit E02b, E03f/E03h, E03c/E03g; 19 Nov 2026, written before the tests)

Lot « résiduels », branch `claude/audit-residuels` from the candidate `8587ab6671` (main `2088d36e60` with six lots).
No migration. Three defects the earlier lots left open, each reproduced on `8587ab6671` before any change
(`open_matchday.py`, `archives.py` and `transfermarkt.py` are the same functions there as on `2088d36e60` for the
lines concerned).

### 45.1 What the code does on `8587ab6671`

- **E02b.** `open_matchday.held(conn, folder, season)` answers true as soon as the copied league
  (`COVERED[folder]`) has a PitchAPI edition for the season, empty or not, and `run` then calls `drop_copy`, which
  deletes every match of the copy, its rounds, its edition and competition, with no trace. Replayed by
  `open_matchday.run` under `vega_collect`: a first pass writes the Premier League copy (5 results, 3 fixtures); the
  catalogue then creates the native 2026/2027 edition with no match; the second pass deletes the 8 matches, the
  edition and the competition, and `ops.parse_failures` stays empty. At a season change the catalogue creates the native
  edition before its matches are collected: the copy's results disappear until PitchAPI writes its own, and for good
  where PitchAPI never does.
- **m4 (§36, 35ad).** `Loader.removals` holds a reviewed archive copy (`removal_has_dependents`) when
  `ops.archive_match_dependents` names any dependency, football-data.co.uk's pair
  (`core.footballdata_matches.match_id`) included; `_delete` refuses the same at apply (`ArchiveDrift`). That pair is
  `ON DELETE SET NULL` and the reader pairs every row again each week (`footballdata._link`): it is a derived pointer,
  not a fact of the copy.
- **E03c/E03g.** `pick_clubs` (the votes) never links a first team to a reserve (`is_reserve`, conflict
  `reserve_side`), but `write_search` links the club `pick_search` chose without that check. Production: team 604
  (Estudiantes de Río Cuarto, Liga Profesional) linked on 16 Nov 2026 21:51:17 UTC by `club_search_squad` (evidence 6)
  to Transfermarkt's 75142, « AA Estudiantes de Río Cuarto II » (`mainClubId` 14602); the votes noted the conflict on
  18 Nov 00:31:27 without removing the link; `team_of` and `attach_teams` keep reading it: three values and four
  transfers carry `team_id`/`to_team_id` 604 for `provider_club` 75142 (`integrite-cas.zip`, `operateur/reserve-*.csv`),
  and `GET /api/teams/t_1dhmUh/squad?season=2026/2027` serves the reserve's record as the club's squad (value 125 000 €,
  27 players, average age 20.6, ranked 30th of 30; read 19 Nov 2026).

### 45.2 Rules

**An Open Matchday copy goes only when the native edition covers it, match by match (E02b).**
- `held` is unchanged: a COVERED folder is not read in a season PitchAPI holds its league. The copy then stays as last
  read (frozen), so it never doubles what PitchAPI writes for the same days. The Elo already never reads a COVERED
  folder (`power.elo_matches` skips them whatever their state), so a copy kept beside its native edition counts nothing
  twice; `identity.duplicates` only notes, in `ops.data_warnings`, a copy match whose clubs are PitchAPI's within a day.
- `drop_copy` removes the copy (matches, rounds, edition, competition and its id, the match ids), as before, only when
  every match of the copy, whatever its status, has a match of a PitchAPI edition of the copied league for that season
  (competition keyed `pitchapi`/`COVERED[folder]`, `cup_key` and `archive_key` NULL, the season's label) with the same
  two clubs, either side at home, each club resolved through `core.teams.merged_into`, whose `match_date` is at most one
  day from the copy's. A copy without a match is covered.
- Otherwise nothing is deleted: the whole copy stays (no partial removal, so a copy match not covered never
  disappears), the reason is traced once while it stays the same (`failure_once`, code `COPY_NOT_COVERED`, edition of
  the copy, message `open-matchday:<folder>:<season>: <n> of <total> match(es) without a native match: <first five as
  day home–away>`), and the next pass (six hours) tries again. A copy covered later goes at that pass.
- What this lets through: a copy fixture PitchAPI moves by more than a day, or a copy club the identities never link
  to PitchAPI's, keeps the copy, frozen and traced, until a person decides; the copy edition stays visible as a
  complementary competition meanwhile, as it was before its league was held.

**A football-data pair alone does not hold a reviewed copy (m4; decision of the owner, taken by the coordinator).**
- In the removal of a reviewed archive copy (`Loader.removals`) and in its check at apply (`_delete`), the dependency
  `core.footballdata_matches.match_id` alone no longer holds the copy; every other dependency and every event holds it
  as before (`removal_has_dependents`). The removed entry of the plan names what its removal releases
  (`"released": ["core.footballdata_matches.match_id"]`, only when there is one: other plans are unchanged).
- The deletion clears the pair (`ON DELETE SET NULL`); the football-data row stays, unpaired; the reader's next pairing
  (`footballdata._link`, under `vega_collect`) gives it the twin that stays when the twin is the one match of its
  clubs and score; a second pairing changes nothing.
- 141's guards stay as they are: `ops.archive_match_dependents` still lists the pair (the plan shows it), the
  `archive_removed_*` triggers fire on a non-null reference only (the `SET NULL` passes) and the tombstone refuses a
  later pairing to the removed id. Should they refuse the removal, they are not bypassed: the case is described and
  stops there.
- Unchanged: `merge_twins` (35ab), the purge (35ac), the restorer's refusal (35aa).

**The Transfermarkt search links no reserve to a first team (E03c, E03g).**
- `write_search` applies `pick_clubs`'s checks to the chosen club before `_link`: its name is the one
  `core.provider_clubs` holds. No name known yet, or a name that is no club (`NO_CLUB`): no link, the search is due
  again in a day (the squads it wrote queue the club's record, read at priority 1 before searches, so the next search
  knows the name). `is_reserve(club name) != is_reserve(team name)`: no link, the conflict row of the votes
  (`ops.provider_link_conflicts`, reason `reserve_side`, `ON CONFLICT DO NOTHING`), the search done as usual. The
  players and squads the search read are written as before.
- Known limit, not changed here: `RESERVE`'s single letters also match « D.C. United » (`c`) and « B 93 » (`b`). D.C.
  United is linked already (links never move); a club so spelled that only the search would find is now refused and
  noted, as the votes do.

**The production link 604 → 75142 (specified, not applied).** The pre-image in the repository is the 18 Nov 15:37
UTC read of `integrite-cas.zip`; the reader has kept writing since (four or five transfers are named across the
audit's reads), so the rows to correct are not entirely known here. A reviewed correction, on the model of
`identity.SIDE_CORRECTIONS` (§39), would be: `TEAM_LINK_CORRECTIONS = {"estudiantes-rio-cuarto-604": {"team": 604
(by its PitchAPI key t_1dhmUh), "club": "75142", "club_name": "AA Estudiantes de Río Cuarto II", "values": [(player,
valued_at, value_eur) × 3: (10490, 2026-09-17, 25 000), (10491, 2026-09-17, 25 000), (10496, 2026-05-22, 50 000)],
"transfers": [(id, player, transfer_date, source_key) × 4: (82621, 10484, 2025-01-01, 6041364), (63313, 10490,
2026-01-01, 6253703), (77477, 10491, 2026-01-01, 6257185), (86811, 10499, 2026-01-01, 6257187)]}}`. Applied in one
transaction, it would check the pre-image (the current transfermarkt key of 604 is 75142, its link row
`club_search_squad`, the provider club's name, exactly these values and transfers carrying 75142 and 604 and no
other); on any difference it holds the whole correction, writes nothing and traces why once. Otherwise: the key row
`core.provider_ids(team, transfermarkt, 75142, 604)` becomes `is_current = false` (kept: the key stays taken, so
neither the search nor the votes give 75142 to 604 again, and 604 may get its real club), its `ops.provider_links`
row is quarantined (`quarantine_reason = 'reserve_side'`, which `api.club_squad` already excludes), the three values'
`team_id` and the four transfers' `to_team_id` (and `from_team_id` where 75142 is the origin) become NULL. Nothing is
deleted: the values and transfers stay, served under the provider club's name (« AA Estudiantes de Río Cuarto II »,
`coalesce(team, provider club)` in 135/153/160's views) without a canonical club; the squad route answers 404 for 604
until its real club is linked. A journal row per correction (its digest, as §39) makes a second application a no-op.
The six players linked through 75142's squads (`link_players`) are persons, linked by name and birth date: not
touched. To apply it, an operator needs the production rows of the pre-image at that time (a read under `vega_read`
of the five queries of `integrite-cas.zip/sql/final-probe.py`) to fill the lists, then the code and its test.

### 45.3 Failure modes and expected outcomes

| # | Situation | Expected |
|---|---|---|
| 45a | Copy of the Premier League (5 results, 3 fixtures) written by `open_matchday.run` under `vega_collect`; the native edition then created empty; `run` again, twice | the copy keeps its 8 matches, edition and competition; one `COPY_NOT_COVERED` row naming 8 of 8, still one after the third pass |
| 45b | The native edition then holds the 8 matches (PitchAPI's clubs, the copy's teams merged into them; one a day later, one with sides swapped); `run` | the copy goes as before (matches, rounds, edition, competition, ids); the cup of the same summary stays |
| 45c | The native edition holds 7 of the 8 | the whole copy stays; the trace names 1 of 8 with its day and clubs |
| 45d | The missing native match is two days from the copy's | not a cover: the copy stays |
| 45e | A kept copy beside a covering native edition, `power.elo_matches` | the copy's rows are not among the Elo's matches |
| 45f | (35ad rewritten) A reviewed archive copy football-data paired, its twin identical; plan, apply, then `footballdata._link` twice under `vega_collect` | the plan removes the copy (`released` names the pair), the apply deletes it, the football-data row is kept unpaired, the first pairing gives it the twin, the second changes nothing, a new plan removes nothing more |
| 45g | The paired copy also bound by a provider key | held `removal_has_dependents`, never deleted |
| 45h | `Reader.read` of a search for « Estudiantes de Río Cuarto » whose one candidate, with six of our players, is the club « AA Estudiantes de Río Cuarto II » (name known); then its players' values and transfers | no team link, one `reserve_side` conflict (75142, the team), the squad and the players written; the values and transfers read after keep `provider_club` 75142 and no team |
| 45i | The same search, the club's name not known yet | no link, no conflict, the search due again within a day; after the club record is read, the next search refuses as in 45h |
| 45j | The same search whose candidate is the first team « AA Estudiantes de Río Cuarto » | linked as before (`club_search_squad`) |

### 45.4 The search waiting for a club's name is bounded (second review, point 4; 19 Nov 2026, written before the tests)

The retry of a day (`SEARCH_UNNAMED_AGAIN`) assumed the club's record arrives: two cases never resolve. `/clubs` may
omit the club (`write_club` records a 404 with no `core.provider_clubs` row, and the `club` unit, queued
`ON CONFLICT DO NOTHING`, waits 90 days), or answer it without a name (`parse_club` gives `name` None, the column is
nullable). The whole search (the quick search, up to three squads, their players: five to eight requests 2.5 s apart)
was then read again every day for that team, on the budget of a reader that pauses at its first refusal.

Rule: one close retry only. A search whose chosen club has no usable name is recorded with the error mark
`CLUB_UNNAMED` (`ops.transfermarkt_reads.error_code`, `attempts` counting, as `done` already writes them: no
migration). Due again within a day when the unit did not carry that mark already; carrying it (the close retry was
spent), at the search's ordinary period for its priority. No link and no conflict while the name is missing. When the
name arrives, the reserve check applies as in 45h and the search is recorded as usual (the mark cleared).

## 46. The independent review of 2088d36e60..8587ab6671: a grade status read by key, a first 404, the side journal, the failures' lookup (19 Nov 2026, written before the tests)

An independent review of the six lanes integrated on `claude/audit-reprise-33` (8587ab6671) returned six findings
(evidence `relecture/CONSTATS.md`). Each was replayed first on a disposable PostgreSQL 18.6, by the real writers where
there is one: five reproduce, one does not.

- **1.** `GET /api/read/performance` joins `api.player_grade_status` (155) to its materialized `target` CTE. The view's
  key set is a `UNION ALL` of the statistics and of the line-ups with a `NOT EXISTS`; the planner pushes no join
  condition into it, so each call builds the whole view (every partition of `core.player_match_stats`, twice, and of
  `core.lineup_players`) and hashes it: 14.1 s for one row on the review's base (60 000 matches, 1.5 M statistics,
  1.8 M line-up rows), 1.8 ms with constants. The read API's `statement_timeout` is 8 s.
- **2.** 160 serves `api.player_injury_reads` once `read_at` is set, on the premise that the reader sets it only on an
  accepted read. `Reader.read` records a 404 (`Missing`) by `done(..., status=404, error="NOT_FOUND")`, which sets
  `read_at`: a player whose first injuries read answers 404 is served `{"injuries": []}` (« never injured ») instead of
  116's 404. Replayed: real reader under `vega_collect`, real route under `vega_read`. Values and squads have no read
  gate (no `*_reads` view; `api.club_squad` and `api.player_market_values` serve their rows): nothing to align there.
- **3.** `identity.correct_sides` journals a moved side by an `INSERT` without `ON CONFLICT` on `(match_id, side)`. One
  of the fifteen held keeps the keys on Barcelona SC; a later re-read of the Copa del Rey edition (`cups.save`) resolves
  « FC Barcelona » by `name:FC Barcelona`, still on 707, and puts a moved side back on it; every later identity pass
  sees the side wrong again, retries the `INSERT`, takes 23505 and rolls back the whole `teams` scope (merges included).
  Replayed by the real writers under `vega_collect`.
- **4.** `sources.failure_once` looks up `ops.parse_failures`, which has only its primary key and is never purged: a
  sequential scan per call (27 ms on 300 000 rows, once per birth-date conflict in a club's transaction).
- **5.** Not reproduced. The review read `in_match` as NULL for a statistics row without a team and concluded that such
  rows, graded before the diff, now lose their grade. Before the diff (2088d36e60) and after it, `PLAYER_MATCHES`
  inner-joins `core.teams` on `s.team_id`: a row without a team is never read by the players' run, so it was never
  graded and is not graded now (the same run on both commits: no grade, no power-match row). `in_match` is never NULL in
  the rows the run reads. Nothing changes in `power.py` or in 155: the status of such a row stays `team_not_in_match`
  (no team of the match), which is what the run does with it.
- **6.** `core.team_side_corrections` references `core.matches` without `ON DELETE`. `merge_twins` holds a pair an
  attestation names (143) but not one a side correction names: if one of the corrected archive matches is a goal-only
  `g:` twin, its `DELETE` fails on the foreign key and its season fails at every pass (printed only). The European
  archive keys are `g:`-prefixed (`g:champions-league:2020-10-28:1` for 729828), so the case is not only theoretical.

### 46.1 Rules

- **Grade status by key (1).** The performance read resolves the participation's key from its bound values, as the
  appearance itself is found (`found(values)`): `season_id` the bound edition season, `match_id` and `player_id`
  `api.internal_id(...)` of the bound public ids, and reads `api.player_grade_status` filtered on these three. No join
  of the view to a CTE. The planner then pushes the three conditions into both branches of the key set and into the
  `NOT EXISTS`: every scan of a statistics or line-up partition is an index scan on the participation's key (on the review's
  base the primary key with `season_id`, `match_id` and `player_id`), in a custom plan and in a generic one (`plan_cache_mode = force_generic_plan`), with `enable_seqscan`
  at its default. `gradeStatus` and its values are unchanged. The fragment is one exported function of the route
  (`gradeStatusSql`), so the plan test reads the SQL the route sends. No other reader of the diff reads the view by
  join (`performance.mjs` is its only reader).
- **A 404 on injuries is a refusal (2).** The reader records it as before (status 404, `NOT_FOUND`, the next read in
  `NOT_FOUND_AGAIN`), but `read_at` and `rows_written` stay those of the last accepted read, as for every other refusal
  (`failed`). Hence, through 160's view unchanged: never read or never accepted → 404; accepted (even empty) then refused
  by a 404 or by any other refusal → the accepted list is served. Other kinds keep their 404 as an answer (`read_at`
  set): the profile and club planning read it, and no reader gates them on it. 160 (neither published nor deployed) is
  corrected in place for the rows the old reader left: an injuries unit whose last attempt was refused
  (`error_code IS NOT NULL`) and whose player holds no Transfermarkt episode has its `read_at` cleared: nothing shows
  it was ever accepted, so it stays unknown, as under 116. A unit with held episodes keeps its `read_at` (only an
  accepted read writes episodes). Lost by that correction: the date of a legacy 404, and an accepted empty list
  refused later stays a 404 until its next accepted read (116's behaviour, production's today).
- **The side journal never fails the pass (3).** The journal's `INSERT` is `ON CONFLICT (match_id, side) DO NOTHING`.
  A side found back on the wrong club after its move is moved again (the facts follow it, as on the first move) and
  counted as moved; the pass prints how many were moved again. The journal keeps the first move of each side (its
  clubs, keys, correction, proof digest and `applied_at`): `vega_collect` may only add to it and the key is the side,
  so a second move adds no row; the pass's line says it. As long as a match of the correction is held, the keys stay on
  the wrong club and a re-read can put the side back again: the held match must be resolved by review.
- **The failures' lookup (4).** Migration 157 adds `ops.parse_failures (error_code, competition_season_id, md5(message))`
  (`lock_timeout` 3 s). `failure_once` asks `error_code = $1`, `competition_season_id = $2` (or `IS NULL` when no
  edition), `md5(message) = md5($3)` and `message = $3`: an index scan on the three conditions. The message itself is
  not indexed (up to 2 000 characters, past btree's row size in a multi-byte script). 157 adds no relation naming a
  match: `open_matchday_restore.REVIEWED_SCHEMAS` stays pinned on 160.
- **Rows without a team (5).** As on 2088d36e60: never read, never graded, no exclusion recorded; the year is published.
- **Side journal and removals (6).** The journal is a proof like 143's attestations: it keeps its foreign key, and what
  would remove a match it names holds instead of failing or dropping it. `merge_twins` holds a pair whose goal-only
  match or result a side correction names (reason `side_corrected`), printed and appended to `held`, nothing written;
  the scope purge holds the competition whole (its `_protected` check: the collection role may not delete from the
  journal); a reviewed removal holds the match (`removal_has_dependents`, through `ops.archive_match_dependents`, which
  names `core.team_side_corrections.match_id`). `open_matchday_restore.ADDED_DEPENDENCIES` already lists the table. A
  trigger guard (141) is for relations without a foreign key: the journal needs none.

### 46.2 Failure modes and expected outcomes

| # | Situation | Expected | Before the corrections |
|---|---|---|---|
| 46a | `GET /api/read/performance` for three keys of the API seed, under `vega_read` | `gradeStatus` `graded`, `below_display_threshold`, `no_minutes` (38f) | green (the values were right) |
| 46b | The route's grade-status SQL, `EXPLAIN` with the bound values and as a generic plan, `enable_seqscan` off (the seed is tiny) | every scan of a statistics or line-up partition is an index scan on the participation's key (on the seed the planner takes the primary key or the `(player_id, season_id)` index: the condition names `player_id`) | red: index scans of every partition without any condition (the view is built whole) |
| 46c | The same SQL on the review's base (`relecture_a`), `EXPLAIN (ANALYZE)` custom and generic, defaults | no sequential scan of `player_match_stats` or `lineup_players`; milliseconds | 27.8–31.8 s a call under the read API's settings (no parallel query; 14.1 s in the review with parallel workers), sequential scans of every partition; after: 4.4–6.8 ms a call, 1.1–1.3 ms executed |
| 46d | A first injuries read answered 404 by the reader, then `GET /api/players/{id}/injuries` | 404 | red: 200 `{"injuries": []}` |
| 46e | An accepted read with two episodes, then a 404 | 200, both episodes; `read_at` that of the accepted read | served, but `read_at` moved to the 404's time |
| 46f | An accepted empty read, then a 404 | 200 `{"injuries": []}` | green by accident (`read_at` set by the 404) |
| 46g | 160 on legacy units: first read 404 (no episode), accepted then refused with episodes, accepted then refused without | unknown; known; unknown | known; known; known |
| 46h | One of the fifteen held, the pass, a re-read of the Copa edition that puts 2276's side back on 707, two more passes | each pass succeeds; the six cup sides the re-read put back (2276 among them) on 740 again; the journal unchanged, 14 rows | red: both passes fail on 23505 |
| 46i | `failure_once` on 300 000 rows, with and without an edition | index scan, conditions on the three columns; still one row per (edition, code, message) | sequential scan (27 ms) |
| 46j | A statistics row without a team, the daily path on the candidate and on 2088d36e60 | not graded, no exclusion, the year published, status `team_not_in_match`; the same on both commits | green on arrival (the finding does not reproduce) |
| 46k | `merge_twins` on a twin pair whose goal-only match a side correction names | the goal-only match or the result named: held `side_corrected`, nothing changed, the journal row intact; the season does not fail; again the same | red: the twin named, the season fails on the foreign key at each pass; the result named, the pair is merged unreviewed |
| 46l | The scope purge of a competition whose match a side correction names; a reviewed removal of such a match | the competition held whole; the match held `removal_has_dependents` naming the journal | green on arrival (the foreign key and the dynamic dependents already hold them) |

| 45k | 45i's search when `/clubs` omits the club (its unit recorded 404, no `core.provider_clubs` row, due again in 90 days); the search read three times, each when due | the first search due again within a day, the next ones at the search's ordinary period (`PERIODS["search"]`, 30 days at priority 1); no link, no conflict at any of them |
| 45l | The same when the club's record has no name (`parse_club`'s `name` None, the row stored with a NULL name) | as 45k |
| 45m | After 45k or 45l, the club's name arrives (the reserve's) and the search is read | the reserve check as in 45h (`reserve_side`, no link); the unit's error mark cleared |

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

### 14.5 [P2] Non-finite half xG (126)

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

### 14.6 [P3] One xPts law per row (127)

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

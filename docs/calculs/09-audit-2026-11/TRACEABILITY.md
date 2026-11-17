# Calculation audit of 16 November 2026 — traceability (VI-23, stages 2 to 7)

**Checkpoint status:** independent implementation accepted by Astra on v3; fresh Opus correction verification unavailable after two quota failures. No joint final signoff; VI-23 remains In Progress. See [REVIEW_STATUS](REVIEW_STATUS.md).

Every item and subitem of the audit (`prototypes/calculation-audit/context/original-audit.md`), and
every finding made since, with its exit status in VI-23, the code and tests behind it, and its
evidence. Baseline `a912ed319e`, branch `codex/calculation-audit-20261117`, not committed. The
contracts are in [FAILURE_MODES.md](FAILURE_MODES.md), written before the tests, which were run
RED before the code.

## Status vocabulary

| Status | Meaning |
|---|---|
| **Corrected locally + verified** | Fixed in this branch; its failure-mode tests were RED on the baseline (or on the candidate, for the interim findings) and are GREEN now. |
| **Owner correction reviewed** | An owner fixed it, or part of it, and the fix was reviewed with evidence. Only 13a has this status, partially (VI-22's new similarity API and tab, below). The other owner checks run here (VI-21 power suite 37/37, VI-22 route 5/5 on the local DB) show that those suites pass; they resolve no finding. |
| **Handed off, unresolved** | Outside VI-23's files (owned code, a shared interface, or an owned display). The contract and, where possible, RED evidence are recorded for the owner. |
| **Model choice** | A normative or modelling decision, documented, not a defect to fix. |
| **Real-data validation unavailable** | Verified on synthetic or committed fixtures only. No production snapshot was evaluated and no production read was performed: the delegated work deliberately used isolated local databases. The effect on real data is not measured. |

An item can carry two statuses: for example corrected locally and with real-data validation unavailable.

## Items of the audit

| Item | Finding | Status | Where | Tests (RED → GREEN) |
|---|---|---|---|---|
| 1 | Duel attempts derived before zero restoration | Handed off, unresolved (VI-21, `power.py`) | — | — |
| 2 | Unknown non-penalty goals restored as 0 | Handed off, unresolved (VI-21) | — | — |
| 3 | League-level MAP gradient and covariance | Handed off, unresolved (VI-21) | — | — |
| 4 | Future information in historical contributions | Handed off, unresolved (VI-21 + VI-19, `lineup.py`) | — | — |
| 5 | Matches lost from the simulated season | Handed off, unresolved (VI-19) | — | — |
| 6 | The season simulation ignores `rho` | Handed off, unresolved (VI-19) | — | — |
| 7 | Open-round projection cutoff | Handed off, unresolved (VI-19) | — | — |
| 8 | Club metrics computed on unknown primitives; the xG gate on unrelated indicators | Corrected locally + verified (client service). Display consumers: handed off (VI-22) | `club-scout.js` `METRICS` (`get` + `count`), `clubCoverage` | `tests/audit-club-metrics.test.mjs` (failure matrix, complete row, unknown opponent, xG gate, zeros) |
| 9 (players) | Finishing gap on different samples | Corrected locally + verified | 128 (`finishing_*`), `players.mjs` (`finishingDelta`, eligibility), `season-player.js`, `player-directory.js`, `player-leaderboard.js`, `PlayersPage.jsx` (the directory reads `playerAverage`'s paired gap) | `test_audit_player_aggregates.py`, `backend/api/test/players-support.test.mjs`, `tests/audit-player-support.test.mjs` |
| 9 (clubs) | Points − xPts on different samples | Corrected locally + verified (service fields `pairedMatches`, `pairedActualPoints`, `pairedExpectedPoints`, `pairedPointsDelta`). The subtraction in VI-22's UI: handed off, unresolved | `club-scout.js` `pairedFields`, `buildCohort`, `rebase` | `audit-club-metrics.test.mjs` (the audit's club) |
| 10 | xPts truncation, symmetry, monotonicity | Corrected locally + verified (JS and SQL law, domain ≤ 100 xG a side) | `club-scout.js` `outcomeChances`; 130 `agg.xpts_v2`, `api.match_xpts`; `calculator.py` | `audit-club-metrics.test.mjs` (law, impossible inputs, domain); `test_audit_club_aggregates.py::ExpectedPointsLawTest` (1–6; 6: one law call per row, stage 5) |
| 11a/b/c | Forecast consistency across routes | Handed off, unresolved (VI-19, + VI-21 for history) | — | — |
| 12 | The line-up training variable differs from serving | Handed off, unresolved (VI-21 + VI-19) | — | — |
| 13a | Club similarity with zero common axes | **Partially corrected by VI-22, owner correction reviewed** (Astra/xhigh read-only, owner HEAD `3b7aeda85b`, `context/astra-owner-similarity-disposition.md`): the new `/api/teams/{id}/similar` keeps axes with ≥ 5 covered matches and needs max(5, ⌈0.75 × target axes⌉) common axes, and the new « Clubs similaires » tab reads it; combined with VI-23's calculator and cohorts, 9/9 checks pass (`context/combined-style-*`). Still unresolved, VI-22: the legacy default comparison and the « Comparer avec » suggestions still use `similarClubs`, which ranks an empty candidate at 100 with 0 common axes; the cards show no common axes or covered matches; the copy (« Style de jeu seulement », « championnats de niveau comparable ») is stale against the approved continuous league-gap penalty, which stays. No VI-23 implementation. Production, recompute and visual acceptance unverified | owner files (unchanged here) | owner tests; combined workflow 9/9 |
| 13b | Missing blocks ranked as 0 | Handed off, unresolved (VI-21) | — | — |
| 13c | Performance percentile without per-metric support | Corrected locally + verified | `shared/player-profile.js` `MIN_PEERS` (per metric, also read by the server route through `performanceProfileFromCounts`), `services/player-profile.js` | `tests/audit-player-support.test.mjs` (percentiles) |
| 13d | PCA places empty profiles | Corrected locally + verified (`profile-embedding-v2`); real-data validation unavailable. The profiles route stays VI-22's | `embedding.py` (`eligible`, `known`, guards), `worker.py` (version due) | `test_audit_numeric.py::EmbeddingEligibilityTest` (1–8), `test_audit_models.py::EmbeddingRefreshTest`, `::EmbeddingNonFiniteRefreshTest`, adjusted `test_models.py`, `test_worker.py` |
| 14 (in-play) | In-play clock and fit | Handed off, unresolved (joint VI-19 / VI-21 interface) | — | — |
| 14 (durations) | Game-state minutes use `minute + added/100` | **Handed off, unresolved** (B7): VI-22's display adds and renders the durations | contract §8; `evidence/b7-handoff/` | RED, outside the runnable suites (below) |
| 15a | Neutral venue not symmetric | Handed off, unresolved (VI-19) | — | — |
| 15b | Player aggregates without a finished filter | Corrected locally + verified | `calculator.py` (PLAYER_SQL, stale delete), 128 (`refresh_player_list`, `refresh_performance_distribution`), `players.mjs` | `test_audit_player_aggregates.py::FinishedOnlyAggregatesTest`, `players-support.test.mjs` |
| 15c | Halves: blanks summed as 0 | Corrected locally + verified (complete halves); per-metric route integration and publication of the exclusions: handed off (VI-22, `profiles.mjs`); real-data validation unavailable | 129 `api.player_half_totals` (finite xG, stage 5) | `test_audit_player_aggregates.py::HalvesRealFixtureTest`, `::HalvesNonFiniteXgTest`, `backend/api/test/player-halves.test.mjs`, adjusted `players.test.mjs` |
| 15d | Round not amended after a postponement | Handed off, unresolved (VI-19, `rounds.py`) | — | — |
| 15e | Non-penalty xG divided by all shots | Corrected locally + verified (client and server) on inputs with explicit own-goal flags; the measured support can depend on the outcome when goals lack the flag (stage 7, below) | `club-scout.js` `penaltiesOf`; `calculator.py` `shot_sets`; `club_indicators.py` | `audit-club-metrics.test.mjs` (15e, spelling/teams/flags); `ServerIndicatorSupportTest.test_3`, `OwnGoalFlagSupportTest.test_3` |
| 15f | Own goals in the club gaps | Corrected locally + verified (client and server) on inputs with explicit flags; coverage trade-off and outcome-dependent support below; both scoring sources' contracts unverified (VI-21) | `club-scout.js` `scoringOf`; `calculator.py` `goals`, `scoring` | `audit-club-metrics.test.mjs` (15f, away variants, flags); `ServerIndicatorSupportTest.test_4`, `OwnGoalFlagSupportTest.test_1` |
| 15g | Returns broken by a national-team game | Corrected locally + verified (`returns-v2`); real-data validation unavailable | `returns.py` | `test_audit_models.py::ReturnsClubStreamTest` |
| 16a | xG long-distance rebound | Corrected locally + verified (constrained `xg-v2`, bounded SQL sigmoid); model choice (reduced flexibility); real-data validation unavailable | `xg.py`; `backend/tools/evaluate_xg.py` | `test_audit_numeric.py::ConstrainedXgTest`, `test_audit_models.py::XgVersionTest`, `test_audit_xg_evaluation.py`, adjusted `test_xg.py` |
| 16b | 90-minute target not guaranteed | Handed off, unresolved (joint VI-19 / VI-21) | — | — |
| 16c | Normative choices of the player score | Model choice (owners) | — | — |
| 17 | Stale documentation | Corrected locally (docs): the pages below; passages on owned subjects left to their owners | `docs/calculs` | — |
| 18 | Reproducible validation | Corrected locally for xG (dated, versioned, hashed evaluator); real-data validation unavailable | `evaluate_xg.py`; `evidence/stage2/xg-evaluation/` | `test_audit_xg_evaluation.py` |

## Findings made since the audit

| Finding | Status | Where | Tests |
|---|---|---|---|
| N1 — server club indicators: `covered_matches` = all matches, mixed supports | Corrected locally + verified (`club-indicators-v2`, 131); real-data validation unavailable | `club_indicators.py`, `models._team_values_sql`, `calculator.py`, 131 | `ServerIndicatorSupportTest` (1–6) |
| N2/N3 — player list and performance peers without a finished filter | Corrected locally + verified | 128 | `FinishedOnlyAggregatesTest` |
| N4 — returns count fixtures whose line-up is unobservable as « missed » | Recorded only (depends on VI-21's source deduplication) | — | — |
| N5 — club xG difference on different matches | Corrected locally + verified (paired xG fields, `opponentStrength`); UI expressions handed off (VI-22) | `club-scout.js` | `audit-club-metrics.test.mjs` |
| N6 — red cards: never observed vs zero | Corrected locally + verified | `club-scout.js` `totalOf` | `audit-club-metrics.test.mjs` |
| N7 — xPts rank on totals across unequal coverage | Corrected locally + verified | `club-scout.js` `rankCohort` | `audit-club-metrics.test.mjs` |
| N8 — the scout sentence prints an unknown assist rate as 0,00 | Corrected locally + **verified end to end** by the coordinator on the real application, desktop and mobile (`context/browser-candidate1-*`): « Production : 0,69 but par 90 min, note Vega 48 sur 100. », the baseline « 0,69 but et 0,00 passe décisive » captured before the code (§6.4: no post-implementation unit test) | `PlayerScoutOverview.jsx` | real-browser E2E (`context/browser-baseline-*`, `browser-candidate1-*`) |
| N9 — « Min. par but ou PD » and « Min / B+PD » count an unknown goal or assist as 0 (found in browser candidate 1) | Corrected locally + **verified end to end**: the coordinator's real-browser matrix (7 cases × desktop/mobile, KPI and table) went from 46 pass / 24 expected failures before the correction (`context/browser-contributions-red-*`) to **70/70** on the candidate, 14 views, stable source (`context/browser-contributions-green-*`) | `season-player.js` `contributionRate`, read by both displays of `PlayerScoutOverview.jsx` | `tests/audit-contribution-rate.test.mjs` (RED: helper absent; GREEN 3/3); browser matrix RED → GREEN |
| Match tabs — unknown xG and tackles become 0 | Corrected locally + verified | `match-tabs.js` | `tests/audit-match-tabs.test.mjs`, adjusted `match-tabs.test.mjs` |
| Cups, sources, nations | Handed off, unresolved (VI-19 / VI-21) | — | — |
| Interim (Astra, 17 Nov) — the embedded records' lowercase `penalty` not recognized; any non-opponent team read as the club's | Corrected locally + verified | `club-scout.js` `sidesOf`, `scoringOf`, `penaltiesOf` | `audit-club-metrics.test.mjs` (spelling, teams and flags) |
| Interim (Astra, 17 Nov) — a goal's NULL own-goal flag read as false (events and shots, server and client) | Corrected locally + verified; coverage may fall (below) | `calculator.py` `scoring`, `shot_sets`; `club-scout.js` | `OwnGoalFlagSupportTest` (1–3), `audit-club-metrics.test.mjs` |
| Interim (Astra, 17 Nov, P2) — xPts above ~700 xG: SQL underflow error, JS NaN, unbounded allocation | Corrected locally + verified (domain ≤ 100 xG a side, an engineering guard) | `club-scout.js`, 130 | `ExpectedPointsLawTest.test_5`, `audit-club-metrics.test.mjs` |
| Interim (coordinator, 17 Nov) — embedding counted NaN/±∞ as measured; one all-NaN row collapsed the geometry | Corrected locally + verified | `embedding.py` | `EmbeddingEligibilityTest` (6–8), `EmbeddingNonFiniteRefreshTest` |
| Stage 2 — the server's game states raise on a goal event without its score: the edition's whole recompute fails | **Recorded, handed off with B7** (baseline behaviour, `calculator._match_states`, unchanged) | — | post-implementation probe (evidence) |
| Stage 2→3 — `shotProfile`: normalized codes (and `ThrowInSetPiece`) and unknown situations fell into « jeu placé », another team's shots counted against, a missing xG added 0, a known zero xG became 0.01 (FAILURE_MODES §7.5) | Corrected locally + verified (one canonical parser shared with `penaltiesOf`; real sides; sticky-null bucket xG; zero kept; unclassified shots counted apart, points labelled « — »). **VI-22 handoff, resolved by VI-22** (`08955914db`, shipped 17 Nov 2026): an unknown map xG stays unknown and the `ShotPair` total is « — »; showing the unclassified count stays open | `club-scout.js` `situationOf`, `shotProfile` (exported for its test) | `audit-club-metrics.test.mjs` (4 shot-profile tests: RED 4 failures, GREEN) |
| Stage 3 — a fit that did not converge (or not finite, or infeasible) was published and every season rescored with it; the evaluator called such a comparison successful (Astra/xhigh interim review; real-fitter `iterations=0` probe) | Corrected locally + verified: `refresh` raises `xg.FitFailed` before the publication transaction, nothing changes; the evaluator reports `complete`/`status`/`failed_fits` and exits 3 | `xg.py` (`FitFailed`, `unpublishable`, `refresh`), `evaluate_xg.py` | `XgFailedFitTest` (1–3: RED, models replaced and 16,000 scores rewritten; GREEN), `XgEvaluationInputTest.test_6` |
| Stage 4 — the stage-3 `FitFailed` stopped the season's daily pass at the xG: embedding, breakout, actions, returns and the editions' recount never ran, in every due season (the model is global); flagged in stage 3, confirmed by Astra/xhigh (`context/astra-interim-xg-daily-review.md`) | Corrected locally + verified (FAILURE_MODES §10.3): `models.refresh_daily` catches `FitFailed` only, prints `daily models season=<s> xg=rejected error=FitFailed`, finishes the pass and re-raises it at the end, so the worker logs the step as failed with its backoff and no `outcome=ok`. A later error is the one logged; any other xG error still stops the pass at once | `models.py` `refresh_daily` | `DailyPassXgRejectionTest` (1–6, the real `Worker.daily()` on two due seasons: RED, tests 1–2 failed with each pass stopped at the xG; the 4 controls passed; GREEN 6/6) |
| Stage 5 (Astra F1) — the cohorts' position group (`grp`) read every match's minutes, unfinished ones included, while the statistics read finished matches: 10 finished attacking matches and 12 canceled defensive ones put a player in the defensive cohort | Corrected locally + verified (FAILURE_MODES §14.2): `grp` reads finished matches only; a cancellation after a publication moves the player at the next refresh | `models._player_values_sql` | `test_audit_player_aggregates.py::CohortRoleFinishedTest` (1–2: RED, player 10 absent from the 31-member attacking cohort; GREEN) |
| Stage 5 (Astra F2) — placement (own xGOT − own xG) required the opponent's xG, which it does not read | Corrected locally + verified (§14.3): own xG 1, xGOT 1.5, no opponent xG → 0.5 on 1 match, in the aggregate, `api.team_season` and the cohort's coverage | `calculator.py` (`placement_sum`, `placement_matches`) | `test_audit_club_aggregates.py::PlacementSupportTest` (1–2: RED 1 match / 0.2; GREEN 2 / 0.7, 0.35 per match) |
| Stage 5 (P1) — the selected club's finishing, keeper, conversion and xG per shot were null: `buildDossier` and `rebase` took it from a summary cohort (`shots: []`); once measured alone, it would rank 1 of 1 | Corrected locally + verified (§14.1): its four values and supports from its own full records of the reference's matches, on copies; inserted, its domestic values; below 5 measured clubs no rank and no reference median (an edge case added while writing the tests). Peers stay unmeasured. **Unresolved, VI-22:** the owned season totals (`ClubScoutAdvanced.jsx`, `ClubScoutTabs.jsx`) still multiply the mean by all matches and read null as 0 | `club-scout.js` `measuredSelf`, `SHOT_METRICS`/`MIN_MEASURED`, `rankCohort`, `buildDossier`, `rebase` (`buildDossier` exported for the tests) | `audit-club-metrics.test.mjs` (4 tests: RED, self values null and 3 measured instead of 4; GREEN). The coordinator's browser case checks the direct conversion card only |
| Stage 5 (P2) — shoot-out shots entered the client's scoring classification, penalty count, situation buckets and maps: a shoot-out goal made a complete 1–1 unclassified | Corrected locally + verified (§14.4): one predicate (`period` `penalties` / `Penalties`) in the three loops; an in-match penalty stays | `club-scout.js` `matchShots` | `audit-club-metrics.test.mjs` (shoot-out test: RED, finishing null; GREEN) |
| Stage 5 (P2) — the player page and its history summaries counted unfinished matches (canceled, in play, postponed…) in the KPIs, the contribution rate and the « Production » sentence | Service boundaries corrected locally + verified (§14.2); **the rendered profile was not**: the coordinator's browser still showed 260 min / « 87′ » (`review-evidence/browser-stage5-green/`, a failed validation), corrected in stage 6 (row below): `finishedAppearances` before the generic aggregators at the summary boundaries (page subject and local cohort, current season, fresh and cached history, competition and date narrowing); status by match id from records then fixtures; unknown excluded. The match logs keep every observation (`{ log: true }`, `playerSeasonLog`); the raw reads, cache and aggregators are unchanged. The UEFA snapshot's matches say `finished`. Three fixtures without the API's status gained it, assertions unchanged | `season-player.js`, `actor-reads.js`, `scouting-history.js`, `player-season-history.js`, `player-career.js`, `uefa-nations-snapshot.js`, `PlayersPage.jsx`, `PlayerMatchesPage.jsx` | `tests/audit-finished-summaries.test.mjs` (6 RED → GREEN; the log characterization green before and after); adjusted `navigation-performance`, `player-season-history`, `player-season-selected`. At stage 5 the page lacked a render harness; stage 6 adds it and the actual browser confirms 170 min, 2 matches, « 57′ » |
| Stage 5 (P2) — a NaN or infinite half xG passed the halves' completeness and turned the player's half xG into NaN | Corrected locally + verified (§14.5): a complete half needs a finite xG; the structural zero and a finite zero-shot xG stay | 129 | `HalvesNonFiniteXgTest` (1–2: RED; 3: control, green throughout) |
| Stage 5 (P3) — `api.match_xpts` called the plpgsql law once per output column (4 per row) | Corrected locally + verified (§14.6): `CROSS JOIN LATERAL agg.xpts_v2(...) x`, one function scan; values, NULL rows, columns unchanged; no speed claimed | 130 | `ExpectedPointsLawTest.test_6` (RED: 64 calls for 16 rows; GREEN: 16); plans before and after in `evidence/stage5/` |
| Stage 6 — `PlayerSeasonProfile` re-aggregated the raw rows, so `PlayersPage`'s finished `subject` (stage 5) reached only the radar's eligibility: the rendered overview, rail, strip, cohorts and Matchs tab counted the canceled match (browser: 260 min / « 87′ » for 170 / « 57′ ») | Corrected locally + verified at the component level (§15, Astra's bounded wiring): `summaryProfile` = the finished subject and `scopeRows` = the summary rows; `profile = summaryProfile ?? logProfile`; raw rows for presence, playing time and the Matchs log (`PlayerGames` `logRows`); the guard reads `logProfile.matches`; the club falls back to the raw rows; bookmark and comparison read the resolved identity. **Coordinator browser GREEN: 42/42 plus legacy-history 8/8, stable source** | `PlayersPage.jsx`, `PlayerSeasonProfile.jsx`, `PlayerScoutOverview.jsx` (`PlayerGames`) | `tests/audit-profile-wiring.test.mjs` (render regression written before the code: 4 RED → GREEN, 1 characterization green throughout); browser RED `review-evidence/browser-stage6-red2/` (`browser-stage6-red/`: a superseded contract error) |
| Stage 7 (v2, Opus minor 4) — the non-compact performance card ranked against every appearance: canceled matches counted toward the 30 peers and moved the centiles (`PlayerDetails.jsx:84`) | Corrected locally + verified at the component level (§16.1): the peers are `finishedReadAppearances(f.performanceData)`, one array per read, which the context's idle warm-up now prepares; the opened performance, the raw index, the match display and `matchGradeRank` stay raw | `PlayerDetails.jsx`, `season-player.js`, `FootballContext.jsx` (warm-up) | `tests/audit-player-boundaries.test.mjs` (3 tests: RED, « Centile parmi 34 » with canceled peers; GREEN) |
| Stage 7 (v2, Opus minor 4) — the non-compact comparison aggregated the raw season, reused or loaded (`PlayerComparison.jsx:137-149`) | Corrected locally + verified (§16.1): `finishedAppearances(data, rows)` before `aggregateSeasonPlayers`; raw caches, filters and the compact branch unchanged; no finished match → the named empty profile | `PlayerComparison.jsx` | `audit-player-boundaries.test.mjs` (2 tests: RED [4, 330, 7] for [2, 170, 2]; GREEN) |
| Stage 7 (v2 nit) — `opponentStrength` returned `{ club, centile: null }` below five measured clubs; the owned `Upcoming` showed the weakest level | Corrected locally + verified (§16.2): null without a centile. **Residual, VI-22:** null renders « hors référentiel » even for a thinly measured club of the reference | `club-scout.js` `opponentStrength` | `audit-club-metrics.test.mjs` (RED: the null-centile object; GREEN) |
| Stage 7 (v2 nit) — both grade tooltips printed `goals ?? 0` and `assists ?? 0` | Corrected locally + verified at the component level (§16.3): unknown « — », known « 0 », at both sites; grades, plots and logs unchanged. **Real-browser GREEN12/12 passed**, desktop/mobile on stable stage7 code, after the pre-fix RED (`review-evidence/browser-stage7-red/`: 8 expected failures, 4 passing zero controls) | `PlayerScoutOverview.jsx` (`RecentForm`, `PlayerGames`) | `audit-player-boundaries.test.mjs` (2 tests through the charts' `tip`: RED « 1 / 0 », « 0 / 0 »; GREEN) |
| Stage 7 (v2 nit) — `shootersOf` counted shoot-out kicks in the match's shooters (`match-tabs.js:54`, `MatchKpis.jsx:35`) | Corrected locally + verified (§16.4): the `penalties` / `Penalties` predicate; in-match penalties and extra time stay; sticky missing xG and inputs hold | `match-tabs.js` | `audit-match-tabs.test.mjs` (service test and an actual `MatchKpis` render: RED, a shoot-out-only shooter listed; GREEN) |
| Stage 7 (v2, Opus major 1) — if goals lack the own-goal flag, the four classified indicators are measured on goalless matches only | **Superseded by stage 8 (§17)** — measured on production: goal shots never carry FALSE, so it happened to 99.4 % of the matches with a goal. Previously: **recorded; accepted contract retained** (Astra's reconciliation): per-indicator measured support stays. No whole-scope suppression, inferred flag, backend marker or migration: that would need a new joint design. Root's probe: a classified 0–0 and an unflagged 1–0 give finishing −1, keeper 0.7, conversion 0, xG per shot 1, each on 1 match. Not an unbiased season estimate. The source contract and incidence stay with VI-21; presenting coverage without extrapolating to season totals stays with VI-22 | docs (§16.6, `04-clubs/01`) | root's probe `review-evidence/review-v2-probes*` (exploratory) |
| Stage 8 (final review of the rebased branch, 17 Nov, BLOCKER) — goal shots' own-goal flag is TRUE or NULL in production, never FALSE: finishing, keeper, conversion and xG per shot measured on goalless matches only (Le Havre's conversion 0,0 %, Paris's keeper « — ») | Corrected locally + verified (§17): one scoring per match, `agg.match_scoring` (132), own goals from the goal events' teams (the side credited), penalty attempts from the shot set reconciled with them; read by the calculator and by every club, league and Europe match record (`ownGoalsFor`, `penaltyAttempts`); the site reads the fields only. Production read-only: 98.9 % of 2026's matches with shots classified (55 % under the calculator's previous running-score rule) | `132_match_scoring.sql`, `calculator.py`, `match-record.mjs`, `actors.mjs`, `europe.mjs`, `club-scout.js` | `MatchScoringTest` (a–o: RED, the view missing; GREEN), `OwnGoalFlagSupportTest` 3–4 (RED; GREEN), `actors.test.mjs` and `europe.test.mjs` scoring (RED; GREEN), `audit-club-metrics.test.mjs` (7 RED; GREEN 24/24) |
| Stage 8 (same review, HIGH) — summary reads carry no shot list: every peer unmeasured, « — sur N » ranks, the pizza's axes, the « Finition et gardien » phase and the Vega index lost for every club | Corrected locally + verified with the blocker: the fields are in the summary records; a league's clubs are measured from their summaries (the Europe pool still lacks xGOT and npxG: its peers' keeper and xG per shot stay unmeasured) | as above | `audit-club-metrics.test.mjs` « every club of the league is measured from its summary », « a rank of the four needs five measured clubs » |
| Stage 8 (found while measuring) — the calculator's goal-event rule read the running score after the goal; the source stores it before the goal in about half the matches (15,898 of 32,778 goals in 2026) | Corrected locally + verified: the running score is no longer read (§17.2); fixtures whose own-goal events carried the scorer's team now carry the side credited, as production (16,879 of 16,880 goals) | `132_match_scoring.sql` | `MatchScoringTest.test_m` (both conventions) |
| Stage 8 (same review, MEDIUM / LOW) — recompute queue order, deploy order, 128's backfill under its lock, a manual xG refit racing the daily pass, missed renumbering references, stale docs, `club-supported.js` fallbacks, local databases migrated under the old names | Fallbacks removed (test first); references and docs corrected; the rest is the rollout procedure (below and the Linear issue) | `club-supported.js`, docs | `club-supported.test.mjs` (RED; GREEN) |
| Stage 7 (v2, Opus major 2) — the owned SetPieces display adds a null category xG as 0 | **Handed off, unresolved (VI-22)**: `ClubScoutAdvanced.jsx:235-236`, `:287-288` (table below). The truthful category nulls stay | — | root's probe (1.2 shown for an unknown fast-break category plus 1.2 at corners; 0 when all null) |
| Stage 7 (v2, Opus minor 3) — a rejected refit leaves new shots unscored | **Recorded (docs)**: the scores already published stay; shots ingested since have no Vega xG; a modified shot keeps its previous score; during a version transition the previous version's scores stay. Retry after the daily backoff; no older-model fallback. The accepted rejection contract (no model and no score written) is unchanged | docs (`02-metriques-attendues/05-xg-vega.md`, §16.6) | existing `XgFailedFitTest`, `DailyPassXgRejectionTest` |
| Stage 7 (v2 nit, optional) — `rebase`'s `copy` recomputed `pairedFields` once per nullish key | Refactored: at most once per copied club, provided values (zeros included) kept | `club-scout.js` `rebase` | the existing rebase tests (no new test) |
| Stage 5 — `models._team_index` ranks xPts on totals under partial coverage | **Recorded, producer limitation**: no route reads `agg.team_index.xpts_position`; N7 is corrected on the site only | — | — |

## VI-22 consumer handoff

**Status, 17 Nov 2026 (stage 8):** VI-22 shipped every display item below (`08955914db`), except the
halves route's exclusions and B7, which stay with their owners. The summary-read recommendation at the
end of this section is done by stage 8 (§17): every match record carries each side's scoring.

The service publishes the paired fields; these owned lines still compute unpaired values and must
switch (FAILURE_MODES §11, corrected in stage 5 by the current expressions, §14.7). Lines: the owner
snapshot (`review-evidence/owner-source/vi22`, hashes in `owner-source-manifest.json`), then this
branch's copy in brackets.

| Consumer | Today | Replacement |
|---|---|---|
| `ClubScoutTabs.jsx:87` [86] `IdentityRail`; `:292-299` [291-298] « Points · xPts » | `record.points − xptsTotal` | `pairedPointsDelta`, with `pairedActualPoints`, `pairedExpectedPoints` and `pairedMatches` |
| `ClubScoutUI.jsx:1503` [1463] `LeagueTable` | `record.points − xptsTotal` | `pairedPointsDelta` |
| `ClubScoutUI.jsx:1566-1568, 1618` [1526-1528, 1578] `ExpectedGapTable` | `(record.points − xptsTotal) ÷ record.matches`; `xptsTotal ÷ record.matches` | paired actual, expected and delta ÷ `pairedMatches`, not all matches; no paired match → NULL, never 0 |
| `ClubScoutUI.jsx:1472-1474` [1432-1434] `LeagueTable` xG difference | `(values.xg ?? 0) × rows.length − (values.xga ?? 0) × rows.length` | `pairedXgDelta` |
| `ClubScoutTabs.jsx:388-391` [387-390] « Diff. xG / match » | `(v.xg ?? 0) − (v.xga ?? 0)`, with an arrow | `pairedXgDeltaPerMatch`; unknown → unavailable, no 0 and no arrow |
| `ClubScoutAdvanced.jsx:328-342` (this branch only; not in the snapshot) finishing, placement and keeper KPIs; `ClubScoutTabs.jsx:325` [324] « Buts évités par le gardien » | `(values[key] ?? 0) × record.matches`, arrow read from `?? 0` | `values[key] × coverage[key]` (that metric's own support), with finite / null guards; missing → unavailable, no 0 and no « up » arrow |
| `ClubScoutAdvanced.jsx:346` « Conversion » | `` `${fmtNum(values.conversion, 1)} %` `` | missing → unavailable (not « — % ») |
| `ClubScoutTabs.jsx:280-281, 303-319` [279-280, 302-318] « Buts · xG », « Encaissés · xG contre » | `record.gf − (v.xg ?? 0) × record.matches` (and `ga`, `xga`) | actual goals **and** xG on one explicit matched support. The paired xG fields carry no paired actual goals: replacing only the xG while keeping `record.gf` stays wrong. The service provides no paired goals field yet |
| `ClubScoutUI.jsx:1015-1037` | adds and renders game-state durations | B7 contract (§8) |
| `profiles.mjs` halves route | publishes complete halves only, without saying how many were left out | read `excluded_matches`, `excluded_minutes` (129) |
| Club similarity (`agg.team_percentiles`) | reads `covered_matches` | now the true count per indicator: some clubs' axes fall under the 5-match gate |
| `ClubScoutAdvanced.jsx:235-236` `setXg`, `:287-288` « Contre-attaques et CPA réunis » (this branch only; not in the snapshot) | adds a null category xG as 0: an unknown fast-break xG beside 1.2 at corners shows 1.2; all-null categories show 0 | unavailable when any included category is null, all-null unavailable, all-known summed and an observed 0 kept, « for » and « against » alike (FAILURE_MODES §16.6) |
| `ClubScoutTabs.jsx:482-485, 526` [481-484, 525] `Upcoming` | `opponentStrength` null (stage 7: no centile below five measured clubs) prints « hors référentiel » and hides the position | wording that distinguishes a club outside the reference from an insufficiently measured one |

The stage-2 version of this table cited `ClubScoutUI.jsx:1463, 1528, 1577-1578` as `values.xg − values.xga`; those lines are the points gaps above. Summary cohorts lack the four shot metrics: the dossier's club is measured from its own full read, its peers are unmeasured (not 0). A future summary read must supply each side's own-goal **and** penalty-attempt classification, with its coverage, before peers can be measured.

## Halves: coverage loss

A half counts only when every statistic the route reads is known (129). On the committed real
fixture `match_m_08LEIz` (`players_halves.json`, sha256 `d70d442a…`), 46 of 50 played halves stay
(1,800 minutes) and 4 are left out (180 minutes), all four for missing touches
(`context/half-fixture-coverage.json`). That is one match sheet, not production incidence. The
view counts the exclusions; the owned route does not publish them yet.

## Own-goal flags: accepted contract and its coverage

The accepted contract (Astra/xhigh interim own-goal review) reads a goal as ordinary only when its
flag says false: a goal shot or goal event whose `is_own_goal` is NULL leaves its match unclassified.
`normalize.py` keeps an absent flag as NULL and sets true for the provider's `OwnGoal`; an ordinary
`Goal` establishes no false. The repository's `test_pilot.py` payload (one `Goal` without the flag)
is **synthetic**: Astra checked it (score 2–0, empty events; its assertions cover ingestion, xG,
completion, re-import and sanitisation, not a complete scoring classification). It is no provider
evidence that a missing flag means false, and it stays unchanged. No user decision is needed: the
contract stays « unknown », and the source-contract clarification belongs to VI-21.

Coverage consequence, if real ordinary goal shots carry no flag: every match with a goal is
unclassified for the site's finishing, keeper, conversion and xG per shot (they read the embedded shot
list), and for the server's xG per shot (`core.shots`). The server's finishing, keeper and conversion
read the goal events. **Corrected in stage 7:** this report said those events' flags were explicit
(false) in the committed real fixture, as if that settled goal events. The fixture
(`match_m_08LEIz/events.json`) holds 13 yellow cards and 7 substitutions, and no goal. Its false flags
establish nothing about how goal events are flagged; its 25 shots carry no own-goal key and no goal.
Both scoring sources' contracts and their real-data incidence remain unverified (VI-21).

**The measured support can depend on the outcome** (stage 7, Astra's reconciliation of the v2
reviews). If ordinary goals lack the flag, only goalless matches classify. Root's probe pairs a classified
0–0 with a 1–0 whose goal has a null flag: finishing −1, keeper 0.7, conversion 0 and xG per shot
1, each on that one 0–0. The accepted contract computes each indicator on its measured support and
is kept: no match is invented or dropped from the scope wholesale. These values are therefore not an
unbiased season estimate, and the synthetic checks prove the arithmetic only. A whole-scope rule
would need a new joint design (scope, sources, rollups, migration and API).

## Reviewed integration with VI-22's similarity

The coordinator ran VI-23's real calculator and cohort refresh, then VI-22's unchanged similarity
handler and read role, on a dedicated local database (`context/combined-style-README.md`,
`combined-style-result.json`): 9/9 declared checks passed, with stable source fingerprints in both
worktrees and VI-22's migration 123 applied after VI-23's. A sparse club (3 of 8 covered matches on
four style axes) is excluded and a complete neighbour retained, from true covered counts, without
injected percentiles. This validates the combination on synthetic data, not production neighbour
quality or VI-22's UI. After stage 5 the coordinator reran this workflow (9/9), then the actual `store.migrate` ordering with 123 before 124–127 (9/9), using an evidence-only, byte-identical SQL bundle. Both source snapshots stayed stable; stage 6 changed none of these dependencies. Raw runs: `review-evidence/combined-style-stage5/` and `combined-style-stage5-ordered/`.

## Embedding: retention and imputation

`profile-embedding-v2` places a player only when he knows at least 90 % of the statistics kept (a
known value is a finite number), the columns and the rows being found together by a fixed point.
At most 10 % of a placed player's statistics are imputed with the season's mean (0 once
standardised); any two placed players share at least 80 % of the statistics as observations. A
season with fewer than 200 placed players has no vectors. How many players production loses is not
measured (real-data validation unavailable). Operational note: a season of 200 or more players of
450 minutes but fewer than 200 eligible ones stays due for the worker after each one-hour wait, as a
season with too few usable statistics already did.

## xG: constraints and reduced flexibility

`xg-v2` bounds five terms (`distance`, `distance_sq`, `header_distance` ≤ 0, `angle` ≥ 0,
`angle_distance` = 0), so the chance of a goal can neither grow with the distance nor fall when the
angle opens. This removes flexibility: on a synthetic input drawn from a rising model (seed 7,
cutoff 2025-01-01, 48,994 shots), the constrained fit's out-of-time log loss is 0.31192 against
0.31113 for the free fit (`evidence/stage2/xg-evaluation/report-seed7-cutoff-2025-01-01.json`,
sha256 in the report). **No predictive improvement is claimed**, on synthetic or real data; the
version has not been evaluated on real shots. The evaluator never presents an event-time reading as
an as-known replay. Python and SQL use the same logit, bounded at ±30.

## Clock definition and version boundary (B7, unresolved)

The proposed regulation clock (FAILURE_MODES §8): a first-half event at min(minute, 45), a second-half
event clamped to [45, 90], stoppage time collapsed to its half's end, extra time and the shoot-out
adding no duration; a missing period read only where unambiguous; a match after 90 with an
ambiguous period rejected from the durations (`excludedDurationMatches`) while its order-based
outcomes stay. These are **declared** regulation-clock minutes, not recovered elapsed time. Seasons
computed with the old and the new definitions are not comparable until recomputed; the owner must
version the change. Proposed tests and their RED logs: `evidence/b7-handoff/`. Not delivered.

## Migration and recompute (« Recalcul »)

**Migrations** (new files only; 123 is VI-22's, 124 the domestic cups' projection, 125 the Nations League's, 126 and 127 VI-19's; renumbered from 124–127 when VI-23 was rebased on main on 17 Nov 2026, then 125–128 and 126–130 the same day): `128_finished_player_seasons.sql`,
`129_complete_half_totals.sql`, `130_expected_points_law.sql`, `131_paired_club_indicators.sql`,
and stage 8's `132_match_scoring.sql` (two views, `agg.match_scoring` and `api.match_scoring`),
applied in order by `vega.store.migrate` (each file commits alone). No existing migration and no
generated file (009, 012, 015, `api_schema.py`) changes; their drift tests stay green.

**Backfills.** 128 fills the new `finishing_*` columns of `agg.player_list_editions` from the
finished `player_match_stats` in the migration itself. 129 and 130 replace views and add a function:
no data to backfill. 131 adds the `pair_*` columns empty: until an edition is recomputed, its 13
paired club indicators are unavailable, never a value of the old definition. 132 adds views only:
the match records read it at once, with no backfill.

**Deploy order** (final review, 17 Nov). The push deploys the site (Vercel); the API, the worker and
the migrations go out with the manual « Deploy » workflow, to dispatch right after the push and in a
quiet window: until the API serves `profile-3` and the stage-8 match records, the site's « Efficaces »
and « Maladroits » are empty and the four club indicators unknown. 128's backfill `UPDATE` runs under
its `ALTER`'s lock and blocks readers of `api.player_list_editions` while it runs (as 116 did).

**ALL-SCOPE recompute** (on the deployed database, by its operator; nothing here was run outside the
dedicated local databases):

1. *Pre-check, read-only.* Goal events that crash the game states (the B7 defect above):
   ```sql
   SELECT e.season_id, e.match_id FROM core.match_events e
   JOIN core.match_coverage c ON c.season_id = e.season_id AND c.match_id = e.match_id AND c.events = 'ok'
   JOIN core.matches m ON m.id = e.match_id AND m.season_id = e.season_id AND m.status = 'finished'
   WHERE e.event_type = 'goal' AND e.period IS DISTINCT FROM 'penalties' AND e.minute IS NOT NULL
     AND (e.score_home IS NULL OR e.score_away IS NULL);
   ```
   An edition listed there fails its recompute and stays queued (baseline behaviour): resolve it with
   its owner first.
2. *Every edition, in batches.* The calculator drains its queue oldest first, 500 scopes per pass,
   inside the collection process (final review, 17 Nov): queued at once, the live editions would wait
   behind the whole backlog. Queue the current season's leagues first, outside match windows, then the
   older seasons, the cups and the archives last; each batch drains before the next. The statement for
   one batch (restrict `cs.id` to the batch):
   ```sql
   INSERT INTO ops.dirty_scopes(scope_kind, competition_season_id)
   SELECT 'competition_season', cs.id FROM core.competition_seasons cs
   ON CONFLICT (scope_kind, player_id, team_id, competition_season_id, cohort_id)
   DO UPDATE SET revision = ops.dirty_scopes.revision + 1, queued_at = now();
   ```
   This applies B1 (finished matches only, stale rows deleted), the player list and peers (128), the
   xPts law (130), the paired club supports (131) and placement's own support (stage 5). The club
   and player cohorts follow through `models.process_cohorts` (club cohorts read
   `club-indicators-v2` with true covered counts; a player's position group reads his finished
   matches, stage 5).
3. *Season models.* Let the worker's daily pass fit `xg-v2` (no `xg-v2` model exists, so it fits one
   and rescores every season's shots): a manual `xg.refresh` racing it would make the second
   publication fail on its unique key and abort that season's pass once (final review). The same pass
   rebuilds `returns-v2`. For **every** season with editions,
   including those older than 400 days that the worker no longer schedules:
   `embedding.refresh(conn, season)`. Within 400 days the worker also does this on its own, a model
   of another version being due.
4. *Post-checks, read-only:*
   - `SELECT count(*) FROM ops.dirty_scopes WHERE scope_kind IN ('competition_season','cohort')` → 0 after draining;
   - `SELECT count(*) FROM agg.team_season_stats WHERE pair_field_tilt_n IS NULL` → 0;
   - `SELECT DISTINCT version FROM agg.xg_models` → `xg-v2`; `SELECT DISTINCT version FROM agg.return_curves` → `returns-v2`;
   - `SELECT version, count(*) FROM agg.embedding_models GROUP BY 1` → `profile-embedding-v2` only;
   - `SELECT formula_version, count(*) FROM agg.calc_runs WHERE kind = 'percentiles' AND cohort_definition LIKE 'team:%' AND status = 'published' GROUP BY 1` → `club-indicators-v2`.

**Version boundary.** Until step 2 has drained, a page can mix recomputed and not-yet-recomputed
editions. Values computed before the recompute (season aggregates with unfinished matches, xPts v1,
v1 vectors, v1 xG, v1 returns) are not comparable with those after. Migrations are forward-only: a
revert is a new migration plus the same recompute.

## Verification (stage-7 GREEN run, 17 November 2026)

`prototypes/calculation-audit/evidence/stage7/green/run_green_stage7.py`; the RED run before the code:
`evidence/stage7/red/` (10 of 10 declared failures failed, every other test of the 34 affected files
passed). Stage 7 changed seven site files, three test files and documentation; no Python or API file
(the 24 backend files hashed in `green/environment.json` equal stage 6's), so those suites were not
rerun. The sources' hashes were the same at the end of the run as at its start.

| Suite | Result | Footer |
|---|---|---|
| Site, targeted (the 34 files loading a changed module) | 179 passed | TAP footer agrees |
| **Site, full** (127 files) | **662 passed**, 0 failed, 0 skipped (652 + 10) | agrees; every test attributed by a per-file rerun |
| Declared stage-7 tests | 10 / 10 pass | — |
| **Dashboard build** | compiled, 17/17 static pages, then the Next.js 16.4.3 advisory stop (exit 1); the identical retry exited 0. No dependency change | — |

Python388/API173 stand from stage5 on identical backend files. Coordinator final browser on stage7:
tooltips12/12, summary42/42, legacy8/8, contributions70/70; all132 assertions passed, desktop/mobile,
source stable. Raw evidence: review-evidence/browser-stage7-green, browser-stage7-summary-green2,
browser-stage7-legacy-green and browser-contributions-stage7. The earlier summary-green run is a
retained fixture-order setup failure38pass/4fail: previous zero goals were not restored. An explicit
complete_positive fixture restoration fixed setup; no source or assertions changed. Both wrappers/logs retained.

## Verification (stage-6 GREEN run, 17 November 2026)

`prototypes/calculation-audit/evidence/stage6/green/run_green_stage6.py`; the RED run before the code:
`evidence/stage6/red/` (4 of 4 declared failures failed, every other test passed). Stage 6 changed three
site files, one test file and documentation; no Python or API file (their hashes, recorded in
`green/environment.json`, equal stage 5's), so those suites were not rerun. The sources' hashes were the
same at the end of the run as at its start.

| Suite | Result | Footer |
|---|---|---|
| Site, targeted (`audit-profile-wiring` and the eight affected player files) | 47 passed | TAP footer agrees |
| **Site, full** (126 files) | **652 passed**, 0 failed, 0 skipped (647 + 5) | agrees; every test attributed by a per-file rerun |
| Declared stage-6 tests | 5 / 5 pass (4 RED before the code, 1 declared pass) | — |
| **Dashboard build** | compiled, 17/17 static pages, then the Next.js 16.4.3 advisory stop (exit 1); the identical retry exited 0. No dependency change | — |

Python 388 and API 173 stand from stage 5, on identical backend files (all paths compared against the archived stage-5 snapshot). The coordinator then ran the actual app/API/read role:

- Finished summary versus raw observations: **42/42**, desktop/mobile, including no finished appearance; `review-evidence/browser-stage6-green/`.
- Legacy raw-history route: **8/8**, desktop/mobile; `review-evidence/browser-stage6-legacy-green/`.
- Prior contribution matrix: **70/70**, 7 cases and 14 views; `review-evidence/browser-contributions-stage6/`. All statuses were restored to finished before this matrix.

Every run preserved exact setup, inputs, rerun commands, raw API output, snapshots/screenshots and stable source hashes. The valid pre-fix stage-6 browser RED had 26 passes and 16 expected failures. The main run's optional empty competition-row extraction was made safe before GREEN, without changing expectations; the preliminary contract error remains archived. This is synthetic local validation, not production acceptance.

## Verification (stage-5 GREEN run, 17 November 2026)

`prototypes/calculation-audit/evidence/stage5/green/run_green_stage5.py`, same database and guarded
reset; the RED run before the code: `evidence/stage5/red/` (18 of 18 declared failures failed, every
other test passed, `as_expected: true`). The sources' hashes were the same at the end of the GREEN run
as at its start.

| Suite | Result | Footer |
|---|---|---|
| Python, targeted (`test_audit_player_aggregates`, `test_audit_club_aggregates`, `test_calculator`, `test_models`) | 78 passed | unittest footer agrees |
| Site, targeted (`audit-club-metrics`, `audit-finished-summaries`, the three adjusted files, `player-career`, `uefa-nations-snapshot`) | 56 passed | TAP footer agrees |
| **Python, full** | **388 passed**, 0 failed, 0 errors, 0 skipped (380 + 8) | agrees |
| **API, full** (32 files, `--test-concurrency=1`) | **173 passed**, 0 failed, 0 skipped | agrees; every test attributed by a per-file rerun |
| **Site, full** (125 files) | **647 passed**, 0 failed, 0 skipped (635 + 12) | agrees; every test attributed by a per-file rerun |
| Declared stage-5 tests | 20 / 20 pass (18 RED before the code, 2 declared passes) | — |
| **Dashboard build** | compiled, 17/17 static pages, then the Next.js 16.4.3 advisory stop (exit 1); the identical retry exited 0. No dependency change | — |

`api.match_xpts`'s plan, before and after (`evidence/stage5/red/explain-match-xpts-before-with-season.txt`,
`green/explain-match-xpts-after-with-season.txt`): four expanded calls in the join's output, then one
`Function Scan on agg.xpts_v2`; the same ten columns and types. No speed is claimed. The stage-5
browser first exposed the remaining profile wiring defect; the stage-6 verification above supersedes that failed run.

## Verification (stage-4 GREEN run, 17 November 2026)

`prototypes/calculation-audit/evidence/stage4/green/run_green_stage4.py`, same database and guarded
reset. Stage 4 changed `models.py` (`refresh_daily`), `test_audit_models.py` and documentation; the
site, API and build read none of them and were not rerun. The sources' hashes were the same at the
end of the run as at its start.

| Suite | Result | Footer |
|---|---|---|
| `DailyPassXgRejectionTest` + `XgFailedFitTest` | 9 passed | unittest footer agrees |
| **Python, full** | **380 passed**, 0 failed, 0 errors, 0 skipped (374 + 6) | agrees |
| within it | `test_audit_models` 16, `test_models` 33, `test_worker` 43, `test_xg` 5, `test_audit_xg_evaluation` 6, `test_audit_club_aggregates` 14, `test_audit_player_aggregates` 10, `test_calculator` 13 | — |

The real-browser N9 matrix was rerun by the coordinator on the stage-3 candidate: 70/70
(`context/browser-contributions-green-*`). Stage 4 touched no site file.

## Verification (stage-3 GREEN run, 17 November 2026)

`prototypes/calculation-audit/evidence/stage3/green/run_green_stage3.py` on the same dedicated local
PostgreSQL, after the same guarded reset. Stage 3 changed `xg.py`, `evaluate_xg.py`, `club-scout.js`,
`season-player.js` and `PlayerScoutOverview.jsx`. Their hashes, and those of the stage-3 tests and the
spec, were unchanged from the start of the run to its end. The API suite was not rerun: no API source,
seed or test reads a file stage 3 changed.

| Suite | Result | Footer |
|---|---|---|
| Python, targeted (`XgFailedFitTest`, `XgVersionTest`, `test_audit_xg_evaluation`, `test_xg`, `ConstrainedXgTest`) | 21 passed | unittest footer agrees |
| Site, targeted (`audit-contribution-rate`, `audit-club-metrics`, `audit-player-support`) | 27 passed | TAP footer agrees |
| **Python, full** | **374 passed**, 0 failed, 0 errors, 0 skipped | agrees |
| **Site, full** (124 files) | **635 passed**, 0 failed, 0 skipped | agrees; every test attributed by a per-file rerun |
| **Dashboard build** | compiled (incremental), 17/17 static pages, then the Next.js 16.4.3 advisory stop (exit 1); the identical retry exited 0. No dependency change | — |

Against stage 2 (Python 370, site 628): 4 new Python tests (`XgFailedFitTest` 1–3, `test_6`) and 7 new
site tests (3 for N9, 4 for the shot profile), each RED before its correction
(`evidence/stage3/red/`). A first stage-3 attempt passed its targeted suites but did not start the
full Python suite (the runner's `unittest -v discover` argument order, exit 2): it is kept in
`evidence/stage3/green/attempt-1-harness-error/` and was rerun whole.

## Verification (stage-2 GREEN run, 17 November 2026)

`prototypes/calculation-audit/evidence/stage2/green/run_green.py`, on the dedicated local PostgreSQL 18.6
(`127.0.0.1:55429`) after the guarded reset of the six databases whose suites leave an `api` schema.
Python 3.12.11, Node 26.4.0, Bun 1.4.4. Only documentation changed after the run started (checked by
file hashes and modification times).

| Suite | Result | Footer |
|---|---|---|
| Python, audit files | 49 passed, 0 failed, 0 errors, 0 skipped | unittest footer agrees |
| Python, adjusted files (`test_calculator`, `test_models`, `test_worker`, `test_xg`) | 94 passed | agrees |
| API, audit files (3, one by one) | 32 passed | TAP footers agree |
| Site, audit files (4, one by one) | 28 passed | agree |
| **Python, full** (`unittest discover -s backend/tests`) | **370 passed**, 0 failed, 0 errors, 0 skipped | agrees |
| **API, full** (32 files, `--test-concurrency=1`) | **173 passed**, 0 failed, 0 skipped | agrees; each test attributed by a per-file rerun (sums equal) |
| **Site, full** (123 files) | **628 passed**, 0 failed, 0 skipped | agrees; per-file rerun sums equal |
| B7 handoff (outside the suites) | Python 1 failed, site 13 failed: still RED as intended, the same differences as in stage 1 | — |
| Declared stage-1 tests | 96 of 96 as expected: 82 runnable now pass, 14 B7 tests still RED | — |
| **Dashboard build** (`bun run build`) | compiled (2.4 s, 17/17 static pages), then Next.js 16.4.3 stopped with exit 1 to show a security advisory; the identical command, retried, exited 0. No dependency was upgraded. | — |

Against stage 1 (Python 362, API 173, site 627): the 8 new Python tests and the 1 new site test are
the interim findings' tests, each RED before its correction (`evidence/stage2/red-contract/`).

## Test-contract corrections made in stage 2

All were made before the code they cover, except the two precision tolerances, which were
infeasible against any implementation. Each keeps the baseline failing.

| Test | Correction | Why |
|---|---|---|
| `test_audit_club_aggregates.py::ServerIndicatorSupportTest.test_2` | 9 decimal places → rel. 1e-6 | `agg.team_percentiles.value` is a `real` (009); the baseline gives 56.61 for 49.76 |
| `test_audit_models.py::XgVersionTest.test_2` | rel. 1e-9 → 2⁻²³ (one float4 step) | `agg.shot_xg.xg` is a `real` (080); the baseline gives 2.9e-20 for 9.4e-14 and overflows at −800 |
| `tests/audit-club-metrics.test.mjs` fixtures | every shot carries an observed situation (normalized `regular_play`), every goal an explicit `isOwnGoal`, every row the match's real sides | the API's shapes (§7.2); the unknown-classification, spelling, team and flag cases were added RED first |
| Stage-1 amendment items | applied before stage 2 (§7.2/§7.3/§10.1/§11, B7 ambiguity) | coordinator review and Astra amendment |
| `test_audit_models.py::XgFailedFitTest` (stage 3, before its first RED) | `generate_series` bounds cast to integer; the snapshot comparison kept exact but its failure message bounded | two fixture typing errors; the coordinator stopped a run whose unittest diff of 12,000 score rows was CPU-bound (`evidence/stage3/red/coordinator-interruption.json`) |

## Evidence

All under `prototypes/calculation-audit/` in the worktree (ignored by git; never committed):

| Evidence | Path |
|---|---|
| Stage-1 RED run (declared expectations, logs, environment, comparison) | `evidence/red/` (`README.md`, `expected.json`, `comparison.json`) |
| B7 handoff (contract, 13 cases, proposed tests, RED logs) | `evidence/b7-handoff/` |
| Stage-2 interim RED, before each correction | `evidence/stage2/red-contract/` (client, server, embedding logs; per-case client values before and after) |
| Stage-2 GREEN run (full suites, footers reconciled, dashboard build) | `evidence/stage2/green/` (`run_green.py`, `environment.json`, `results.json`, `comparison.json`, logs) |
| Post-implementation probe of the server's classification rules | `evidence/stage2/probes/` |
| Synthetic xG evaluation | `evidence/stage2/xg-evaluation/`; stage 3, complete and capped at 0 iterations: `evidence/stage3/xg-evaluation/` |
| Stage-3 RED before each correction, and GREEN | `evidence/stage3/red/`, `evidence/stage3/green/` (`run_green_stage3.py`, `environment.json`, `results.json`, logs) |
| Stage-4 exploratory probe, RED and GREEN (the daily pass) | `evidence/stage4/` (`README.md`, `probes/`, `red/`, `green/`) |
| Stage-5 probe, pre-check, RED (declared statuses), plans of `api.match_xpts` before and after, GREEN | `evidence/stage5/` (`README.md`, `probes/`, `red/` with `precheck/`, `explain_match_xpts.py`, `green/`) |
| Stage-6 render regression: pre-check, RED (declared statuses), GREEN (site, build) | `evidence/stage6/` (`README.md`, `red/` with `precheck/`, `green/`); the coordinator's browser RED: `review-evidence/browser-stage5-green/`, `browser-stage6-red2/` |
| Stage-7 boundary, render and service regressions: pre-check, RED (declared statuses), GREEN (site, build) | `evidence/stage7/` (`README.md`, `red/` with `precheck/`, `green/`); the v2 reports and reconciliation in `context/`; root's probes `review-evidence/review-v2-probes*`; the coordinator's tooltip browser RED `review-evidence/browser-stage7-red/` |
| Interim client cases, compared correctly | `evidence/stage3/client-cases/` (`compare_interim_client_cases.py`; stage-2 files preserved unchanged) |
| Real-browser baseline, candidate 1 and N9 RED, the combined similarity workflow | `context/browser-*`, `context/combined-style-*` (run by the coordinator; raw captures kept externally) |
| Migration 127's generator | `evidence/stage2/build/build_127.py` (and `build_124.py`) |
| Plans, reviews, baselines | `context/` (`brief-final*.md`, `stage1-coordinator-review.md`, `astra-interim-*.md`, `coordinator-interim-embedding-review.md`, `browser-baseline-*`) |

## Limits of this report

- No production snapshot was evaluated and no production read was performed (the delegated work deliberately used isolated local data): every « real-data validation unavailable » stays so until an operator measures it.
- The coordinator executed the final real-browser runs: 42/42 + 8/8 + 70/70 on the stage-6 source; synthetic input only.
- B7, the owner findings and the VI-22 consumers are unresolved until their owners correct them and the corrections are reviewed with evidence.
- Fresh final Astra/xhigh and Opus/max reviews of the stage-7 batch remain to be done. The v2 reviews differed (Astra: no actionable defect; Opus: changes requested). Both reports are kept with their verdicts, and v2 is not presented as approved by both.
- Stage 7's tooltip browser GREEN and the prior matrices on the stage-7 source are the coordinator's, not run here.
- Stage 5's first browser run failed on the player case (`review-evidence/browser-stage5-green/`); it is retained as failure evidence. Stage 6's actual browser GREEN now passes, as recorded above.
- Stage 5's report said the server's keeper indicator still requires both teams' xG: wrong. `keeper_pm` reads `pair_keeper_sum / pair_keeper_n` (the opponent's xGOT and a known own-goal classification); the both-xG gate belongs to the legacy exposed `keeper_*` fields (FAILURE_MODES §15). No keeper change.

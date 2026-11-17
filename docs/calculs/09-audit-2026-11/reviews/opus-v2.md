VERDICT: CHANGES_REQUESTED

Two major findings and two minor ones; everything else in B1–B6, B8–B10 and stages 4–6 matches the accepted contracts on inspection. Neither major finding is caught by the test suites, which supply explicit own-goal flags and never exercise `ClubScoutAdvanced`. I found everything by reading code and raw evidence; I executed nothing.

## Major

**1. If goal shots arrive without an own-goal flag, four club indicators get computed on goalless matches only, and are still shown.**
- **Where:**
  - Client: `club-scout.js:937` (`if (s.isOwnGoal !== false) return null` in `scoringOf`). This feeds `penaltiesOf` (`:978`), then the finishing, keeper, conversion and xG-per-shot metrics, and `measuredSelf`.
  - Server: `calculator.py:263` (the `shot_sets` HAVING clause requires no goal with `is_own_goal IS NULL`). This feeds `pair_xg_per_shot_*`, then `api.team_season.xg_per_shot`, the cohort percentiles and the attack phase.
- **Why it's likely:**
  - `normalize.py:718-726, 755-756` sets `is_own_goal` only when the provider sends the key, or `true` for event type `OwnGoal`. Nothing sets `false` for an ordinary goal.
  - `021_api_matches.sql:62` passes the value through raw.
  - In the only real fixture, none of the 25 shots in `shots.json` carries the key, while every event in `events.json` carries an explicit `false`.
  - `01-indicateurs-club.md:58` already says the repository's response examples don't carry it on goals.
- **Trigger:** a 30-match season whose ordinary goal shots have a NULL flag, two of the matches being 0–0 with shots.
- **Expected vs actual:**
  - Expected: each indicator is unavailable, or computed on all matches once flags are known.
  - Actual: only goalless matches classify. Finishing becomes the mean of −xG over those two matches, conversion 0 %, keeper the opponents' xGOT, and server xG per shot uses goalless matches only.
  - The owned UI then multiplies these means by all matches (`ClubScoutTabs.jsx:324`, `ClubScoutAdvanced.jsx:328-342`).
- **Why it matters:** §7.2 of FAILURE_MODES rejected "no goal ⇒ no own goal" because it selects matches by their result. Under this provider behaviour, dropping each match with an unflagged goal makes the same selection. TRACEABILITY:131 describes it only as lost coverage, so "corrected + verified" for audit items 15e and 15f holds only on synthetic data with explicit flags.
- **Smallest fix:**
  1. Settle the flag question first, either with VI-21's answer on the provider contract or with a read-only count of goal shots outside the shoot-out whose `is_own_goal` is NULL.
  2. If such goals exist, change the rule test-first: an indicator becomes unavailable for the club's whole scope when any candidate match has an unflagged goal. On the server, a per-match marker with `bool_or` would make the pair columns NULL. Red-phase fixture: an unflagged 1–0 plus a 0–0 with shots should give "unavailable", not −xG.
  3. Correct TRACEABILITY and the club indicators page.

**2. The shot profile's new `null` category xG is added as 0 by an owned display, and the VI-22 handoff doesn't list it.**
- **Where:** `ClubScoutAdvanced.jsx:235-236` (`setXg` sums with `+`) and `:287-288`, the sentence "Contre-attaques et CPA réunis : X xG créés / concédés". Since `club-scout.js:1612`, a category's xG becomes `null` once any of its shots lacks xG, and `null` counts as 0 in the sum.
- **Trigger:** fast-break xG of 0.4 plus one shot without xG, and corners at 1.2.
  - Before: 1.6 (the missing shot counted as 0).
  - Now: 1.2. The known 0.4 disappears with the whole category, and if every category is null the sentence shows "0,0" instead of "—".
- **Why it matters:** the field changed from always a number to number-or-null under an existing consumer. FAILURE_MODES §7.5 and the game-states page say the owned table renders `null` as "—"; that's true of `SituationTable`, not of `SetPieces`.
- **Fix:**
  - Add `ClubScoutAdvanced.jsx:235-236, 287-288` to the VI-22 consumer table, expecting "—" when any summed category is null.
  - Optionally, test-first, expose a combined set-piece + fast-break xG that stays null once any input is unknown.
  - Document the interim behaviour.

## Minor

**3. A failed refit stops Vega xG for all new matches, even though a valid model exists.** In `xg.py:313-325`, when the refit trigger fires, `model` is cleared and `FitFailed` is raised before the season is scored. Old shots keep their xG while new ones never get any (the same applies during the v1→v2 transition). `XgFailedFitTest.test_1` currently asserts "nothing changes", which covers the new unscored shots. Fix, test-first: on a refit failure, score the season with the latest valid model of the current version, then raise. Otherwise, document this mixed state in the xG doc page.

**4. Two docs overstate the finished-only rule.** README rule 4 and the performance-centile page (02-centiles-et-cohortes.md) both say only finished matches count. Two non-compact paths still read raw appearances:
- `PlayerDetails.jsx:84` (`performanceProfile` over the raw appearances);
- `PlayerComparison.jsx:137-149`.

Production's compact mode is fine. Either narrow the wording to that mode, or route both paths through `finishedAppearances`, test-first.

## Nits
- `opponentStrength` returns `{club, centile: null}` when fewer than five clubs have a paired xG difference, and `ClubScoutTabs.jsx:482-484` then shows the opponent at level 1 (weakest). Returning `null` would avoid that.
- The grade-plot tooltip at `PlayerScoutOverview.jsx:827` still prints `goals ?? 0` and `assists ?? 0`, the same class of problem as N8, in a file this branch edited.
- `shootersOf` in `match-tabs.js` (used by `MatchKpis`) still counts shoot-out kicks; the new shoot-out exclusion isn't applied on the match page. Out of the audit's scope.
- `rebase`'s `copy` recomputes `pairedFields(club.rows)` once per paired key (9 times per club); computing it once would do.

## What I verified
- **B1:**
  - The finished filter in all three calculator CTEs and the stale delete.
  - Migration 124: the filter, removal of rows left without a finished match, the backfill, and the peer histogram.
  - `appearanceWhere` on the source, page-metrics and facts paths, with the `match=` bypass.
  - The cohort position group now reads finished matches only.
  - Client side: every player actor-read appearance is joined to a fixture with a status (`actors.mjs:68-93`), and chunk partitions carry status too (`match-record.mjs:55`, `matches.mjs:93`), so the filter cannot empty legacy summaries. I reviewed every caller of `aggregateSeason` and `aggregateSeasonPlayers`.
- **B2:**
  - Paired finishing projections on all three read paths.
  - The total, per-match and per-90 denominators, and the paired eligibility thresholds.
  - The `PROFILE_SHAPE` bump and the client accumulator and leaderboard.
- **B3, B4, B5:**
  - Finite half xG, the no-shot zero and the HAVING clause.
  - Club-only, finished returns, including same-day matches and transfers.
  - The per-metric minimum of 30 peers on both paths, and the match-tab null handling.
- **B6:**
  - The JS and SQL xPts laws use the same algorithm, with the 100-xG guard applied before any allocation or `exp`.
  - One law call per view row, with a row of NULLs for invalid input.
  - The paired points and xG fields and the xPts rank.
  - `measuredSelf` and `rankCohort` write only to shallow copies, never the cached cohort, and the five-measured-club rule holds.
  - Shoot-out kicks are excluded in all three loops.
- **B8, B9 and stage 4:**
  - The embedding eligibility loop is deterministic, its guards hold and the worker's due rule checks the version.
  - The active-set xG fit releases coefficients correctly; Python and SQL use the same ±30 logit, and a failed fit raises before any write.
  - `refresh_daily` catches only `FitFailed`, re-raises it last, and doesn't mask a later error.
- **B10:**
  - Own goals read in score order and the reconciled shot sets.
  - 37 pair columns, 13 redefined indicators, and `api.team_season` agreeing with the cohort.
  - The `metric_definitions` UPDATE matches existing 015 rows.
  - The recompute SQL is valid against `UNIQUE NULLS NOT DISTINCT` (`003_ops.sql:90`).
- **Stage 6:** the summary/log wiring, the zero-finished guard, the identity, club and action fallbacks, and the legacy `playerView=matches` branch.
- **Evidence:**
  - Stage 6: 4 declared failures in the red phase with 1 expected pass, then 652/652 with per-file attribution.
  - Stage 5: 388 Python and 173 API tests, zero skips.
  - Browser stage 6: every check true, with stable source fingerprints.
  - The VI-22 handoff line numbers match the owner snapshot.

## What I could not verify
- Real provider own-goal flags and any production incidence.
- The frozen SHA256 file map; I can't run commands to recompute it.
- How long migration 124's backfill holds its ACCESS EXCLUSIVE lock on `agg.player_list_editions` (blocking directory reads) at production scale.
- CI's Node 22, and merges with the owners' branches.
# Vega v2 worker loop

UTC: 2026-11-09T02:50:26.968803+00:00
Lanes: score, details, reference
Jobs run: 700
HTTP attempts: 761
Wall seconds: 298.4

| Family | Outcome | Jobs |
|---|---|---:|
| advanced | ok | 38 |
| advanced_players | ok | 38 |
| calendar | ok | 9 |
| events | ok | 38 |
| h2h | ok | 37 |
| heatmaps | ok | 38 |
| lineups | ok | 41 |
| momentum | ok | 38 |
| network | ok | 38 |
| player | ok | 14 |
| player_halves | ok | 38 |
| player_stats | ok | 38 |
| shots | ok | 38 |
| summary | ok | 202 |
| team | ok | 17 |
| team_stats | ok | 38 |

## Watches

| State | Matches |
|---|---|
| final | 202 |
| scheduled | 116 |
| stopped | 2 |

## Jobs

| Lane | Family | State | Jobs |
|---|---|---|---|
| details | advanced | done | 38 |
| details | advanced | pending | 164 |
| details | advanced_players | done | 38 |
| details | advanced_players | pending | 164 |
| details | events | done | 38 |
| details | events | pending | 164 |
| details | h2h | done | 37 |
| details | h2h | pending | 243 |
| details | heatmaps | done | 38 |
| details | heatmaps | pending | 164 |
| details | lineups | done | 41 |
| details | lineups | pending | 174 |
| details | momentum | done | 38 |
| details | momentum | pending | 164 |
| details | network | done | 38 |
| details | network | pending | 164 |
| details | player_halves | done | 38 |
| details | player_halves | pending | 164 |
| details | player_stats | done | 38 |
| details | player_stats | pending | 164 |
| details | shots | done | 38 |
| details | shots | pending | 164 |
| details | team_stats | done | 38 |
| details | team_stats | pending | 164 |
| reference | league | pending | 63 |
| reference | league_matches | pending | 64 |
| reference | player | done | 15 |
| reference | player | pending | 1794 |
| reference | team | done | 18 |
| reference | team | pending | 575 |
| score | calendar | done | 9 |
| score | summary | done | 202 |
| score | summary | pending | 237 |

## PitchAPI attempts

| Family | HTTP | Error | Attempts | Mean ms | P95 ms |
|---|---|---|---|---|---|
| advanced | 200 |  | 39 | 236 | 220 |
| advanced_players | 200 |  | 39 | 267 | 217 |
| calendar | 200 |  | 9 | 215 | 295 |
| events | 200 |  | 39 | 219 | 225 |
| h2h | 200 |  | 38 | 413 | 1563 |
| heatmaps | 200 |  | 39 | 284 | 416 |
| league | 200 |  | 62 | 632 | 2168 |
| league_matches | 200 |  | 1 | 231 | 231 |
| lineups | 200 |  | 42 | 236 | 207 |
| momentum | 200 |  | 39 | 199 | 223 |
| network | 200 |  | 39 | 359 | 967 |
| player | 200 |  | 15 | 1048 | 4848 |
| player_halves | 200 |  | 39 | 407 | 2259 |
| player_stats | 200 |  | 39 | 364 | 231 |
| shots | 200 |  | 39 | 296 | 225 |
| summary | 200 |  | 203 | 232 | 221 |
| team | 200 |  | 18 | 198 | 213 |
| team_stats | 200 |  | 39 | 309 | 279 |

## Controlled failures

| Family | Code | Count |
|---|---|---|

## Unknown provider fields (paths only)

| Family | Path | Count |
|---|---|---|
| shots | shot.event_type.OwnGoal | 1 |

## Rows

| Table | Rows |
|---|---|
| core.competitions | 62 |
| core.competition_seasons | 64 |
| core.matches | 626 |
| core.teams | 593 |
| core.players | 1809 |
| agg.player_season_stats | 1545 |
| agg.team_season_stats | 422 |
| agg.standings | 422 |
| agg.cohorts | 330 |
| agg.team_percentiles | 4888 |
| agg.player_percentiles | 0 |
| agg.team_index | 508 |
| agg.player_role_scores | 0 |
| agg.team_levels | 403 |
| ops.dirty_scopes | 20 |
| ops.data_warnings | 0 |
| api.match_list | 626 |
| api.standings | 422 |

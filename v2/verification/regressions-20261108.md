# Vega v2 isolated pilot

UTC: 2026-11-08T20:51:40.383949+00:00
PostgreSQL: 16.15 (Debian 16.15-1.pgdg13+2)
Minimum request interval seconds (initial / final): 0.25 / 0.25
Overall result: ok
Finished matches available: 306
Selected matches: 4
Completed match loops: 4
HTTP attempts this run (including retries/profiles): 56
Wall seconds: 28.51
Family failures: 0

Calendar rows actually stored: 306
Observed player identities with unknown name: 3
A completed collection stores the whole competition calendar, and details only for selected matches.
Database size includes empty schema/index overhead; do not extrapolate one-match bytes to a season.
Only metadata, counts and timings are exported. No database dump, response or football row is exported.

| Schema | Heap bytes | Index bytes | Total bytes including TOAST |
|---|---:|---:|---:|
| agg | 0 | 172032 | 278528 |
| core | 565248 | 1269760 | 2359296 |
| ops | 163840 | 212992 | 540672 |

| Family | Outcome | Count |
|---|---|---:|
| advanced | ok | 4 |
| advanced_players | ok | 4 |
| events | ok | 4 |
| h2h | ok | 4 |
| heatmaps | ok | 4 |
| lineups | ok | 4 |
| momentum | ok | 4 |
| network | ok | 4 |
| player | ok | 1 |
| player_halves | ok | 4 |
| player_stats | ok | 4 |
| shots | ok | 4 |
| summary | ok | 4 |
| team | ok | 1 |
| team_stats | ok | 4 |

| Family | SQL write median ms | SQL write p95 ms |
|---|---:|---:|
| advanced | 6.93 | 7.22 |
| advanced_players | 57.16 | 62.86 |
| events | 32.71 | 36.28 |
| h2h | 3.62 | 3.89 |
| heatmaps | 60.90 | 62.18 |
| lineups | 83.06 | 96.13 |
| momentum | 20.60 | 23.00 |
| network | 115.84 | 127.53 |
| player | 4.86 | 4.86 |
| player_halves | 77.48 | 107.60 |
| player_stats | 88.91 | 94.16 |
| shots | 41.76 | 42.92 |
| summary | 8.96 | 10.61 |
| team | 3.95 | 3.95 |
| team_stats | 10.12 | 10.95 |

| Family | HTTP status | Error | Attempts in database | Mean ms | P95 ms |
|---|---|---|---:|---:|---:|
| league_matches | 200 |  | 1 | 492 | 492.00 |
| summary | 200 |  | 4 | 256 | 429.35 |
| shots | 200 |  | 4 | 331 | 476.15 |
| events | 200 |  | 4 | 192 | 202.65 |
| lineups | 200 |  | 4 | 193 | 200.40 |
| momentum | 200 |  | 4 | 676 | 1840.90 |
| team_stats | 200 |  | 4 | 652 | 1759.05 |
| player_stats | 200 |  | 4 | 1106 | 2646.75 |
| player_halves | 200 |  | 4 | 197 | 207.95 |
| advanced | 200 |  | 4 | 192 | 199.70 |
| advanced_players | 200 |  | 4 | 196 | 214.80 |
| network | 200 |  | 4 | 727 | 2004.10 |
| heatmaps | 200 |  | 4 | 667 | 1810.95 |
| h2h | 200 |  | 4 | 184 | 191.55 |
| league | 200 |  | 1 | 769 | 769.00 |
| team | 200 |  | 1 | 172 | 172.00 |
| player | 200 |  | 1 | 185 | 185.00 |

| Family | Controlled error | Count |
|---|---|---:|

| Family | Unknown field path (no values) | Count |
|---|---|---:|

Named embedded references do not prove an explicit profile has been fetched.

| Reference kind | Explicit profile success | Registered references |
|---|---:|---:|
| team | 1 | 18 |
| player | 1 | 149 |

| Typed fact table | Stored rows |
|---|---:|
| lineup_players | 160 |
| lineups | 8 |
| match_events | 57 |
| match_h2h | 4 |
| match_momentum | 376 |
| pass_network_edges | 504 |
| pass_network_nodes | 88 |
| pass_network_teams | 8 |
| player_heatmaps | 125 |
| player_match_advanced | 125 |
| player_match_half_stats | 208 |
| player_match_stats | 160 |
| shots | 108 |
| team_heatmaps | 8 |
| team_match_advanced | 8 |
| team_match_stats | 24 |

Coverage counts below count source observations, including explicit zero; NULL is not zero.

| Fact table | Metric | Non-NULL rows | Total rows |
|---|---|---:|---:|
| player_match_stats | minutes_played | 125 | 160 |
| player_match_stats | goals | 117 | 160 |
| player_match_stats | rating | 113 | 160 |
| player_match_stats | xg | 60 | 160 |
| player_match_stats | distance_m | 0 | 160 |
| player_match_stats | sprints | 0 | 160 |
| player_match_stats | top_speed_kmh | 0 | 160 |
| team_match_stats | total_shots | 24 | 24 |
| team_match_stats | xg | 24 | 24 |
| team_match_stats | accurate_passes | 24 | 24 |
| team_match_stats | accurate_passes_pct | 24 | 24 |
| team_match_stats | distance_m | 0 | 24 |
| player_match_advanced | xt_total | 125 | 125 |
| player_match_advanced | vaep_total | 125 | 125 |
| player_match_advanced | pv_total | 125 | 125 |
| player_match_advanced | xag | 125 | 125 |
| team_match_advanced | xt_total | 8 | 8 |
| team_match_advanced | ppda | 8 | 8 |
| team_match_advanced | field_tilt | 8 | 8 |

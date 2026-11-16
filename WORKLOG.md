# WORKLOG — 2026-11-16

- Goal: nation pages — an index of national teams and a page per national team ([VI-18](https://linear.app/vegainteligence/issue/VI-18/pages-nations-index-des-selections-et-page-par-selection), In Progress, mock-up awaiting validation).
- This checkout: Vega-Sport, worktree `claude/v2-complete`, pushed direct to main; Linear label `repo:vega-sport`.
- Done today: VI-17 (player page and club rail) shipped and verified (8c8dd52633, 8d87993452); the club stadium's blue underline was removed (803fc14499).
- Constraints: approved mock-up before any code; real API-backed data only; no provider names in routes or visible text; Vega ids; typed tables; French UI; phones get one scrolling row of pills.
- Facts (read-only DB, 16 Nov):
  - 235 national teams, 54 with a crest, none linked to a country.
  - Matches: World Cup 2026 (stored twice: collected + archive), Nations League 2026/27 (two sources), World Cups since 1930 and Euros 2020/2024 (archives).
  - Player stats only for the 48 World Cup 2026 squads.
  - Elo: 54 nations have a history; 19 are ranked in 2026/27.
  - Data gaps: « Italie » and « Grèce » are separate teams from Italy and Greece, so the France–Italie matches are missing from the Elo. Many archive scores are empty (1998 final). There is no coach, line-up or confederation.
- Proposed direction (mock-up):
  - `/nations/`: Vega Elo ranking with search, « Classées cette saison / Toutes ».
  - `/nations/?id=`:
    - rail: rank, bilan, form, World Cup 2026;
    - tabs Vue d'ensemble / Matchs / Joueurs / Historique;
    - overview: KPI strip, Elo curve + latest matches, World Cup 2026 path, World Cup 2026 players, tournaments grid.
  - Links: « Nations » in the top nav, player rail nation chip, international match teams, search.
- Next action: wait for the user's validation of the mock-up, then plan API routes, data fixes (team aliases, de-duplication) and the frontend.

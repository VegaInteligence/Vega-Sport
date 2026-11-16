# WORKLOG — 2026-11-16

- Goal: cup predictions — the UEFA league phases projected (Champions, Europa, Conference League) and the chance of each club or nation to reach each stage of every cup ([VI-19](https://linear.app/vegainteligence/issue/VI-19/predictions-des-coupes-phases-de-ligue-europeennes-et-chances-par-tour), In Progress; mock-up sent, awaiting validation).
- This checkout: Vega-Sport, worktree `claude/v2-complete`, pushed direct to main; Linear label `repo:vega-sport`.
- Done today:
  - VI-17 player page and club rail; VI-18 nation pages (API 119–120 + pages).
  - Player profile in the club card's design; home grade hover.
  - Background refresh with no banner; European colours of past tables from observed fates (f97b5aa165, verified on Ligue 1 and Premier League 2022/23–2023/24).
- Constraints: mock-up and method approval before code; ask before method changes; advisor review for big method choices; tests first; real data only.
- Facts (read-only, 16 Nov):
  - The season projection (`backend/vega/forecast.py`) skips INT competitions.
  - The UEFA league phases of 2026/27 have rounds 1–4 played and 72 fixtures left (54 in the Conference League); the fixtures left have no round.
  - Domestic cups: 1 108 of 1 530 clubs have no Elo.
- Prototype (diag-clproj.py, read-only): the forecast-v2 model plus a UEFA bracket (seeded play-off pairs, R16 by rank, two legs, extra time at one third of the rate, penalties at 50 %, neutral final). It gives each club its projected points, top 8, play-offs, out, 8es, QF, SF, final and winner, and the totals sum to 100 %.
- Open method choices for the user:
  - the strength of a club without an Elo (league level?);
  - random draws for rounds not yet drawn;
  - how to count knockout ties already played.
- Next action: wait for the user's validation; then advisor review, tests first, worker + API + « Projection » tab, production E2E.

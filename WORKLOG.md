# WORKLOG — 2026-11-17

- Goal: platform audit — every earlier request verified, data sources cut to what Vega needs with no double data, a rating for every club, match and player ([VI-21](https://linear.app/vegainteligence/issue/VI-21/audit-de-la-plateforme-coherence-sources-de-donnees-sans-doublon-une), In Progress). VI-19 (cup predictions) stays open for the cups beyond the European ones.
- This checkout: Vega-Sport, worktree `claude/v2-complete`, pushed direct to main; Linear label `repo:vega-sport`.
- Constraints: measure before any DB correction or method change and ask first; deletions need an explicit yes after the replacement is verified; tests first; read-only diagnostics.
- User decisions: one club Elo for every match, no separate cup Elo (16 Nov); cups: extra time ⅓, penalties 50/50, played ties fixed.
- Audit (17 Nov, read-only; full table in VI-21's comment):
  - Earlier requests: all done and verified, except cups beyond CL/EL/ECL. The CL/EL/ECL stage odds are live (totals exact, evidence-vi19).
  - Sources: open-matchday copies 35 leagues PitchAPI holds (4,304 duplicate warnings in 7 days); DFB-Pokal and Nations League each come from two sources; SportsAPI is unused; three site-side Wikidata helpers are dead; two static data files sit in the frontend.
  - Coverage:
    - clubs: 1,476 of 11,062 rated (2,066 complementary-only, 7,520 archive-only);
    - matches 2026/27: 11,427 of 11,626 graded (provider gives no player stats for the rest);
    - players 2026/27: all graded players scored;
    - seasons 2021/22 and half of 2022/23: backfill ends in about 1–2 days;
    - birth dates for 15 % of scored players.
  - Jobs: healthy; 43 deadlocks in 7 days to fix.
- Next action: on the user's go, start the plan in VI-21 (sources first, then copies, then the one Elo over the complementary matches, then cups by stage).

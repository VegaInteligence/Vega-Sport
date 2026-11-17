# WORKLOG — 2026-11-17

- Goal: platform audit and its plan ([VI-21](https://linear.app/vegainteligence/issue/VI-21/audit-de-la-plateforme-coherence-sources-de-donnees-sans-doublon-une), In Progress).
  - Each source is read only for what it alone gives.
  - Every club, match and player has a rating.
  - Cups are predicted stage by stage. VI-19 stays open for the cups beyond CL/EL/ECL.
- This checkout: Vega-Sport, worktree `claude/v2-complete`, pushed direct to main; Linear label `repo:vega-sport`.
- Constraints:
  - Measure before any DB correction or method change, and ask first.
  - Delete only after an explicit yes, once the replacement is verified.
  - Tests first; read-only diagnostics.
- User decisions:
  - 16 Nov: one club Elo for every match, no separate cup Elo.
  - 17 Nov: « lance le plan ».
  - 17 Nov: « oui » to deleting the 35 copy editions, and « corrige et applique » for the one Elo.
- Shipped (17 Nov):
  - Sources (705bfc824a):
    - open-matchday no longer reads its 35 copies of PitchAPI leagues.
    - SportsAPI is removed.
  - Cup clubs (4f63848258):
    - 73 reviewed spellings link professional clubs.
    - Ireland is now IRL.
  - One Elo (a912ed319e):
    - Every open-matchday match and every match of the German cup (OpenLigaDB) counts.
    - Clubs PitchAPI does not hold enter at their group's level: their league (division from the folder), else their country's cup clubs.
    - Measured beforehand, in memory: 967 more clubs ranked; median change 1.2 points for clubs already ranked; top 30 within 6 points.
  - The reader removes the 35 copy editions (9,539 matches) at its next read.
- Kept outside on purpose (measured):
  - OpenFootball's national cup archives and the continental cups. They still count only between known clubs: their unlinked professional clubs inflated the cup groups, and the African cups moved Egypt +104.
- Evidence: scratchpad evidence-vi21 (diag-*.py/.out, sweep, README).
- Next action:
  - Verify in production: copies gone, Elo run done, merges made.
  - Then: link the archive and continental clubs, and project domestic cups by stage.
  - After the backfill: recompute and verify 2021/22–2022/23.

## VI-22 — club page and featured competitions (scratchpad worktree `club-tasks`, 17 Nov 2026)

- Goal ([VI-22](https://linear.app/vegainteligence/issue/VI-22/page-club-et-competitions-clubs-similaires-sur-toute-la-base-liens)): similar clubs across the whole base by default (league picker kept), « Ce club n’a pas de classement UEFA. », club links in « Résultats et attendus », match links in « Derniers / Prochains matchs », featured row squeezed with the three UEFA cups.
- User decisions: similarity is the style of play only, never the club's Elo; but a club dominating a weak league must not pass for a top club, while Como or Roma can still match Paris.
- Method: style centiles in each club's own league cohort, less 0.15 per point of the two leagues' level gap beyond 50 (measured read-only; a hard ±125 window flipped Ecuador's champion in and out when levels moved by 3 points). Advisor (Opus, Fable rate-limited) consulted; its club-Elo window was rejected by the user.
- Built: migration 123 (`api.team_style_centiles`), `GET /api/teams/{id}/similar?season=&league=` with its contract test written first, the tab on it, the four UI changes, calc note 04-clubs/04.
- Shipped 17 Nov 2026: `f9e49f7068` on main, deployed with `infra/aws/deploy.sh` (migration 123 applied, API Lambda 10:06:56Z, worker image `f9e49f7068`), Vercel production READY. The view test's count fixed in the next commit (CI had expected 152 api views).
- Validated: API 169/169, site 605/605 after the rebase; 15 E2E checks on vegasport.vercel.app (Le Havre's tab included, outside the preview's recording). Evidence: scratchpad `evidence/vi22/EVIDENCE.md`.
- Next action: none for VI-22; the similarity cost (free 50, 0.15 per point) is the knob if the user wants the lists tighter or wider.

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
  - The reader removed the 35 copy editions (9,539 matches); verified 17 Nov, 07:43 UTC: 0 copies left, 2,443 clubs ranked (as measured), no copy-only club ranked.
  - The Elo never reads a copy (adad382925), after the 00:32 run ranked 208 of them.
  - Domestic knockout cups, data and API (1f3c1b2113, migration 124; 123 is VI-22's):
    - which cups: drawn round not begun, all clubs entered, all rated;
    - replayed with the user's rules; opponent of the round in play;
    - calc note 7eebf9707c.
- 17 Nov, afternoon (« fixe et implémente tout ce qui reste »; the cups' mockup validated by it):
  - Cups' « Projection » view shipped (5374d0d396).
  - Single Elo over the national cup archives, Coupe de France, American cups and Club World Cup (499f1e3b4c):
    - 170 reviewed archive spellings;
    - the Elo applies the identity merges in memory;
    - German cup from OpenLigaDB only;
    - CAF kept out (needs an African prior).
  - Measured beforehand: 3,060 teams; PitchAPI clubs median change 2.9.
  - Forcing the identity pass was refused by the permission classifier; it runs at 21:30 UTC and the Elo no longer depends on it.
- Backfill: 68,748 jobs left (about 15 h). 2021/22 has 9,321 scored players and 2022/23 has 14,844, recomputed automatically.
- Evidence: scratchpad evidence-vi21, evidence-cups (check-knockout.mjs, local-dfb.png), diag-elofinal.
- 17 Nov, late morning:
  - Elo verified in production (3,060 teams, no copy ranked).
  - User decisions: no strength for the 7,520 clubs found only in the historic archives; « oui » to the Nations League by stage.
  - The Nations League mockup was sent (scratchpad unl/mock-unl*.png).
  - CAF question answered: it is about including the African Champions League's matches in the club Elo.
- 17 Nov, midday (« Oui, implémente », the Nations League mockup validated):
  - Nations League projection shipped (e932b1e351, migration 125):
    - the worker replays each edition with the UEFA tie-breakers, League A to its Final Four;
    - the « Projection » tab on the Nations League page;
    - tests written first; checked locally on the read-only data (Spain 26 %, England 23 %, France 18 %).
  - Cup sources no longer rename a team another source also holds.
  - Deployed (run 44078144860): the deployed code, run read-only on the production base, gives exact totals (Spain 28 %); the live page waits for the worker's first write.
  - Linear VI-19 comment posted.
- Next action:
  - production numbers after the worker's next daily pass (the projections were last written 05:07 UTC);
  - after 21:30, verify the merges;
  - CAF Champions League prior: waiting for the user's answer.

## VI-22 — club page and featured competitions (scratchpad worktree `club-tasks`, 17 Nov 2026)

- Goal ([VI-22](https://linear.app/vegainteligence/issue/VI-22/page-club-et-competitions-clubs-similaires-sur-toute-la-base-liens)): similar clubs across the whole base by default (league picker kept), « Ce club n’a pas de classement UEFA. », club links in « Résultats et attendus », match links in « Derniers / Prochains matchs », featured row squeezed with the three UEFA cups.
- User decisions: similarity is the style of play only, never the club's Elo; but a club dominating a weak league must not pass for a top club, while Como or Roma can still match Paris.
- Method: style centiles in each club's own league cohort, less 0.15 per point of the two leagues' level gap beyond 50 (measured read-only; a hard ±125 window flipped Ecuador's champion in and out when levels moved by 3 points). Advisor (Opus, Fable rate-limited) consulted; its club-Elo window was rejected by the user.
- Built: migration 123 (`api.team_style_centiles`), `GET /api/teams/{id}/similar?season=&league=` with its contract test written first, the tab on it, the four UI changes, calc note 04-clubs/04.
- Shipped 17 Nov 2026: `f9e49f7068` on main, deployed with `infra/aws/deploy.sh` (migration 123 applied, API Lambda 10:06:56Z, worker image `f9e49f7068`), Vercel production READY. The view test's count fixed in the next commit (CI had expected 152 api views).
- Validated: API 169/169, site 605/605 after the rebase; 15 E2E checks on vegasport.vercel.app (Le Havre's tab included, outside the preview's recording). Evidence: scratchpad `evidence/vi22/EVIDENCE.md`.
- Display handoff from VI-23, done at the user's request (« Do them here »): `08955914db` — each pair on the same matches (`services/club-supported.js` reads VI-23's paired fields and coverage when served, the rows otherwise), totals on their own support, unknown shown « — », shot map keeps unknown xG null, game states skip goals without a minute, coming matches without a fabricated level 1, comparison and suggestions from the similar route (browser `similarClubs` removed). Tests first; site 627/627; browser check with Le Havre's xG removed on 5 of 10 matches by a local proxy (no partial coverage exists in production).
- For VI-23 when it merges: one-line conflict on the shot map (`xg ?? 0.01` → `xg`), two calc notes, its test `audit-club-metrics.test.mjs:470` expects 0.01; set pieces and the situation buckets show correctly only with its producer.
- Next action: none for VI-22; the similarity cost (free 50, 0.15 per point) is the knob if the user wants the lists tighter or wider.

## Next.js security update (17 Nov 2026)

- 16.4.3 → 16.4.6 (`dashboard/package.json`, `bun.lock`): GHSA-mfr8-8qww-v76h (`use cache` through `unstable_cache`, fixed in 16.4.5; the site uses neither). Build no longer stops on Next's notice; site tests 627/627; built site checked against production on 10 pages and the phone club page, identical, no console error. Shipped `1c61a7ed93`: CI green, Vercel production serves 16.4.6 (`window.next.version`), the same 11 checks identical.

## Dependencies and tools ([VI-24](https://linear.app/vegainteligence/issue/VI-24/dependances-et-outils-a-jour-site-api-worker-et-ci), 17 Nov 2026)

- Site: lucide-react 1.74.0, @vercel/speed-insights 2.1.0, prettier 3.10.1 (react 19.3.1 already the latest); worker: psycopg 3.3.9, boto3 1.44.4; read API: pg already the latest.
- CI and deploy: bun 1.4.4 everywhere (was 1.2.21 for the API package and the deploy); Node 26 for the site (Vercel) and 24 elsewhere (Lambda nodejs24.x); actions checkout/setup-node/setup-python/upload-artifact v7, configure-aws-credentials v6.3.0 (pinned SHA).
- Kept on purpose: Python 3.12 in the worker, Lambda nodejs24.x. Local checks: Python 328 OK, API 170/170, site 627/627, build, packages, 11 pages identical to production. Next action: push, then CI (incl. Isolated pilot's AWS login) and Vercel.

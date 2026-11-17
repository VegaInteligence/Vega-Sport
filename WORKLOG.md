# WORKLOG — calculation audit checkpoint, 17 November 2026

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
- 17 Nov, afternoon (« chaque compétition doit être prise en compte dans les scores des équipes … et avoir ses prédictions », « oui » to the CAF Champions League, the Nations League's open points to implement):
  - Every competition in the one Elo (b348bd64d3): no more whitelist (CAF Champions League in: 276 matches); every FIFA member mapped to its confederation; leagues and country groups share an estimated confederation mean (advisor: Opus 5.5 high, Fable rate-limited). Measured read-only: Egypt +70 (se 55), South Africa +63 (se 63), reference leagues ≤ 1.5, PitchAPI clubs median 1.4, 3,141 teams ranked; sensitivity σ_c 60/100/150 within one se.
  - Forecasts for every competition (b348bd64d3): every match to play between rated teams, whatever the source; open-matchday's leagues projected; stale cup-source fixtures (Libertadores 2026 file stopped in August) skipped.
  - Nations League's transitional season (03070e2c13, migration 126): leagues A–D replayed together with 2026–27's rules (best/worst thirds and fourths of A, B/C play-offs, D all up, league in 2028–29), the real draw followed once made (20 Nov), the access list as last tie-break (no cards in the sources); League A's « Barrage » / « Relégation » columns corrected to these rules.
  - Production, read-only with the deployed code: migration 126 applied; 2,050 complementary matches to forecast; 17 complementary leagues projected; the Nations League's totals exact (18 per league). Evidence: scratchpad 41a8837f…/evidence.
  - Mockup validated (« Yes, implement », scratchpad 41a8837f…/mock/mock-predictions*.png) and shipped (dd640008dc, migration 127): each upcoming match's forecast in the cup lists (bar + three shares; API by match id), League A's Maintien and En A 2028–29, Leagues B–D's outcomes and 2028–29 league; a complementary league's projection tab. Local E2E against a stand-in API with read-only production figures: scratchpad 41a8837f…/evidence/allcomp.
  - Verified in production after the worker's 14:20 UTC projection pass: Nations League totals exact (18 per league in 2028–29), forecasts in the lists (League Cup 4/4, FA Cup 7/20, National League 350/352), League Cup and Scottish League Cup projected; live pages as the mockup (evidence/allcomp prod-*.png).
  - The 19 open-matchday leagues get their pages (user: « by pass the mockup and do for all of them directly i trust you », 17 Nov): standings from the results, matches with forecasts, projection; no bracket; a league the main source holds never listed twice.
- Not covered yet, by data: Euro 2028 (teams unknown), MLS/Liga MX play-offs (the source names « 2nd ranked »), Libertadores 2026 (source stopped).
- Next action:
  - the new Elo (every competition, shared confederation mean) at the worker's next Elo pass; the other five domestic cups after the 21:30 UTC merges;
  - after 21:30 UTC, verify the merges.

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
- Kept on purpose: Lambda nodejs24.x. Python 3.12 in the worker was then moved to 3.14 by [VI-25](https://linear.app/vegainteligence/issue/VI-25/worker-et-ci-en-python-314) (`3d4bb282a0`: image, CI and pilot; deployed 17 Nov, CI and pilot green). Local checks: Python 328 OK, API 170/170, site 627/627, build, packages, 11 pages identical to production. Next action: push, then CI (incl. Isolated pilot's AWS login) and Vercel.

## VI-23 — calculation audit (taken over 17 Nov 2026, 11:40)

- Goal ([VI-23](https://linear.app/vegainteligence/issue/VI-23/audit-calculs-corriger-les-agregats-et-la-couverture-hors-des)): the 16 Nov calculation audit's independent fixes — aggregates on observed support and final matches only, paired club fields, retrospective xPts law, validated xG fits, half totals, embeddings, return stream, match-tab missing values; specs, failure modes and source audit under `docs/calculs/09-audit-2026-11/`.
- Done by the Codex chat on `codex/calculation-audit-20261117` (5 local commits, Astra/xhigh accepted v3; the final Opus/max review stayed quota-blocked). The user reassigned it to this session (« work on all of that »): rebased on main, migrations renumbered after main's 124, reconciled with VI-22 (shot map unknown xG null; docs merged).
- Constraint kept: measure before any production method change and ask before applying; no push or deploy without the user's yes.
- Final review (Opus, 17 Nov) found a blocker, confirmed read-only on production: goal shots carry the own-goal flag TRUE or NULL, never FALSE, so the four shot-backed club indicators were measured on goalless matches only; and summary reads left every other club unmeasured. Also found while measuring: goal events store their running score before the goal in about half the matches, so the calculator's own-goal rule classified 55 % of them.
- Decision (Fable advisor, then implemented): stage 8, one scoring per match in `132_match_scoring.sql` (own goals from the goal events' teams, penalty attempts from the reconciled shot set), read by the calculator and embedded in every club/league/Europe match record (`ownGoalsFor`, `penaltyAttempts`); the site reads those fields only. 98.9 % of 2026's matches with shots classified. FAILURE_MODES §17.
- Rebased three times (main shipped 124, 125, then VI-19's 126 and 127): VI-23's migrations are now 128–132.
- Validated locally: Python 424 (3.14), API 181, site 691, build 17/17 on the pushed tree; browser behind a proxy that adds the view's values computed on production. Evidence: `scratchpad/evidence/vi23-final/EVIDENCE.md` (session scratchpad).
- Shipped 17 Nov (« Yes push and deploy »): `3d4bb282a0` on main with VI-25; Deploy run 44099838338 green; migrations 128–132 applied 14:11–14:12 UTC; worker image `3d4bb282a0` on Python 3.14; the API serves `ownGoalsFor` and `penaltyAttempts`. Production check without proxy: Le Havre conversion 5,4 %, keeper −2,7 (26e sur 31), finishing −6,4; PSG keeper +3,9; equal to the independent expectations; one rank differs from the proxy run (Le Havre finishing 31e instead of 30e: a club outside Ligue 1 in the cohort changed, cause not traced).
- Next action: the recompute (2,149 editions in six batches, current leagues first; pre-check clean) is a production write that the session's permission check refused; it waits for the user's explicit go-ahead. Then the daily pass fits xg-v2, embeddings for every season, post-checks, Linear VI-23 Done.

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
  - The 19 open-matchday leagues get their pages (user: « by pass the mockup and do for all of them directly i trust you », 17 Nov; 7df58feb01): standings from the results, matches with forecasts, projection; no bracket; a league the main source holds never listed twice. Live and checked (National League, Ukraine, Cymru Premier, phone); all 19 checked locally against production (evidence/leagues).
- 17 Nov, evening (« vérifie l'Elo et les coupes … toutes les coupes ont le même design avec les couleurs »):
  - Elo verified in production: run 2083 (14:14 UTC) with every competition and the shared confederation mean; 3,141 teams, 284 CAF matches, Al Ahly 1781 (39th), Egypt 1626 ± 55, South Africa 1603 ± 63, as measured.
  - Cups (3a4234ae64): forecasts read a club's copy at its club's strength (as the Elo does); ten Scottish clubs written two ways unified in the open-matchday reader; aliases « Internazionale », « FC Cologne ». Read-only with the deployed code: 7 domestic cups projected at the next pass (Austria, Portugal, Switzerland, Germany, Italy, League Cup, Scottish League Cup); Netherlands, FA Cup, Copa del Rey, Scottish Cup wait for their draws.
  - Same design (3a4234ae64, c7b8b34922): every cup's list uses the main row (date, crest or flag, score pill, round), one forecast bar in every list (/api/fixtures carries it too: Champions League live), domestic brackets from numbered rounds (League Cup live), home nations' flags in French. Evidence: scratchpad 41a8837f…/evidence/design.
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
- Recompute done 17 Nov (« Oui »), 14:32–16:37 UTC: 2,149 editions in six batches, every cohort republished; 0 club seasons without paired supports (75,785 rows); `xg-v2` (1,798,648 shots) and `returns-v2` only; profiles 2021–2024 rebuilt as `profile-embedding-v2` on the user's go-ahead (every season v2 now). Left: `team:2021:europe` on the old formula, starved by the 2021 backfill's re-marks (VI-26 below).
- Closed 17 Nov after VI-26 shipped: `team:2021:europe` republished in `club-indicators-v2` at 18:01:40 UTC; no club percentiles left on the old formula. Not done: a fresh independent model review of stage 8 (production checks stand in). Handoffs stay with their owners: B7 game states (running score), shot-flag readers `club-game-states.js`, `club-analysis.js`, `home-insights.js`, the normalizer's NULL (VI-21).

## VI-26 — cohort maximum wait (17 Nov 2026, scratchpad worktree `cohortwait`)

- Goal ([VI-26](https://linear.app/vegainteligence/issue/VI-26/cohortes-un-delai-maximal-pour-celles-quon-remarque-sans-cesse)): a cohort re-marked without pause is still recalculated. `process_cohorts` waited 10 min after the last mark with no end; `team:2021:europe` (revision 2,853) had not been refreshed since 9 Nov.
- Decision: due at the earlier of `queued_at + 10 min` and `first_queued_at + 60 min` (migration `133_cohort_max_wait.sql`, a column a re-mark leaves unchanged); claim order by due time; re-marked during its refresh → the wait restarts from the claim. FAILURE_MODES §18; French note in `05-joueurs/02-centiles-et-cohortes.md`.
- Validated locally: Python 428 OK (3.14), API 182/182; a 70-minute simulated scenario with the real refresh (refreshed at minute 60, once).
- Shipped 17 Nov (« Yes, push and deploy »): `8018e0836c`, Deploy run 44131657417; migration 133 applied 17:01:35 UTC; `team:2021:europe` (re-marked 180 more times meanwhile) republished at 18:01:40 UTC, at the maximum wait. Closed.

## Major tournaments: tiles, edition pages, bracket on one screen (18 Nov 2026, scratchpad worktree `wt`, branch `claude/tournament-editions`)

- Goal (user, 18 Nov): on a nation's page, « Grands tournois » redesigned and each edition a link to its own page (World Cup 2026, Euro 2024, …) with its bracket; the bracket fits one screen, no scrolling (it was 1,940 px tall for the 2026 World Cup).
- Linear: the connector of this session is another workspace (`inception-technology1`), not Vega Inteligence: the In Progress check could not be done there and no issue was created. Checked instead: branches and open pull requests (VI-30's logos, no overlap).
- User decisions (18 Nov): the mock-up validated (« je valide tes maquettes, tu peux les mettre directement en ligne »); proposal A for the tiles (the user left the choice). Mock-up: scratchpad `e6ee2704…/mock`.
- Built:
  - Tiles: a row per competition with its own medals (never a total across competitions: the base holds no Euro before 2020), a tile per edition with a six-step gauge, each a link to its edition on its bracket, the nation followed (`tournament-runs.js`, `tournamentEdition`).
  - Edition page (`EditionHeader.jsx`): one row (competition, edition between two arrows, team followed, views); the World Cup's archive and its collected editions under one selector (`competitionEditions`); edition, view and team in the address; a cup outside the featured row has no row of leagues above it. The World Cup and the Euro open on their bracket and have « Groupes ».
  - Bracket (`KnockoutBracket.jsx`, `bracketSides`): both halves towards the final, champion above, third place below, height from the screen; one round a screen under 1,080 px; every cup uses it (two-legged ties included). French names of national teams.
  - Bracket data: the third-place match under every archive name; a replayed tie as one tie; 1934's and 1938's round of 16; a tie without a score still links.
  - Worker: the open-cups reader reads a score written as a bare pair (`cups.READER` 2, each edition read again once; migration 134 marks them due).
- Measured before the correction, read-only (replay of `elo_updates` on the public API's matches; it reproduces production within 0.1 point at the median, 18 at most): 658 more results rated (969 → 1,627 national-team matches); for the 54 ranked nations a median change of 4.3 points, 69 at most (Netherlands 8th → 4th), 12 nations by more than 25, 39 ranks change, the top three do not. Script and report: scratchpad `evidence/` (`measure.mjs`, `elo-measure-report.json`).
- Validated locally: site tests 707/707 (tests written first: `tests/tournament-editions.test.mjs`), build, 31 E2E checks on the built site against the production API (`evidence/local`). The base's reader test runs in CI only (the schema needs PostgreSQL 18; the local server is 16).
- The bracket is whole in the window at 1920×1080, 1440×900 and 1366×768; the page itself still scrolls to the site's footer. On a phone the round of 32 exceeds the screen by a few ties.
- Shipped 18 Nov: `71950f9474` (archive scores), `2f25e3e58f` (site) on main; CI green on the branch (run 44346818422) and on main (run 44347747753); Vercel production serves it; the 31 E2E checks pass on vegasport.vercel.app. Evidence: scratchpad `evidence/EVIDENCE.md`.
- Worker deployed 18 Nov on the user's word (« Tu peux les déployer toi même »): Deploy run 44351541140 green at 16:57 UTC, migration 134 applied, the editions read again in the same hour. Verified in production: 1,068 of the 1,069 archived World Cup matches have their score (the last is Sweden–Austria 1938, a walkover); 1986 is whole (Argentina–England 2–1, France–West Germany 0–2); France reads 1958 « 3e », 1982 « 4e », 1998 « Vainqueur ».
- The old editions' flags (user, 18 Nov: « n'hésite pas à mettre les drapeaux »): a country of today has its flag whatever the year; West Germany, Czechoslovakia and the Dutch East Indies the flag they played under; Yugoslavia's star (1946–1991), the Soviet Union, East Germany and Zaire drawn for the site (`competition-selector.css`). Tests first; 36 E2E checks on the local build against production data.
- Shipped 18 Nov: `42e6535247` (flags), `30b04f1239` (group tables whole in their cards; two points a win before 1994, found on the production screenshot of 1974); CI green on each branch before main; 38 E2E checks pass on vegasport.vercel.app. Evidence: scratchpad `evidence/EVIDENCE.md`.
- The nations' Elo is recomputed in production with the added results, as measured: Spain 1745, England 1700, France 1691, Netherlands 4th (8th before); France's series has 97 points (57 before).
- Left as they are: a country of today has today's flag in every edition; the four drawn flags are simplified for an icon; the group tables apply no edition-specific tie-breaker; the remote branches `claude/tournament-editions`, `-flags` and `-groups` are merged and can be deleted.
- The base on AWS checked on the user's question (18 Nov, evening): the 1,069 archived World Cup matches served by the read API equal the source one by one (one without a score in both); Deploy run 44351541140 « migration exit code: 0 »; no backend file changed since. Not done: a direct connection to the base. Evidence: `evidence/aws-base-check.json`.
- User, 18 Nov (« 74, 78, 82 … faut modifier ça »; « pouvoir cliquer sur les matchs »), shipped `5b08c5990e` and `e45bb0a88f`:
  - These World Cups had no quarter-finals: a bracket whose first round is played between group winners alone starts from those groups (1930; the second round of 1974, 1978, 1982); 1950's final round is its bracket (`bracketGroups`, `finalGroup`).
  - Every tie of 2026 and 2022 opens its match page: a tie's collected match is found within a day and under either spelling (8 of 2026's 32 ties did not open).
  - CI green on each branch before main; 47 E2E checks pass on vegasport.vercel.app.
- Decided by the user, 18 Nov (« c'est bien. Tu peux prendre cette data-là … tu la scrapes, tu la mets dans une base de données »): the Fjelstul World Cup Database, see the next section. The Euros stay without line-ups (no source).

## Player page — transfers on the market value curve (18 Nov 2026, scratchpad worktree `wt`, branch `claude/player-transfers`)

- Ask (18 Nov): on « Carrière et marché », the value curve shows, at each transfer's date, the crest of the club the player joins; for every player, not Giroud alone.
- Found: the card drew club markers from a `clubName` on each valuation, which the API never served; the base holds the transfers (`core.player_transfers`) and each valuation's club (reader, 114), and no route served them.
- Mockup validated 18 Nov (« Je valide et tu peux push sur Vega, c'est très bien. »): scratchpad `ab654013…/mock/`.
- API (migration 135, views only): `GET /api/players/{id}/transfers` (the transfers made, oldest first; 404 until read), `club` on each row of `/api/player-market-values`. A club of ours carries its id, our name and its crest; another one the provider's name; a name that is no club (the reader's `NO_CLUB`: « Without Club », « Retired »…) is null.
- Site, as validated:
  - a crest badge above the curve on a stem at the transfer's date; the club of the first valuation at the curve's start; a move after the last valuation extends the curve, dashed;
  - listed only: a return from loan followed by another move within 92 days, and all but the last move of one day; never shown: moves inside a club, a destination that is no club;
  - transfers not read: each club at the first valuation made there, said to be an estimate;
  - the list of moves under the chart; the same clubs on the report's value image.
- Decided while building (not in the mockup): badges close in time are raised and the chart grows by what the stack needs (the E2E found three moves of one winter covering each other when held inside the drawing); the dashed extension.
- Rules: `services/career-moves.js`; badge placement: `services/curve-badges.js`; tests written first (`tests/player-transfer-curve.test.mjs`, `tests/report-data.test.mjs`, `backend/api/test/player-transfers.test.mjs`).
- Validated locally: API 187/187 and Python 430 OK on a local PostgreSQL 18; site tests 725/725; build; 120 E2E checks on the built site (nine scenarios on Giroud's real rows, a route stubbed only to reach a state production does not offer). Evidence: scratchpad `ab654013…/evidence/transfers-ui/EVIDENCE.md` and `evidence/api-transfers/EVIDENCE.md`.
- Shipped 18 Nov on the user's word (« tu peux push sur Vega »): `14ce42f31b`…`21282e1a86` on main; CI green on the branch (run 44364988672) and on main (run 44366451074).
- Deployed 18 Nov on the user's word (« Autorise à déployer également, tu peux déployer. »): Deploy run 44368285359 green on `5956a83cd7`; migration 135 applied, the route answers.
- The first real rows showed three defects, fixed tests first (`df44c16350`, `fc0deba100`; CI on main run 44372136386):
  - the provider lists youth and reserve sides as clubs (« FC Barcelona U19 », « AS Monaco Youth »): one we do not hold is no club joined;
  - a move inside a club was dropped, so Yamal's curve started at « FC Barcelona Youth »: the promotion to the first team is an arrival, a move inside the club he is shown at is nothing;
  - « Tours FC (- 2025) » is shown « Tours FC ».
- Verified in production, nothing stubbed: 36 of 36 checks on Giroud (computer and phone); Mbappé, Yamal, Kane, Ødegaard and André Silva looked at, no error (`evidence/transfers-ui/live`).
- Coverage, read-only sample of 176 players (`evidence/transfers-ui/coverage/sample.txt`): 102 have a value curve; 96 of them now show clubs; 6 (met in 2022/2023, not yet read again) show none, as before. Transfers are read for 29 of the 30 best of 2026/2027 and for 81 of the 176.
- Left as they are: a club we do not hold shows its initials (« Tours FC », « Real Madrid Castilla »); a youth side named outside the reader's pattern (« Boavista FC CJ », « SC Salgueiros Y15 ») is still listed; touch was run in Chromium's emulation only.
- Linear: overlap check not done (the connector opens another workspace; nothing is written there).
- Next action: none; the reader reaches the remaining players on its own schedule.

## World Cup details — the Fjelstul World Cup Database in the base (18 Nov 2026, scratchpad worktree `e6ee2704…/wt`, branch `claude/worldcup-details`)

- Goal (user, 18 Nov): every World Cup match clickable with its details (line-ups…). The base held none for the archive (1930–2018). The user chose this source and asked for it in the base. This step is the data; the route and the match page come after (mock-up first).
- Source, read on its files: github.com/jfjelstul/worldcup at commit `35a8667f…` (11 June 2026), CC-BY-SA 4.0 (attribution and share-alike: the user was told and said yes). 30 tournaments (22 men's 1930–2022, 8 women's); stadium, referee, managers and scorers of every match; line-ups, cards and substitutions from 1970 only; squads; awards.
- Design (reviewed by an adviser agent, Opus, read-only; its points checked in the code before use):
  - its own typed tables `core.worldcup_*` (137), provider `fjelstul` (136); nothing written to `core.players`, `core.teams` or the base's line-ups: its people are its own;
  - the one link is a match's (`worldcup_matches.match_id`, cleared by itself when the archive replaces the match, made again at the next run);
  - 17 of the 27 files, each pinned by its SHA-256: a file that differs writes nothing; a later run reads no file;
  - the credit is the row `fjelstul-worldcup` of `core.source_revisions` (the existing table, not a new one);
  - kept against the adviser's advice: 2022 is paired too (the pair states which match it is; serving is the route's choice, and the site opens the collected match there).
- Measured before writing (read-only): with four reviewed spellings (United States/USA, Republic of Ireland/Ireland, Ivory Coast/Côte d'Ivoire, Bosnia and Herzegovina/Bosnia-Herzegovina) the 964 men's matches each pair with exactly one archived match, the scores agree on all; the one archived match without a pair is Sweden–Austria 1938 (a walkover).
- Validated locally: tests first (`backend/tests/test_sources.py`, samples in `worldcup_samples.py`); Python 435 OK and API 187/187 on a local PostgreSQL 18; a full rehearsal on a disposable base with the real files and the 22 real archived editions: 75,669 rows in 2.5 s under the collect role, 964 of 964 paired, 0 score differing, nothing written to the base's players; the worker's own HTTP client reads the 17 pinned files (largest 4.7 MB of 8 allowed). Evidence: scratchpad `evidence/worldcup-database/`.
- Not done: nothing is served yet (no route, no page); the site's « Licences » text must name this source as soon as a page shows its rows.
- Deploy: migrations 136 and 137 and the reader reach the base only with a Deploy run (135, the other session's, is deployed since 18:18 UTC: nothing else rides along).
- Linear: overlap check not done (the connector opens another workspace; nothing is written there).
- Shipped to main 18 Nov: `be54fcf8ff` and `4c02046447`; CI green on the branch before and after the rebase (runs 44372498360, 44373983731).
- Deployed 18 Nov on the user's word (« Deploie »): Deploy run 44383534681 green at 19:53 UTC (worker image `20798adfc3`, « migration exit code: 0 »: 136 and 137 applied).
- The load itself is not verified in production: it runs in the worker's source pass, no public route reads these tables, and the session has no AWS access. What is known: the isolated pilot of CI (run 44374914429, the worker's loop on the real sources in a throwaway base) logged `source=fjelstul scope=worldcup outcome=ok`; the worker already reads raw.githubusercontent.com with the same client (open-matchday). To see it: the status page (Vega Status, `/api/ops/status`): source `fjelstul`, scope `worldcup`, 75,669 rows and 0 unmatched expected.
- Corrected: the README said the archives' index lists this credit; it lists the `results/…` sources only.
- Archived match page: mock-up validated 18 Nov (« je valide cette maquette, tu peux la déployer »). Shipped `8b75b639c9` (route, migration 138: read views and `swapped`), `94f10abd7f` (page `/matchs/?cdm=M-YYYY-NN`, links from the archived editions' brackets and lists, the credit on « Données & méthode »), `8d34f457b8` (view count). CI green (run 44398331443); Deploy run 44399311535 green 21:22 UTC.
- Verified in production: the route serves 964 paired men's matches (1930–2022); the 1998 final as in the base; 14 E2E checks pass on vegasport.vercel.app (evidence `evidence/worldcup-page/production`). This also confirms the load of the database in the base on AWS.
- Next action: none for this; the user's next ask is the win-probability chart of a match page (mock-up first).

## Match page — the win-probability chart (18 Nov 2026, evening)

- Ask (user, 18 Nov, on the 2022 final): the chart's goal labels overlap, the scorers are not named, the end (3–3) is cut off; « plus propre … une espèce d'histogramme ».
- Found: the in-play model stops at minute 90 (`dashboard/shared/inplay.js`; `/api/forecasts/live` ends a finished match at 90): goals of extra time are drawn at the 90th minute (overlap, cut-off label); the end point is forced to « draw » at 3–3 though the match went to penalties; the collected 2022 final has no shoot-out score (the archive has 4–2); the chart never reads the scorers (`/api/matches/{id}/events` has them).
- Mock-up sent, awaiting validation: scratchpad `e6ee2704…/mock-wp` (`maquette-probabilite.html`, `shots/`): one stacked column per minute, home team's goals above (chips with minute, scorer, score), away team's below, two close goals on two rows; a « Prolongation » zone and a final « t.a.b. » column; the list of what each goal changed, with names.
- Open decision for the user: extending the model to extra time (proposed in the mock-up: the same rates over the 30 minutes left, a level score going to the shoot-out at 50/50) is a method change: measure, then ask, before applying.
- Next action: the user's validation and decision; then tests first, implementation, E2E, deploy.

## Competition scope — remove the leagues the user does not want (18 Nov 2026, scratchpad worktree `e03ea355…/wt`, branch `claude/prune-leagues`)

- Goal (user, 18 Nov, in French): remove the competitions listed below from collection and from the base, then update the competition list in `docs/vega-sport-data-coverage.xlsx`. Afterwards (next objective, not started): collect more seasons for every league kept, back to 2010 at least, the seven big European leagues first.
- Removed, PitchAPI (21): J. League `l_2ApGa4`, J3 League `l_3fglZv`, K League 1 `l_2EKrnc`, K League 2 `l_271pqa`, Indian Super League `l_1qpFVw`, Thai League 1 `l_3hW1NO`, Bolivia `l_4dzm4e`, Paraguay `l_4FPF2L`, Peru `l_3uNwVX`, Venezuela `l_1TVRZW`, Chile `l_3qNjzC`, China `l_20pNSc`, Egypt `l_46aZMC`, South Africa `l_1Kknkl`, Saudi First Division `l_3CB6qX`, Saudi Women's Premier League `l_1SGwQT` (men only for now), Virsliga `l_45xKXM`, Allsvenskan `l_1XsMdH`, Denmark 1. Division `l_1rPvVD`, MLS Next Pro `l_3Tn1kG`, USL League One `l_3Kf7Ni`.
- Removed, open-matchday (10): CYP_1, KAZ_1, SVN_1, IRE_2, IRE_3, SCO_2, SCO_3, SCO_4, WAL_2, WAL_3 (and engsoccerdata's Scottish second to fourth tiers, the same leagues' archive).
- Kept explicitly: France L1/L2, Italy A/B, Spain 1/2, Germany 1–3, England every level, Netherlands 1/2, Portugal 1, Brazil A/B, MLS + USL Championship, Saudi Pro League, Qatar, Liga MX, Denmark Superligaen, Hungary NB I, Ireland Premier Division, Norway Eliteserien, Scotland Premiership (and its cups), Wales Cymru Premier, Russia, Ukraine. Everything not named stays.
- Wanted but held by no source: National (FRA 3), Serie C, Primera Federación, Liga Portugal 2.
- Ambiguous, decided: « le Chili, donc la Chine » read as both removed (reversible by taking the key off the list); « MLS 2 » → USL Championship (« premier et deuxième niveau »).
- Linear: overlap check not done (the connector opens another workspace; nothing is written there).
- Done (branch `claude/prune-leagues`):
  - `backend/vega/scope.py`: REMOVED (21 PitchAPI keys), REMOVED_FOLDERS (10 + SWE_1_allsvenskan, else its copy returns once PitchAPI's league is gone), REMOVED_ARCHIVES (engsoccerdata/scotland/2–4, seen in production as « Écosse · Division 2–4 »).
  - Collection skips them: PitchAPI day calendar and catalogue (worker `_held`, `scope.kept`), league profile fetch, open-matchday, archive loader.
  - `scope.purge` (worker daily pass, once a UTC day): per competition, deletes rows blocking FKs first (read from pg_constraint), then matches, rounds, editions, competition, provider ids and jobs; marks the seasons' published player rankings stale (production's 2024/25 top 200 shows Bolívar players); stops monthly profile reads of teams/players left with no match. Teams and players stay.
  - Static lists trimmed: SportScore maps (server and site), league-rules.json, site league pyramid, COUNTRY_LEAGUES (LV, SE), Elo TIERS. Kept on purpose: power.WOMEN rule, cup-catalog display names.
  - Spreadsheet: 130 → 99 competitions, every tab, 5 count texts updated (subagent; checked by reopening, not in Excel).
- Not handled: orphan `agg.cohorts` of removed editions (not served: the only API view inner-joins competitions); logs (`ops.fetch_log`, `parse_failures`); global fitted models keep their earlier fits.
- Incidents: my first local PostgreSQL port (54319) was another session's server; `test_databases.py` dropped and recreated that server's `vega_v2_*_test` bases (not its e2e ones). The checkout was renamed to /home/romai/Vega at 22:35 (not by me); `git worktree repair` relinked this worktree and three other sessions' worktrees.
- Next action: full test runs, commit, push branch, CI; deploy only on the user's word; then seasons back to 2010 (big seven first).

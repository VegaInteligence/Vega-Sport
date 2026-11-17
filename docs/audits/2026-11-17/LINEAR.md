Le rapport date ses observations. Ses chemins de preuve sont relatifs au sous-dossier correspondant de l’archive de vérification fournie avec la revue.

**Clôture de la vérification de déploiement.** Les huit tickets du tableau étaient clos à la relecture. Le [rapport](README.md) ajoute les vérifications en navigateur et les résultats RDS complémentaires après le premier passage.

# Recently closed Linear issues versus current source and observable API

Source reviewed at `8018e0836ca0f32e8b2eb51fc2847154abff7f13`. Issue requirements/comments were read from `../linear.json`. That saved snapshot still has VI23/VI26 In Progress; root independently refreshed Linear later and reported both Done. The distinction is intentional. No issue ownership/status was changed here.

Root's `../production-release.json` records deployment at the same SHA: worker/backfill revision142 running, deployment complete, Vercel SHA8018e0836c, API archive byte-identical to the recorded current local package. This agent made no AWS calls. Source presence, local behavior, live endpoint response and data recomputation are separated below.

## Independent checks executed

- Current existing Python source-identity parsing and power suites: **51/51 passed**, `closed-issues-python.stderr.log`.
- Current existing JS paired-support, missing-value render, neighbour consumers, chronology and API nations tests: **21 passed,1 DB-dependent test skipped,0 failures**, `closed-issues-js.stdout.log`. These are focused existing tests; they are not full browser E2E or complete database integration.
- Public HTTP observations with exact URLs, UTC timestamps and response headers: `public/reads.json`, raw `public/{nations,france,italy,search-paris}.json`; separately `public/similarity-observations.json`.
- Exact commands/environment note: `closed-issue-test-manifest.json`. Public rerun scripts: `public_check.py` then `public_similarity.py` (read-only).
- No frontend build/layout browser matrix was rerun by this agent. VI17's existing React render helper writes into the repository cache, outside this read-only implementation assignment, so its source assertions were inspected but not executed here.

## Issue-by-issue disposition

### VI-17 — Player/club page layout and team context

**Source implemented; current full visual acceptance unverified.** Requirements include subsequent approved changes (remove role gauge, keep team-context design, make identity club link navigable). Current PlayerSeasonProfile has the rail Rapport link to `/rapport/`, profile filter bar, honours hook/rail and TeamContextCard inside the advanced view. PlayerScoutOverview renders the style tags and stats shortcut. ClubScoutTabs has Rapport beside Bookmark in the same toolbar. `club-scout.js:257–301` retries a failed cached read once before actionable retry, supporting the Madrid transient-context fix. Existing `season_player_render.test.mjs` asserts the single filter bar, removed season heading, role bars, moved team context and honours rail.

The Linear close comment supplies earlier1440/393 browser evidence but explicitly did not check light theme or641–1280 intermediate widths. No new source defect established here; no claim those historical screenshots prove today's layout. Current deployment SHA corroborates that the code is served, not the visual acceptance itself.

### VI-18 — Nations index/detail/navigation

**API present and sampled current behavior confirmed; data completeness remains deficient independently of page implementation.** Migration119 functions and120 archive-copy enrichment exist; route `nations.mjs`, nation pages and search/navigation links exist. Public list currently returns153 nations,54 ranked. France detail contains22 players, current record6 matches4–1–1 and tournament history; Italy detail is served under one canonical ID. Existing three pure API cases passed; the DB route test was skipped.

The new source defect is visible on live pages: France1998 remains `Finale`, Italy1982 remains `Finale`. France's97 match rows include40 `not_started`; Italy's100 include61 `not_started`, mostly historical scored matches lost by the array-score parser. These are direct current outputs, not proof the source itself lacks results. Root's pinned upstream comparison establishes the parser cause and VI27 repair scope. After parser replay, recheck actual stages/statuses on the same public IDs.

Residual source findings from prior audit remain distinct: `api.nation_list` counts all scheduled/stored matches, not finished-only; `api.nation_players` selects and aggregates without a finished-status filter; `tournamentRuns` treats latest scheduled round as reached; migration120 independently maximizes penalty components across copies. They need measured incidence/failure-first cases before any owner-scope correction. Existing page tests do not close these cases.

### VI-20 — National identity merge and all national matches in Elo

**Specific live acceptance confirmed; universal identity integrity still belongs to root's DB audit.** Current `identity.nation_twins` retains source-only national merges and preserves separate historical states; parser tests exercised these cases. Public list has exactly one France and one Italy/Italie entry,54 ranked/153 total. France `t_2ysHaw` has ranking6 matches4–1–1 and page6 matches4–1–1. Italy `t_v0001032` has ranking6 matches3–1–2 and identical page record. This directly confirms the originally discrepant France/Italy case and non-PitchAPI nation ranking.

Current Italy label is `Italie`, while the old close comment described an English name retained; canonical identity and results agree. A display-label variation is not evidence of a duplicate. Root must verify every mapped/merged ID, foreign key and eligible national match rather than generalize from this pair. Historical parser loss remains outside the national merge acceptance and now has VI27 scope.

### VI-22 — Club similarity, links, featured competitions and inherited support display

**Source and focused render/service behavior confirmed; principal live API behavior confirmed.** API similarity code preserves supported axes/minimum common support, same-sex cohorts and the approved continuous league-level penalty. Legacy browser similarity was removed; default comparison/suggestions use `useClubNeighbours`.

Live PSG default route returns10 neighbours from1162 compared clubs across several countries: Barcelona87, Inter84, Toluca83… Restricted SerieA returns10 from20, Inter84, Como79… Every restricted row carries the SerieA ID; Inter's similarity84 agrees across views. Exact responses/URLs are saved. This verifies all-league default and same calculation under league restriction at API level.

Source includes absent UEFA message in ClubRanking, report/club/match links and10 featured competition slots. Inherited VI23 support consumers now use paired fields, mean×own-coverage, null-preserving sums and map headers; the existing support/render/neighbour/chronology tests passed. B7 chronology eligibility changed, but duration arithmetic still uses minuteAdded/100 and an assumed93-minute minimum. Thus the expanded audit's real-duration demand remains open despite the ticket's missing-minute rendering fix. No new1440/393 browser navigation/layout matrix was run here.

### VI-24 — Dependency/toolchain refresh

**Requested declared versions and workflow configuration present; root release evidence corroborates current deployment.** Manifest/lock inspected: Next16.4.6, React/ReactDOM19.3.1, lucide1.74.0, speed-insights2.1.0, prettier3.10.1; API pg8.23.1; requirements psycopg3.3.9/boto3 1.44.4. Bun1.4.4 in packageManager/CI/deploy; Node26 site and24 API/deploy; actions v7 and pinned AWS credentials v6.3.0 SHA. Lambda24 remains deliberate.

This confirms the versions requested by the issue, not a fresh registry-wide claim that every dependency remains latest. Linear supplies historical CI/build/pilot/deploy evidence; this agent did not rerun those workflows or image builds. The root's current API/runtime and deployment artifact checks are stronger evidence than the old close comment alone.

### VI-25 — Python3.14 worker/CI

**Source present and deployed image lineage corroborated; runtime/log verification belongs to root.** Dockerfile `FROM python:3.14-slim`; CI and pilot setup-python3.14; README prerequisites updated. The current image SHA contains the change; root release evidence records worker/backfill running the matching image. The original comment reports Python3.14.4/local suites, CI/image import and no errors after restart. Current51 pure tests here ran with the interpreter recorded by the reproduction manifest (inspect version), but do not replace full PostgreSQL suites, image-import or current worker-log acceptance.

### VI-23 — Independent calculation fixes and stage8 scoring

**Source integration reviewed; prior checkpoint's last-review/quota/coverage statements are historical.** Current migrations128–132 and matching calculator/API/client changes include stage8 `agg.match_scoring` from credited goal-event teams and reconciled penalty shots; the earlier goal-shot NULL own-goal blocker and unmeasured summary peers are addressed in source. API match-record embeds `ownGoalsFor`/`penaltyAttempts`; client uses that common contract. Focused paired-support/missing-render tests passed.

WORKLOG/Linear report migrations applied,2149-edition recompute, zero club seasons without paired support, xg-v2/returns-v2 and all profile-embedding-v2 seasons. Root's current read-only DB results are now attached (`../db/model_verified/`); Astra independently decoded the recorded migration checksum bytes and matched migrations128–133 to current source SHA256, all six equal. The cohort query returns2155 rows, all `club-indicators-v2`; `team:2021:europe` now has133 clubs and updated18:23:32.832024UTC. The xG model query has one `xg-v2` fit,1,798,648 training shots, fitted14:21:21UTC. Compact verified summary: `current-model-summary.json`. This corroborates schema/model/cohort migration, not every individual score's correctness or predictive validation. Closing VI23's bounded independent scope does **not** close original items assigned to VI19/VI21; see MATRIX. B7 server running-score/NULL crash remains outside its completed work.

### VI-26 — Maximum cohort wait

**Source implementation, test definitions and current cohort republish evidence confirmed.** Migration133 adds non-null `first_queued_at`; remark operations preserve it. `models.process_cohorts:749–776` computes earlier(last-mark+10min,first-mark+60min), sorts earliest due first, retains revision-protected delete and resets first-wait on a concurrent remark. Existing `test_z_cohort_queue_has_a_maximum_wait` covers debounce/max/order/remark; existing `test_z_cohort_re_marked_every_minute_is_still_refreshed` uses real refresh over70 simulated minutes and expects Europe at10 and repeatedly marked club at60.

Those DB tests were inspected, not rerun by this read-only agent. Root current release shows HEAD8018e0836c deployed. Current DB evidence confirms migration133 with byte-matching source checksum and `team:2021:europe` republished at18:23:32UTC in `club-indicators-v2` with133 clubs; its named starvation incident has cleared. Do not retain the saved earlier Linear/WORKLOG 'not pushed' statement as current fact. Also do not interpret due-at60 minutes as a strict completion guarantee under an unbounded queue; the per-pass50 limit and worker health still matter.

## Closure conclusion

Current source supports the narrowly described deliveries for all eight tickets. VI20's original data disagreement and VI22's similarity API behavior are independently confirmed live. VI18's page exists but now exposes a confirmed ingestion loss; recent closure does not establish comprehensive correctness. Current DB/version evidence corroborates VI23/VI26 migration and resolves the named stale2021 cohort incident. Original numerical/causal/time/forecast defects are still reproducible and remain separately assigned; they must not disappear from the final audit because neighbouring issues are Done.

Latest user decision on new icon work: authentic relevant provider/source emblems only, no generic logo or substitute. Existing frontend visuals are excluded; the new work collects/maps assets into the existing data contract. This overrides Fable's proposed generic fallback option.

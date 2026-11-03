# Worklog

## Goal and constraints
Complete the user-authorized rematerialization until `remaining: 0`, resuming with queue_all=false only after an incomplete run. Then verify the new fields through the deployed STATARENA site, including actual browser rendering and inspectable E2E evidence. Keep the shared ingestion queue/lock and use stored responses; no new source collection is needed. Read Neon diagnostics through the runtime role. Previous code and launch records are pushed in 25033cbaa8 and bb7812bd1e.

## Decisions and implemented behavior — 2026-11-03
- Each page remembers its season in the browser tab. Header/loading navigation restores the destination page’s season; explicit match/player links retain their source season. Invalid or blocked storage falls back safely.
- New profiles start with Top 7 Europe + UEFA enabled. Explicit All/custom preferences remain available. Footer removed from rendered pages and loading shells.
- Shared country groups now organize competition selectors in players, calendar, clubs, club analysis, archives, comparisons, supplemental competitions and the home picker. Existing country names and league pyramids are reused; option values and selection handlers are preserved.
- Home omits empty weekly wrappers and redistributes available cards. The title-race chart measures its real container, shows six teams and fills its width. The weekly match uses independent chart/stat columns; the player card and wider xG tooltip stay compact.
- Finishing shows eight real players in each mode; scorers/assists show ten. All four modes link to the complete player directory with the same season, competition cohort, ranking and totals active. Ranking definitions and eligibility are shared; cohorts survive profile/comparison navigation.
- Le mur shows three distinct defensive clubs and actual played/conceded/clean-sheet statistics. Its stack respects content height so the final team is not clipped.
- User clarified À ne pas manquer: include saved clubs and current clubs of saved players from every saved list. Personal matches lead; within a Paris day, order Champions League, Europa League, Conference League, then domestic. Preserve active competition scope and seven-day horizon. Current player clubs use the latest observed club performance in the loaded season; old and national-team affiliations are excluded. No personal choices retains editorial fallback.
- Enrichment normalizer, match-detail merge, nightly reload and `neon_materialize.py --all` already existed. Added the missing manual `rematerialize.yml` and `docs/REMATERIALIZE.md`, sharing the ingestion queue/lock. Production execution is not claimed. Read-only samples of Ligue 1 across six seasons still lack the new columns.
- UX: independent filters, clear country groups, compact data-filled cards and relevant fixtures. DX: shared selector/ranking functions and the existing publication command. AX: explicit URL state, accessible controls and inspectable receipts. Personalization cannot infer an affiliation absent from loaded observations.

## Cleanup and integration
- Removed 42 reviewed unused copies: 39 tracked numbered files, one identical prototype alias, and two subsequently reappearing untracked numbered variants. Byte-identical and differing historical variants were distinguished before deletion. All were externally archived and hash-verified; tracked copies remain recoverable from ce21ca42a1. Canonical files and distinct prototype options B/C remain.
- The unpaired `data/computed/pitchapi-world/queue 2.sqlite-wal` is not an established duplicate and remains. No numbered source copies remain in the final scan.
- Two invalid iCloud Git ref placeholders named `main 2` were moved outside the active ref namespace without hydration or deletion. Recovery metadata lives in `.git/codex-ref-quarantine-20261103`.
- Preserved and fast-forwarded remote work through 830c82e6c6 without overlapping application edits. No force push or rewritten remote history.
- Sport Prediction is a separate repository; its original uncommitted work is untouched.

## Verification and evidence
- Before implementation, recorded failure modes for per-page seasons, invalid storage, active/default filters, empty widgets, preserved interactions, ranking/cohort navigation, personal fixture priorities, country grouping and recoverable cleanup.
- Browser workflows cover navigation/reload/history, new and saved preferences, loading shells, archived/current home at desktop/tablet/mobile in both themes, ranking shortcuts/profile/comparison scope, all affected country selectors and controlled personal fixtures.
- A manual screenshot review caught a negative defence bottom gap in an earlier passing layout run. Fixed the stack’s flex sizing and strengthened assertions to reject clipping as well as blank space. Final measured bottom padding: 17px for defence/title/scorers; weekly match 681px versus 796px before.
- Earlier harness failures (transient navigation reads, wrong native-dialog/searchbox selectors and unsupported dynamic import) are retained alongside corrected runs; they are not counted as product passes.
- Production build passed after the final application changes. Workflow YAML/Bash and the real materialization CLI help/local-write guard passed; GitHub execution and full historic regeneration remain unverified.
- Working evidence: `output/playwright/page-seasons-layout-20261103`. Durable scripts, logs, reports, screenshots and exact rerun instructions: `docs/verification/page-seasons-layout-20261103`.
- Suggested commit: `fix: refine home widgets and grouped competition filters`.

## Current operation and next action
- Run 41711363014 on main/25033cbaa8 was cancelled after discovering that archive-only matches were skipped. It originally queued every published partition with queue_all=true, minutes=100, batch=10. Do not requeue all seasons again.
- Read-only Neon checkpoint at 2026-11-03 21:09:26 UTC: 150 dirty partitions remain (2023/2024: 6; 2024/2025: 41; 2025/2026: 47; 2026/2027: 56). Earlier seasons have left the queue. The materialize state receipt is written only at the end of the run.
- Production deployment is READY on bb7812bd1e (`dpl_8tBsCbUHNbMAFA7L1i9QEozz7WxU`), serving https://statarena-analytics.vercel.app. Code availability and data regeneration are separate boundaries.
- Verification plan: capture workflow logs and remaining count; compare manifest/packed columns through the public origin; find actual non-null new shot/player/match values; verify home shot endpoint/height and preserved interactions in desktop/mobile browser. Save exact setup, URLs, commands, reports and screenshots. No new isolated unit tests.
- UX: visibly richer real data. DX: reuse the materializer and explicit retry flag. AX: workflow run IDs, read-only counters and reproducible browser evidence. Do not claim completion from a successful dispatch or partial column sample.
- Next: monitor this run, resume incomplete work if needed, verify all published partitions and the production UI, then commit/push the completion evidence. Suggested commit: `docs: verify dashboard rematerialization and production data`.

## Discovered publication defect — before implementation
- Public six-season Ligue 1 samples show that old partitions have a new neonDigest but still lack the new columns. SQL confirms 380 archived fixtures in 2021/2022 and zero corresponding /matches resources; their full responses live in observation shards. The materializer currently skips every finished fixture without a newer standalone match-detail resource, so it clears old dirty partitions without normalizing their stored responses.
- Requested cancellation of run 41711363014 to replace this faulty path. No successful completion or remaining:0 is claimed.
- Failure modes / expected outcomes for the fix: archive-only players/shots/lineups/stats must rebuild without a standalone match summary; a stored summary must still augment fixture metadata; recent successful resources override archived responses; missing/failed families preserve existing normalized data; uncollected matches are not invented; no upstream provider request occurs. Read archived response tables once per shard rather than once per match.
- Write and run a PostgreSQL materialization integration workflow before changing the implementation, using an isolated temporary local database and stored object fixtures. First capture the archive regression failure, then fix the materializer and rerun the same workflow. Production fixture writes are forbidden.
- Because earlier partitions were incorrectly cleared, the corrected version needs one new full queue initialization; later resumptions must use queue_all=false. Suggested commit: `fix: rebuild archived dashboard partitions from stored responses`.

- PostgreSQL regression was written before the fix: three archive cases failed and the current-resource case passed. After the fix, all four cases / 27 assertions pass; existing daily and pulse publication workflows also pass for MLS and Saudi Pro League. The fix loads resource/observation indexes per partition, indexes archived response tables, merges archived match summaries and preserves player references when that family is missing. Ready to publish the fix and restart the full queue once.

# Worklog

## Goal and constraints
The home/filter changes and cleanup are pushed in 25033cbaa8 on main. Current user request: verify publication and launch the full Rematerialize Dashboard workflow. The user explicitly authorized this production publication on 2026-11-03; the previous read-only/no-dispatch constraint belonged to the earlier delivery. Use stored Neon responses, the existing shared queue/advisory lock, and no provider collection. Record the launch and observed status; do not equate launch with completion.

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
Previous delivery: 25033cbaa8 is pushed, with 10 passing browser workflows / 131 assertions, successful build and all 42 reviewed copies removed. Initial check found a clean worktree and exact local/remote commit match. GitHub reports zero prior Rematerialize Dashboard runs. Launched exactly once on main with queue_all=true, minutes=100 and batch=10. Run 41711363014 is verified pending behind Daily Sync 41690340992 in the shared ingestion queue; no rematerialization job has started and completion is not claimed. Receipt: `docs/verification/rematerialization-launch-20261103/launch.json`; the runbook records this launch. Two unused numbered copies reappeared during the operation; both matched committed canonical bytes, were externally archived/hash-verified and removed. Their receipt is alongside the launch record. Publish these operation records, then verify the clean worktree and remote commit. Suggested commit: `docs: record dashboard rematerialization launch`.

# Worklog

## Goal
- Publish the five new local UI commits to main without pulling raw data into Football_ranking. Preserve the completed Neon transfer, disabled collection workflows, remote history and unrelated local files.

## Constraints and decisions
- Preserve source files, existing app contracts, Postgres data and unrelated local UI changes. No source deletion or app read-path cutover.
- Use the final published GitHub commit as authoritative. Local untracked/iCloud duplicates remain in place; unpublished cancelled-runner work is not claimed recovered.
- Archive parts retain original data/ paths and exact bytes. Manifest maps files to parts, sizes, SHA-256 and Git blob hashes. Tradeoff: individual files require extracting their part; this is Object Storage delivery, not a SQL-table import.

## Current state — 2026-11-03
- UI publication: five local commits f75d670a30, 154820751e, b2ec625a71, b9a2418a56 and 8f2d6c17e2 replayed without conflict onto remote main 0aad2d5 in isolated sparse/partial worktree /tmp/statarena-push-ui-second-20261103. Raw data excluded; only the computed dashboard manifest materialized. Production build passed and 7 existing targeted checks passed. No new tests or browser E2E. Evidence: docs/verification/ui-publication-second-20261103/RESULTS.md.
- Five workflows disabled: historical catch-up, daily refresh, cups, profile retries, PostgreSQL measurement. Active runs 41605061706 and 41612686123 cancelled; final scan found no active/queued StatArena runs.
- Source commit: 579b47107e0cd4fa4f9a12a5a95dd6a1be274ed9. All 250,748 tracked data files transferred (2,692,640,453 original bytes).
- Target: project sweet-queen-11955006, production branch br-mute-bonus-be23014e, private bucket statarena-data, prefix snapshots/579b47107e0cd4fa4f9a12a5a95dd6a1be274ed9/.
- Neon contains 25 objects totaling 2,691,390,896 bytes, within the 5 GB free object allowance: 21 tar.gz parts, per-file manifest, README, snapshot inventory and VERIFIED receipt.
- Verified every source Git blob, reopened all archive members, then independently downloaded/hash-checked every remote object. Connector key/size inventory exactly matches all expected objects. Signed URL material removed; no reusable credential created.
- Evidence and exact rerun/restore commands: docs/verification/neon-data-migration-20261103/RESULTS.md. Failure modes were documented before implementation; no post-implementation unit tests.

## Prior project continuity
- Concurrent UI publication preserved: four local UI commits replayed onto data checkpoint 579b471 and published at 472cf06; verification artifacts published at 3222283. Production build and existing competition-render check passed; no new full browser E2E was claimed. Evidence: docs/verification/ui-publication-20261103/RESULTS.md.
- DataScout player/club/match enrichment remains delivered; preserve the neutral/blue palette, Inter, green branding and SportScore attribution. XI builder/transfer-squad simulator remains excluded. Prior coverage and UI verification: docs/DATASCOUT_IMPLEMENTATION.md and dashboard/outputs/datascout-enrichment/.
- Historical collector supports complete_with_errors terminal country traversal; refused resources retain evidence. Latest user-selected API key stays in the encrypted GitHub secret, but all actions are now disabled at user request.

## Next action
- Publish the five UI commits and verification receipt with a normal fast-forward push, then verify the remote head. Original local main and untracked files remain unchanged; no pull/reset. Neon transfer is complete and collection workflows stay disabled.
- Suggested commit: docs: record second UI publication verification.

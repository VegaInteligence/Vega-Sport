# Worklog

## Goal / constraints
Complete the Neon-only migration, preserve all user UI commits, keep two ingestion workflows, and free SSD space only after exact backups and live validation. Preserve unknown iCloud files and unrelated worktrees. Runtime is read-only; Pitch credentials belong only to GitHub Actions. Use reproducible E2E evidence.

## State — 2026-11-03
- Live Neon runtime deployed and promoted. All 250,748 original files / 2,692,640,453 bytes verified by path, size and SHA-256; no missing resource references. Original mutable manifests retained as versions.
- Indexed PostgreSQL plus private object storage; bounded pooled connections, coalesced caches, ETags and same-region functions. No disk/GitHub/Pitch fallback.
- HTTP E2E 50 checks, nine browser pages, match/profile interactions and isolated ingestion failure/retry/dedupe tests passed. Evidence: docs/verification/neon-runtime-20261103.
- Daily Sync and Historical Backfill both passed on GitHub; all legacy ingestion workflows and Git data files retired. Latest Pitch secret preserved. Runtime secrets are read-only; Pitch removed from Vercel and local environment.
- User homepage 00be3aa preserved as c9ffb5c; new club layout 2186cc1, coach portraits 0eb953a and retry c21380d integrated. Their completed one-off portrait workflow is retired; Daily Sync retains portrait refresh.
- Deleted 126,205 local files after exact Neon verification (3,507,556,352 allocated bytes) and 21 verified generated archives (2,665,742,336 allocated bytes). One unverified iCloud WAL remains, occupying zero SSD bytes.
- User authorized deleting validation branch br-frosty-sunset-bejbcw5o; deleted. Only production remains. Latest checked SQL ~570 MB; catalog objects ~3.93 GB; zero missing resource references.
- Original local main saved at codex/pre-neon-local-main-20261103, then synchronized without overwriting user commits. Unrelated numbered copies and other worktrees preserved.

## Final cutover
Latest UI deployed and promoted with 50 HTTP checks, nine browser pages and 11 interactions passed. Actual functions pinned to cle1 near Neon after verifying deployed metadata. Historical run 41664756751 collecting (60-minute budget); both scheduled workflows active. Exactly two repository workflow files; GitHub's public-repository Dependency Graph system workflow is independently managed.

## Next action
Persist the final evidence on main and remove the now-redundant owned migration checkout. No implementation work remains; historical discovery continues through the ingestion jobs.

Suggested commit: chore: finish Neon cutover and verified SSD cleanup.

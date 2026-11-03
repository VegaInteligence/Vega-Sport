# Worklog

## Goal
- Finish the Neon migration: Neon-only runtime, two direct-ingestion workflows, integrity/performance/E2E validation, then remove verified migration dumps and redundant local data.

## Decisions and constraints
- Archive-only presentation was the wrong format for the user's request. Replaced our generated archive objects with one private object at each original repository-relative path in the existing statarena-data bucket.
- Preserved GitHub/local source copies, original compressed source files, Postgres data, app read paths and unrelated UI changes. No extra buckets or public access.
- Replaced cloud archives part by part after verifying their members; stayed within the 5 GB free allowance.

## Current state — 2026-11-03
- Target: Orion / Orion Tech Sport, project sweet-queen-11955006, production br-mute-bonus-be23014e, private statarena-data bucket.
- Exact source: 579b47107e0cd4fa4f9a12a5a95dd6a1be274ed9. Bucket now contains only data/ and all 250,748 original files (2,692,640,453 bytes). No generated snapshots/ objects remain.
- Structure: data/README.md (1 file), computed/ (200), raw/ (245,215), sources/ (5,332).
- Every source SHA-256 checked; every upload's Content-MD5/server ETag matched. Independently downloaded 63 samples. Full paginated whole-bucket inventory matched every key, size and ETag; final live E2E succeeded.
- Grouped listing returned 504 and one intermediate audit hit a connection error; final flat audit succeeded without reuploading. Browser UI rendering was not tested. Evidence: docs/verification/neon-file-layout-20261103/RESULTS.md and VERIFIED.json.
- Temporary scoped credential revoked; local credential file removed. Local resume state and archives remain outside Git for inspection. No uploader remains active.
- All five StatArena workflows are disabled; no active/queued runs. No further collection or profile retries requested.

## Prior continuity
- Second concurrent UI publication preserved at aae6fcd: five local UI commits f75d670a30, 154820751e, b2ec625a71, b9a2418a56 and 8f2d6c17e2 replayed onto 0aad2d5. Production build and seven existing targeted checks passed; no new browser E2E. Evidence: docs/verification/ui-publication-second-20261103/RESULTS.md.
- Concurrent UI publication and verification remain preserved: 472cf06 / 3222283; docs/verification/ui-publication-20261103/RESULTS.md. Preserve neutral/blue palette, Inter, green branding and SportScore attribution; XI builder remains excluded.
- DataScout coverage and earlier UI evidence: docs/DATASCOUT_IMPLEMENTATION.md and dashboard/outputs/datascout-enrichment/.
- The original archive-delivery report is marked superseded, retaining historical provenance. The user-selected PitchAPI key remains only in the encrypted GitHub secret; Actions are disabled.

## Current direction
- Work in isolated codex/neon-central-data-runtime; preserve active UI work in the original checkout.
- Keep the verified original files in private Neon Object Storage, with a compact indexed PostgreSQL catalog, ingestion queue and hot documents. Respect the Free plan's 1 GB SQL / 5 GB objects limits.
- Runtime gets read-only Neon credentials, no Pitch key, GitHub data URLs or filesystem fallback. Provider calls and supplemental source refreshes belong only to Actions.
- Validate a Neon test branch before production. Old workflows remain disabled until the replacement passes; delete redundant files only after backup/hash verification and cutover.
- Vercel connector can inspect the project but env listing returned 403; check the authorized CLI fallback before deployment.

- New steering: integrate the user's newly committed local main homepage changes before publication, preserving uncommitted work.

## Next action
- Document E2E failure modes, implement catalog/bootstrap and read-only backend; validate real data before enabling Daily Sync and Historical Backfill.
- Suggested commit: feat: centralize StatArena runtime and ingestion on Neon.

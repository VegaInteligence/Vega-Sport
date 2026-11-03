# Worklog

## Goal
Complete the Neon-only migration, publish the user's latest homepage, keep two ingestion workflows, then free SSD space only after verified backups.

## Constraints / decisions
- Preserve all user UI edits and data. Isolated branch codex/neon-central-data-runtime; primary checkout main retained.
- Raw files stay private in Neon Object Storage; indexed PostgreSQL catalog/resources/fixtures and hot compressed views stay below 1 GB SQL / 5 GB objects.
- Runtime uses read-only pooled SQL and read-only S3. Pitch credentials belong only to GitHub Actions. No GitHub/local/provider data fallback.
- E2E-only changes: acceptance plan written first; reproducible evidence under docs/verification/neon-runtime-20261103.

## Progress — 2026-11-03
- Imported and compared every original path/size/SHA-256: 250,748 files / 2,692,640,453 bytes; 401,180 resource references; 53,854 fixtures. No missing resource objects. SQL initially 439 MB.
- HTTP E2E: 50 checks passed, all nine pages, archive/profile/fixture contracts, gzip hashes, HEAD/304, validation and concurrent warm loads.
- Real Neon ingestion E2E passed on isolated branch storage: 403/404 continuation, fatal 401, 429 retries, dedupe, lease recovery, locking, normalized views. Preserve failed fixture attempts as evidence.
- Copied all 32,298 display image URLs (272.5 MB), no failures, plus 730 supplemental projections; unknown source profiles remain unavailable.
- User's local homepage commit 00be3aa integrated as c9ffb5c. Adapted its SVG logos to Neon; all other homepage behavior preserved. Local main fetched for ancestry-preserving integration.
- Runtime secrets configured in Vercel and separate ingestion secrets in GitHub. Existing Pitch secret untouched; remove obsolete Vercel/local key after successful cutover.
- Additional local files inventoried (~592 MB), backing up at original Neon keys with server MD5 and independent GET SHA-256. First catalog finalization lost an idle connection; reconnect/resumable retry underway. Nothing deleted.

## Next actions
Finish browser/production E2E, publish and validate the new Actions, retire old workflows and repository data, then delete verified local migration artifacts and redundant data. Save cleanup and performance receipts.

Suggested commit: feat: publish Neon ingestion workflows and preserve the updated homepage.

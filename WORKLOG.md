# Worklog

- Goal: repair the Compétitions loading failure while preserving the faster data loader.
- Cause: the page read chunk.meta.seasons, absent from compact manifests. The European fixture filter also hid API schedules because their league identity was only present on the response envelope.
- Changes: derive native source seasons from compact competition records, with canonical metadata fallback; carry envelope league and requested source season onto league fixtures while preserving date-scoped response identities.
- Verification: both failure modes reproduced before correction. Actual React component renders for both manifests (classic seasons, calendar years and World Cup); real HTTP schedule contract passes. Browser lists 10 top-Europe competitions, shows 30 Ligue 1 fixtures, and switches correctly to 2024/2025. All 27 Python / 55 Node checks passed.
- Evidence: dashboard/outputs/competitions-fix/ includes failed baselines, render/HTTP tests, regression logs and browser results.
- State: fix committed/pushed at 06c8b33a and deployment READY. Public browser verified the 10-card directory, 30 Ligue 1 schedule rows, valid match links and return navigation, with no console errors.
- Suggested commit: fix: restore competition directory and league fixtures.

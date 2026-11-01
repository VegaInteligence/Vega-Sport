# Worklog

- Goal: reduce first-load time and competition/season transitions without introducing a database or losing data.
- Baseline: 45 competition chunks × 8 serial table requests per chunk, each redirected through Vercel to immutable GitHub data; 19.8 MB compressed for the current season and 48.4 MB for 2025/26. A league filter still loads every league. Browser baseline on top-Europe scope showed 80 table requests and an individual shot request taking 6 seconds.
- Direction: derive lossless packed dashboard views under data/computed, one request per competition; a small serving manifest, direct immutable data URLs, league-scoped loading and bounded reuse. Keep raw data authoritative and wire view regeneration into normal publication.
- Constraints: preserve all routes, filters, match/player statistics and exports; retain current geographic/season scope. Never hide missing fields behind defaults or invented values.
- Verification: write a reproducible E2E contract before implementation; compare complete decoded views to canonical tables, exercise real browser cold loads, filters, details and back navigation. Store baseline and final evidence in dashboard/outputs/loading-performance/.
- State: lossless views validated across 1,928,898 table rows; real HTTP output equals canonical loading; local browser filters, player and match details, historical season and cache reuse passed. 27 Python / 53 Node checks and daily-publication E2E passed. Production deployment cd406420 is READY and serves the optimized data directly.
- Result: deployed data loading measured at 1.97 s for the complete current season (previous 16.94 s) and 0.28 s for a single league (previous scoped-loader baseline 6.06 s). Production browser filters, all 45 competitions and World Cup reuse passed without console errors.
- State: task complete; figures are observations for this network/cache, not guaranteed per-visitor timings.
- Suggested commit: perf: reduce dashboard data requests and first-load payloads.

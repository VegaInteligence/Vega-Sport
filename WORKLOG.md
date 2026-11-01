# Worklog

- Goal: add Vercel Speed Insights and Web Analytics to the shared Next.js layout; commit all work in separate, clearly described commits and push main.
- Preserve: Bun workspace/lockfile, native Bun API, canonical JSON, daily worker, seven-link topbar and unified Matchs views. No data or design changes.
- Direction: install each SDK in dashboard/frontend with Bun, use the requested /next components once in the root layout outside the data-loading boundary, and keep server/client boundaries intact.
- Progress: @vercel/speed-insights 2.0.0 and @vercel/analytics 2.0.1 installed in the frontend workspace; both requested Next components mounted once in the root layout. Frozen Bun installation, production build, real HTTP E2E and all existing 27 Python/53 Node tests pass.
- Verification: integration 062539f5 is live (dpl_4NbB6HTsnRkstJ1YDqPjfdXU1QdX, READY). Both scripts load once with HTTP 200; real Analytics pageviews and Speed Insights vitals POSTs return 200 after navigation. Seven browser evidence checks and the public Bun/data HTTP E2E pass. Vercel displays five Speed Insights events and four page views from one test visitor. Evidence in dashboard/outputs/vercel-insights/.
- State: requested integrations complete and verified on https://orion-football-ranking.vercel.app. Separate integration commits are pushed; final evidence commit contains documentation only. No application work remains; final deployment receipt is stored in ignored dashboard/outputs/daily-refresh/.
- Commit names: feat: add Vercel Speed Insights; feat: add Vercel Web Analytics; docs: record Vercel insights verification.

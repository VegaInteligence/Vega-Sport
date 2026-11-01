# Worklog

- Goal: add Vercel Speed Insights and Web Analytics to the shared Next.js layout; commit all work in separate, clearly described commits and push main.
- Preserve: Bun workspace/lockfile, native Bun API, canonical JSON, daily worker, seven-link topbar and unified Matchs views. No data or design changes.
- Direction: install each SDK in dashboard/frontend with Bun, use the requested /next components once in the root layout outside the data-loading boundary, and keep server/client boundaries intact.
- Progress: @vercel/speed-insights 2.0.0 and @vercel/analytics 2.0.1 installed in the frontend workspace; both requested Next components mounted once in the root layout. Frozen Bun installation, production build, real HTTP E2E and all existing 27 Python/53 Node tests pass. Existing live site: https://orion-football-ranking.vercel.app.
- Verification: production build + existing HTTP E2E and relevant regressions; browser-check production scripts and navigation, then confirm the final Git-triggered deployment. Evidence in dashboard/outputs/vercel-insights/.
- Next: commit Analytics, push both integrations and verify production scripts and navigation; record final evidence.
- Commit names: feat: add Vercel Speed Insights; feat: add Vercel Web Analytics; docs: record Vercel insights verification.

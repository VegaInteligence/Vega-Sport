# Worklog

- Goal: remove the PitchAPI header status and filter-footer appearance/match tally; reduce side margins.
- Latest correction: cancel and remove the entire sidebar/new-topbar experiment. Keep the existing horizontal navigation, filter controls, focus button, theme toggle and footer.
- Direction: one shared 24px horizontal gutter on desktop, 12px on mobile; remove the workspace/footer maximum width. Keep existing vertical spacing and page layouts.
- Preserve: raw/computed JSON, API behavior, routes, season/league/query navigation, player/match details, supplied branding and both themes.
- UX/DX/AX: more room for actual data, one CSS gutter token across shared surfaces, existing named links/controls and URL contracts. No new navigation state or routes.
- Progress: restored the original navigation and removed all three added shell files/imports/state. Cancelled experiment evidence moved outside the repository. Requested removals remain in 7ab26f30; final CSS uses one shared gutter token.
- Verification: build and eight-route/data HTTP E2E passed; browser checks at 390/860/1502/1920px passed, including themes, focus/league filters, player/match details and competition navigation. Evidence: dashboard/outputs/interface-cleanup/README.md; design-qa.md. Next: push and read back the production Git deployment.
- Infrastructure: OrionQuantPlatform/STATARENA; Vercel statarena; https://statarena-analytics.vercel.app. Local preview uses 3015, leaving the existing 3000 service alone.
- Suggested commits: ui: remove provider status and filter collection tallies; ui: widen dashboard with consistent compact gutters.

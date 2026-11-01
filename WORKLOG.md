# Worklog

- Goal: show upcoming games on the overview and merge the weekly calendar with match results under one Matchs page.
- Preserve: real Next.js/Bun site, canonical JSON, daily worker and immutable Vercel data transport; Top 7 Europe/UEFA preferences and all existing match analysis.
- Direction: keep the topbar focused: remove Calendrier and Données & méthode. Matchs has À venir / Résultats views, with the weekly calendar in À venir. Move method access to the footer and redirect old calendar URLs while preserving their week/filters. Preserve Monday–Sunday Paris selection and unknown-time semantics.
- Progress: requested refinement implemented: one Matchs page with À venir (default)/Résultats above the relevant filters; seven-link topbar; Method in footer; legacy calendar redirect. Overview links, analysis and detail returns preserve mode/week/filters. Production build + 27 Python/53 Node tests pass; canonical/browser E2E covers all 127 next-week fixtures, results/statistics/back, legacy URL, default route, footer and 390px. Evidence: dashboard/outputs/matches-unified/.
- Timing: client selection refreshes every 30 seconds and on visibility return; provider status/fixture changes arrive through the existing daily worker. No new collection or raw-data changes.
- Verification: original feature c2ae7ea7 is live (dpl_Hf6fRb9gMQHJw5kwiawbxZwEeMeX). 28 canonical/browser checks and public HTTP E2E pass, including actual DST kickoff conversion. Evidence retained in dashboard/outputs/upcoming-week/.
- Next: publish the refinement through Git, verify its Vercel deployment and production mode switching/redirect, then record completion.
- Suggested commit: refactor: unify upcoming fixtures and match results.

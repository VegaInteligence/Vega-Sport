# Worklog

- Goal: show upcoming games on the overview and merge the weekly calendar with match results under one Matchs page.
- Preserve: real Next.js/Bun site, canonical JSON, daily worker and immutable Vercel data transport; Top 7 Europe/UEFA preferences and all existing match analysis.
- Direction: keep the topbar focused: remove Calendrier and Données & méthode. Matchs has À venir / Résultats views, with the weekly calendar in À venir. Move method access to the footer and redirect old calendar URLs while preserving their week/filters. Preserve Monday–Sunday Paris selection and unknown-time semantics.
- Progress: overview preview, /calendrier, day groups, pagination, Paris times, filters and detail/back navigation implemented. Production build + existing 27 Python/53 Node tests pass. Browser/oracle checks cover all 127 next-week Europe fixtures, Champions League, accents, all leagues/Ligue 2, mobile/keyboard, historical empty state, unknown times and year boundary. Current week has four Europe fixtures after the 19:00 kickoffs. Evidence: dashboard/outputs/upcoming-week/.
- Timing: client selection refreshes every 30 seconds and on visibility return; provider status/fixture changes arrive through the existing daily worker. No new collection or raw-data changes.
- Verification: original feature c2ae7ea7 is live (dpl_Hf6fRb9gMQHJw5kwiawbxZwEeMeX). 28 canonical/browser checks and public HTTP E2E pass, including actual DST kickoff conversion. Evidence retained in dashboard/outputs/upcoming-week/.
- Next: implement the requested navigation/Matchs refinement, verify mode switching, results/detail/back contracts and legacy redirects, then publish and verify live.
- Suggested commit: refactor: unify upcoming fixtures and match results.

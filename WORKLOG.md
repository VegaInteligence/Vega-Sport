# Worklog

- Goal: show upcoming games remaining this week on the overview and provide a dedicated weekly calendar.
- Preserve: real Next.js/Bun site, canonical JSON, daily worker and immutable Vercel data transport; Top 7 Europe/UEFA preferences and all existing match analysis.
- Direction: calendar weeks Monday–Sunday in Europe/Paris; use collected not_started fixtures and exclude elapsed kickoffs. Overview preview + /calendrier with week navigation, relevant filters, day groups and fixture-detail links/back navigation. Unknown times stay unknown.
- Progress: overview preview, /calendrier, day groups, pagination, Paris times, filters and detail/back navigation implemented. Production build + existing 27 Python/53 Node tests pass. Browser/oracle checks cover all 127 next-week Europe fixtures, Champions League, accents, all leagues/Ligue 2, mobile/keyboard, historical empty state, unknown times and year boundary. Current week has four Europe fixtures after the 19:00 kickoffs. Evidence: dashboard/outputs/upcoming-week/.
- Timing: client selection refreshes every 30 seconds and on visibility return; provider status/fixture changes arrive through the existing daily worker. No new collection or raw-data changes.
- Next: finish daylight-saving week verification, push the feature, verify the Git-triggered Vercel deployment and save final evidence.
- Suggested commit: feat: add weekly upcoming fixtures and calendar.

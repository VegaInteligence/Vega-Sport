# Worklog

- Goal: remove the four headline counters (appearances, matches, competitions and shot events) from the overview.
- Changes: remove the counters and their unused aggregation work; remove the corresponding loading placeholder. Keep filters, featured match, charts and detailed coverage unchanged.
- Verification: production build and browser inspection of the overview; evidence in dashboard/outputs/overview-cleanup/.
- State: production build and browser checks passed (no headline counter section, remaining panels intact, no console errors). Publishing the focused change.
- Suggested commit: ui: remove overview headline counters.

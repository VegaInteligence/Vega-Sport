# WORKLOG — 2026-11-16

- Goal: clarify Sport, Business and Status in their READMEs, including the relationship to the research repository, and update renamed Linear references across all four repositories; commit and push.
- This checkout: Vega-Sport; Linear label `repo:vega-sport`.
- User clarification: Sport is the application, including the dashboard frontend and its backend. Prediction is the research repository; Business presents Vega; Status displays the operational state of Sport’s backend.
- Constraints: documentation only; preserve runtime behavior, commands, contracts, data and unrelated local changes. Keep existing README languages.
- Linear: verified the renamed workspace/team as Vega Inteligence (VI), https://linear.app/vegainteligence. Repository label names are unchanged. No active (started) issues returned; no issue needed for this documentation update.
- Decisions: use the exact Linear display name and URL; retain repository/brand names and unrelated hosting identifiers. Research integration into Sport is explicit; Status consumes the API contract owned by Sport.
- Progress: the three README role/relationship sections and all four AGENTS.md workspace references are complete. Sport explicitly includes the application frontend and backend; its Linear label description matches. The existing research README is retained. Business’s obsolete pause-button description now matches the documented automatic pauses.
- Validation: documentation diffs and whitespace checks passed; all 29 local root README links resolve. Scanned 85 tracked README/AGENTS files across the four repositories with no old Linear names, URLs or issue-prefix references remaining. No application tests or E2E run for documentation-only changes.
- Suggested commit: `[UPD] clarify Vega repository roles and Linear workspace`.
- Preservation: fast-forwarded the new upstream match-page commit without overlap; existing LICENSE deletion and untracked local work remain outside this documentation commit.
- Delivery: commit and push each repository to main, then verify remote inclusion.
- Next action: keep repository ownership and coordination references current as the projects evolve.

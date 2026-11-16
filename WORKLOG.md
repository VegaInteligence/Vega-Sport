# WORKLOG — 2026-11-16

- Goal: perform the final README/AGENTS consistency review across the four Vega repositories, especially roles, Linear identity and frontend mockup approval; commit and push documentation fixes.
- This checkout: Vega-Sport; Linear label `repo:vega-sport`.
- Constraints: documentation only; preserve project roles, research scope, existing approval requirements, code/data and unrelated local work.
- Coordination: live Linear read-back confirms Vega Inteligence (VI), https://linear.app/vegainteligence, all four repository labels and the multi-select Repository group. No active started issues returned; no new issue needed for this small documentation update.
- Findings: roles and repository links agree; common Linear instructions match; frontend approval blocks match in Sport, Business and Status and are intentionally absent from research-only Prediction. READMEs need a direct contribution-rules link. Business needs to distinguish published-site restrictions from private design review and dated content decisions from current model availability.
- Direction: add concise README contribution guidance referring to AGENTS.md; surface the existing frontend approval gate in the three web repositories; clarify the Business-specific wording without changing site content or owner decisions.
- Progress: reviewed all eight root documents and Sport’s nested Next.js instructions. Every README now links to AGENTS.md; the three web READMEs surface explicit mockup approval. Business publishing restrictions and dated model-copy decisions are clarified without changing the website.
- Validation: all four repository-link maps and live Linear identities/labels agree; common Linear sections and the three frontend approval sections are identical. All 33 local README links resolve; 85 tracked README/AGENTS files contain no old Linear references. Documentation diffs and whitespace checks pass. No application tests or E2E run.
- Suggested commit: `[UPD] align contribution guidance with agent approval rules`.
- Delivery: commit and push the focused documentation changes to main and verify remote inclusion.
- Next action: follow the linked contribution rules; keep these sections aligned when roles or workflows change.

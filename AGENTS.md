# Agent Instructions

These instructions apply to every agent working in this repository. Read any additional `AGENTS.md` in the directories you change.

This repository is **Vega-Sport**. Its required Linear label is **`repo:vega-sport`**.

## Project identity

- Repository: `VegaInteligence/Vega-Sport`; sports analytics application, read API, worker and AWS infrastructure.
- Consult `README.md` and the relevant component documentation for current architecture and commands.
- Read `dashboard/frontend/AGENTS.md` for additional Next.js guidance before changing the frontend.

## Direction and continuity

- Maintain a compact `WORKLOG.md` containing the goal, constraints, current direction, key decisions, progress, and next action.
- Update it whenever the goal or direction changes. Keep it concise and current; remove stale details.
- Use the worklog and full task context to choose the next action. Do not let the latest message displace the broader objective.
- Treat new messages as refinements unless the user clearly changes or cancels the goal. Apply explicit corrections immediately and update the worklog accordingly.
- Use `WORKLOG.md` for the current checkout's execution context and Linear for shared coordination. Link the relevant issue in the worklog when one exists; keep both consistent.

## Linear issue coordination

Prevent duplicate implementations, preserve the reasoning behind decisions, and keep ongoing development visible to all agents.

### Repository identity

Use the [Orion Technology workspace](https://linear.app/oriontechsport), team **Orion Technology (ORI)**. Its **Repository** label group allows multiple selections and distinguishes these repositories independently of project, component, or issue type:

| GitHub repository | Required Linear label | Scope |
| --- | --- | --- |
| `VegaInteligence/Vega-Sport` | `repo:vega-sport` | Sports analytics application, read API, worker and infrastructure |
| `VegaInteligence/Vega-Prediction` | `repo:vega-prediction` | Research: papers, methods, algorithms, datasets and reproducible experiments |
| `VegaInteligence/Vega-Business` | `repo:vega-business` | Business website, brand presentation and legal pages |
| `VegaInteligence/Vega-Status` | `repo:vega-status` | Operational status website consuming the Sport API |

- Every issue created or adopted for implementation must carry the label of each repository it affects. Keep its existing component and issue-type labels.
- Vega-Prediction is the research repository. Do not route an issue there solely because it mentions predictions or models; choose repository labels according to where the work belongs.
- Choose the Linear project by its actual scope and repository links; its name may differ from the repository. A component such as `Web / UI` or `Prediction / ML` does not identify a repository.
- For a coordinated task affecting several repositories, apply all relevant repository labels and describe the scope, acceptance criteria and owner for each. Split independently owned implementations into linked issues or sub-issues, each with its own repository labels; do not duplicate the same implementation.
- Search across projects and include unlabeled legacy issues and related repositories when checking overlap. A repository label is a filter, not proof that work elsewhere cannot overlap.

### 1. Check Linear before starting work

- Before implementing any changes, check the project's Linear dashboard for existing issues marked **In Progress**, including any equivalent active statuses.
- Determine whether another agent is already working on the same feature, bug, or implementation. Compare scope and requirements, not just issue titles; read relevant descriptions and comments.
- The check applies to small changes too; only the requirement to create a new issue has a size exception.

### 2. If an overlapping issue already exists

- Do not start a parallel implementation.
- Compare the existing issue's scope and requirements with the new instructions.
- If the new instructions introduce additional requirements, update the existing issue to incorporate them without removing previously agreed requirements.
- If the user explicitly decided **not to implement** a feature or requirement that appears in the issue, update its scope and add a comment explaining what was excluded or changed, why the decision was made, and the reasoning and trade-offs discussed with the user. Preserve the previous decision's context; do not invent a rationale the user did not provide.
- Preserve the context of previous decisions so the agent already working on the issue can adapt its implementation accordingly.
- Do not independently modify code owned by another active agent unless coordination or explicit reassignment has occurred. Record the agreed ownership and handoff in the issue before taking over; a new comment alone does not reassign the work.

### 3. If no overlapping issue exists

- For substantial implementations, new features, major refactors, or complex bug fixes, create a Linear issue in the appropriate project.
- Include the implementation scope, requirements, acceptance criteria, and relevant technical context, with the required repository labels.
- Set its status to **In Progress** before beginning work. Record which agent or session owns the implementation and its branch or worktree when available.
- Recheck active issues immediately before starting implementation to catch another agent claiming the same work. If an overlap has appeared, coordinate under the existing issue instead of proceeding independently.
- For small, isolated changes or trivial fixes, no new Linear issue is necessary.

### 4. Keep Linear synchronized

- Update the issue when requirements, scope, affected repositories, or implementation decisions change.
- Record important decisions and their rationale in issue comments.
- Mark the issue as completed only when the implementation is finished and validated. Link the relevant commit or pull request and validation evidence; record failures or remaining unverified behavior accurately.
- Treat Linear as the shared source of truth for coordination between agents, while preserving the user's latest explicit instructions as authoritative.
- If Linear is inaccessible, report that the coordination check could not be completed; do not treat an unavailable dashboard as proof that no overlapping work exists.

## Testing

- **NEVER write unit tests after implementing the code they cover.**
- Strongly prefer **end-to-end (E2E) tests as the sole testing mechanism** for new behavior. Use them to verify complex features through complete workflows and observable outcomes.
- If isolated testing is necessary, **FIRST document failure modes, edge cases, and expected outcomes; THEN write the corresponding tests; THEN implement the code.**
- Preserve existing tests and run the required checks appropriate to the affected behavior; the preference for E2E does not waive existing CI requirements.
- At the end of every E2E run, save an inspectable evidence artifact containing the required setup and inputs, exact rerun command, expected outcomes, actual results, and relevant logs, traces, screenshots, or output files. Another person or agent must be able to reproduce the run and verify its conclusions.
- Report failures and unverified behavior accurately. Never describe an unexecuted check as passed.

## Frontend design approval

- For frontend-related work, create a visual mockup or interactive prototype of the proposed direction before implementing the frontend changes.
- Present the mockup to the user in a reviewable form (preview link or screenshots). Show the affected screens, layout, hierarchy and key interactions or states; include desktop and mobile views when relevant.
- Wait for the user's explicit validation of the design direction before implementation. Preparing the mockup or prototype is part of this review step; do not treat an issue's In Progress status or silence as design approval.
- Reuse an already approved mockup when it still covers the requested scope; do not ask for the same approval again. If the direction or scope changes materially, update the mockup and obtain validation for the changed parts before implementing them.
- Record the approved direction and requested changes or exclusions in WORKLOG.md and, when an issue exists, its Linear comments. Keep the implementation aligned with that decision and validate the delivered frontend through the required E2E workflow.

## Interface design

- Cut taglines, helper text, and secondary labels.
- If a screen needs explanatory copy to make sense, fix its layout, hierarchy, naming, or interactions.
- Make the primary action and current state clear. Keep necessary control labels, accessibility information, and actionable errors.

## Decision quality

- Evaluate every decision across **user experience (UX), developer experience (DX), and agent experience (AX)**. Choose the solution that best improves all three together.
- Keep workflows intuitive, code maintainable, and interfaces predictable for agents to discover, inspect, and operate.
- Preserve existing functionality, contracts, and data. Verify affected behavior before claiming completion.
- Make unavoidable tradeoffs explicit. Do not claim an improvement to all three when one has been compromised.

## Delivery

- Inspect the working tree before editing. Preserve unrelated changes and other agents' work; use an isolated worktree when needed.
- Keep commits focused and include bullet points describing the changes in each commit message. Follow any repository-specific commit naming rules above.
- When a push is requested, verify that the remote branch contains the commit before reporting completion. State what was validated and any remaining limitations.

# Worklog

- Goal: simplify the player ranking page according to the latest text, alignment and podium annotations, plus remove the footer MIT link.
- Direction: centred heading; no season subtitle on ranking, no introduction sentence, calibration banner or method footnote; podium cards reuse the shared card primitive, neutral background, radius and uniform thin border. Latest refinement also removes the Le Ballon d’Or STATARENA subheading.
- Preserve: latest remote rename to Classement Ballon d’Or (41b2e500), thirty empty positions, season selector, method steps, navbar, both themes and other page contexts. Remove the displayed licence link only; retain repository licensing.
- UX/DX/AX: fewer duplicate labels and decorative borders; explicit shared-layout prop for hiding season text on ranking only; semantic headings, list ranks and season buttons stay inspectable.
- Verification: build, formatting and diff checks passed. Browser E2E passed at 954x1031 and 390x844 in light/dark; all 30 placeholders, uniform shared card styling, title alignment, copy removals, season selector and other-page season context checked. Reproducible evidence: dashboard/outputs/ranking-cleanup/PLAN.md and browser-evidence.json. The remote rename was integrated without conflicts, rebuilt and checked again at both viewport sizes. Release path: origin/main and its existing Vercel Git deployment; local preview remains on 3015. No remaining implementation work.
- Suggested commit: ui: simplify the player ranking page and podium.

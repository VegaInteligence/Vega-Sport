<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Images: crests and portraits

One component draws every club crest, competition logo and player portrait: `Media` (`src/components/UI.jsx`), with `ClubCrest`, `PlayerAvatar` and `AvatarGroup` beside it. It loads lazily, queues `/api/assets` requests, decodes before it shows, and falls back from `url` to `fallbackUrl` to initials. Do not draw these images with a bare `<img>` or a second component.

- Order: the image, then `fallbackUrl`, then initials. While an image loads, the shell only: never initials.
- Initials: `mediaInitials` (`src/services/format.js`), one or two capitals from the first and last words; for a person, a capitalised surname particle counts (« Kevin De Bruyne » → KD). No letter or digit in the name: the neutral shell, never « — » or « ? ».
- Sizes: 16 · 20 · 24 · 28 · 32 · 40 · 48 · 64 · 96 px.
- Pick the size from the text beside it: 16–20 in dense tables (11–12 px text), 24–32 in list rows (13–15 px), 40–48 in cards, 64–96 in page headers. Pass `size`, or use the `--media-*` tokens in CSS; never another side.
- `kind`: `"player"` (round, cover) or `"club"` (square, contain; competitions and nations too).
- Accessible name: decorative (`aria-hidden`) when the name is written beside the image; `label` when it is not (chart marks, a stack without text).
- Stacks: `AvatarGroup` (`slots` for fixed places, `limit` then « +N »; the overlap follows the size).
- Checks: `node --test tests/media-initials.test.mjs` and `node tests/e2e/media.e2e.mjs <base url> <evidence dir>`.

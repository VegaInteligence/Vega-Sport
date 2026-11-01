# STATARENA - Brand Kit

Identity based on the approved **STATARENA** stadium-and-bars emblem.
The design is intentionally multisport: the stadium shape communicates sport,
while ascending blue bars communicate measurement and analysis.

## Contents

- `logos/svg/` - editable vector paths for symbol-only, wordmark-only, stacked and horizontal lockups. Every lockup comes in `color`, `inverse`, `navy`, and `white` variations.
- `logos/png/` - high-resolution transparent PNG exports of those variations.
- `icons/` - application icons (light/dark/blue), GitHub avatar, Apple touch icon, Android icons and favicons.
- `social/` - Open Graph card, GitHub social preview, and README banner.
- `guidelines/STATARENA_Brand_Guidelines.pdf` - visual brand guide with logo usage, palette, and typography.
- `tokens/statarena.css` / `tokens/statarena.json` - colors and interface tokens.
- `source/` - reference image supplied for the brand.

## Recommended defaults

- **Light UI:** `logos/svg/statarena-horizontal-color.svg`
- **Dark UI:** `logos/svg/statarena-horizontal-inverse.svg`
- **Icon only:** `logos/svg/statarena-symbol-color.svg` or `...-inverse.svg`
- **Browser favicon:** `icons/favicon.ico` + `icons/favicon.svg`
- **GitHub profile/repository:** `icons/github-avatar-512.png` and `social/github-social-preview-1280x640.png`
- **Open Graph image:** `social/open-graph-1200x630.png`

## Usage notes

Prefer `svg` for UI; use PNG only where SVG is not accepted. For narrow formats,
use the symbol or micro icon. Keep some space around the symbol (at least 1/4 of
its height), never stretch the mark, and avoid overlaying on busy photographs.

The logo variants keep the approved stadium + four ascending blue bars concept.
The tiny `micro-icon` is intentionally optically simplified for 16-48 px use.
The vector files were redrawn from the approved raster source through color
segmentation and outline tracing. They reproduce the emblem's geometry at
normal display sizes but are not the original source vector master.

The font suggestions are Inter Display (headings), Inter (UI), and a system mono
for numeric data. Font files are not included.

**Important:** Name/domain/trademark availability has not been verified. Perform
clearance checks before public commercial launch.

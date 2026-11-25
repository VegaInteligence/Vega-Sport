/* A team's colour on the match page, from its crest (FAILURE_MODES § 64). The crest's pixels give
 * its coloured hues (white, black and greys are not a colour); the match page sets `--home` and
 * `--away` from them, the lightness chosen per theme so the colour reads on the page. A side with
 * no colour keeps the theme's blue (home) or violet (away). */

const BINS = 24; // 15° each
const MIN_SHARE = 0.08;
const MIN_SPREAD = 40; // degrees between two colours that do not clash
// The theme's own colours (theme.css: --home blue, --away violet), as hues.
const HOME_FALLBACK_HUE = 215;
const AWAY_FALLBACK_HUE = 255;
const LIGHT = [34, 44]; // the light theme's lightness range, %
const DARK = [62, 72]; // the dark theme's

function hsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

export const hueDistance = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * The crest's colours, the largest first (at most two, 40° apart), from its RGBA pixels: each a
 * hue (degrees), saturation and lightness (0–1) averaged over the pixels of its 15° band. Only
 * opaque pixels count; a colour must cover 8 % of them.
 */
export function crestColours(data) {
  if (!data?.length) return [];
  const bins = Array.from({ length: BINS }, () => ({ n: 0, x: 0, y: 0, s: 0, l: 0 }));
  let opaque = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    opaque++;
    const c = hsl(data[i], data[i + 1], data[i + 2]);
    // White, black and greys carry no colour.
    if (c.s < 0.3 || c.l < 0.12 || c.l > 0.9) continue;
    const bin = bins[Math.floor(c.h / (360 / BINS)) % BINS];
    const rad = (c.h * Math.PI) / 180;
    bin.n++;
    bin.x += Math.cos(rad);
    bin.y += Math.sin(rad);
    bin.s += c.s;
    bin.l += c.l;
  }
  if (!opaque) return [];
  // A colour often straddles two bands: each band counts with its neighbours'.
  const merged = bins.map((bin, i) => {
    const parts = [bins[(i + BINS - 1) % BINS], bin, bins[(i + 1) % BINS]];
    const n = parts.reduce((sum, p) => sum + p.n, 0);
    if (!n) return null;
    const x = parts.reduce((sum, p) => sum + p.x, 0), y = parts.reduce((sum, p) => sum + p.y, 0);
    return {
      n,
      h: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
      s: parts.reduce((sum, p) => sum + p.s, 0) / n,
      l: parts.reduce((sum, p) => sum + p.l, 0) / n,
    };
  });
  const ranked = merged
    .filter((c) => c && c.n / opaque >= MIN_SHARE)
    .sort((a, b) => b.n - a.n);
  const out = [];
  for (const c of ranked) {
    if (out.every((o) => hueDistance(o.h, c.h) >= MIN_SPREAD)) out.push({ h: c.h, s: c.s, l: c.l });
    if (out.length === 2) break;
  }
  return out;
}

const round = (value) => Math.round(value * 10) / 10;
const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));

/** A crest colour as the page's colour, its lightness set for each theme. */
function themed({ h, s, l }) {
  const sat = round(clamp(s * 100, [45, 85]));
  const shade = (range) => `hsl(${round(h)} ${sat}% ${round(clamp(l * 100, range))}%)`;
  return `light-dark(${shade(LIGHT)}, ${shade(DARK)})`;
}

/**
 * The match page's `--home` and `--away` from the two crests' colours. A side left out keeps the
 * theme's colour. The away side never clashes with the home one: its first colour, its second,
 * then the theme's violet, then the theme's blue.
 */
export function matchColours(home, away) {
  const vars = {};
  const homeColour = home?.[0];
  if (homeColour) vars["--home"] = themed(homeColour);
  const homeHue = homeColour ? homeColour.h : HOME_FALLBACK_HUE;
  const options = [
    ...(away || []).slice(0, 2),
    { fallback: undefined, h: AWAY_FALLBACK_HUE },
    { fallback: "var(--home-fallback)", h: HOME_FALLBACK_HUE },
  ];
  const pick = options.find((o) => hueDistance(o.h, homeHue) >= MIN_SPREAD);
  if (pick && !("fallback" in pick)) vars["--away"] = themed(pick);
  else if (pick?.fallback) vars["--away"] = pick.fallback;
  return vars;
}

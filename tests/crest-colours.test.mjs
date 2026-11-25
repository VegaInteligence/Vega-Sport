// A team's colour on the match page from its crest (FAILURE_MODES § 64, R23 and R24).
import test from "node:test";
import assert from "node:assert/strict";
import {
  crestColours,
  matchColours,
} from "../dashboard/frontend/src/services/crest-colours.js";

/** RGBA pixels: [count, [r, g, b, a]] pairs. */
const pixels = (...parts) => {
  const out = [];
  for (const [count, rgba] of parts) for (let i = 0; i < count; i++) out.push(...rgba);
  return new Uint8ClampedArray(out);
};
const RED = [200, 16, 46, 255], WHITE = [255, 255, 255, 255], BLACK = [0, 0, 0, 255];
const BLUE = [0, 65, 150, 255], ORANGE = [240, 120, 20, 255], CLEAR = [200, 16, 46, 0];
const hueOf = (colour) => colour && Math.round(colour.h);

test("R23 the crest's dominant colour: red over white, none for black and white, transparency ignored, two colours in order", () => {
  const red = crestColours(pixels([60, RED], [40, WHITE]));
  assert.equal(red.length, 1);
  assert.ok(hueOf(red[0]) >= 345 || hueOf(red[0]) <= 5, `hue ${red[0].h}`);
  assert.deepEqual(crestColours(pixels([50, BLACK], [50, WHITE])), []);
  assert.deepEqual(crestColours(pixels([500, CLEAR], [50, WHITE])), []);
  const two = crestColours(pixels([30, BLUE], [55, RED], [15, WHITE]));
  assert.equal(two.length, 2);
  assert.ok(hueOf(two[0]) >= 345 || hueOf(two[0]) <= 5);
  assert.ok(hueOf(two[1]) > 200 && hueOf(two[1]) < 230, `hue ${two[1].h}`);
  // A colour on less than 8 % of the opaque pixels is not one of the crest's.
  assert.equal(crestColours(pixels([5, BLUE], [95, WHITE])).length, 0);
});

const lightness = (css) => [...css.matchAll(/hsl\([\d.]+ [\d.]+% ([\d.]+)%\)/g)].map((m) => Number(m[1]));

test("R24 two sides: clash, fallbacks and the lightness of each theme", () => {
  const red = { h: 352, s: 0.85, l: 0.43 }, blue = { h: 215, s: 1, l: 0.3 }, orange = { h: 28, s: 0.88, l: 0.51 };
  // Distinct colours: each side its own.
  let vars = matchColours([orange], [blue]);
  assert.match(vars["--home"], /^light-dark\(hsl\(28 /);
  assert.match(vars["--away"], /^light-dark\(hsl\(215 /);
  for (const side of ["--home", "--away"]) {
    const [light, dark] = lightness(vars[side]);
    assert.ok(light >= 34 && light <= 44, `${side} light ${light}`);
    assert.ok(dark >= 62 && dark <= 72, `${side} dark ${dark}`);
  }
  // Two reds: the away side takes its second colour…
  vars = matchColours([red], [red, blue]);
  assert.match(vars["--away"], /^light-dark\(hsl\(215 /);
  // …or its fallback (no variable: the theme's violet) when it has none.
  vars = matchColours([red], [{ ...red, h: 0 }]);
  assert.match(vars["--home"], /^light-dark\(hsl\(352 /);
  assert.equal(vars["--away"], undefined);
  // A side with no colour keeps the theme's (no variable).
  vars = matchColours([], [orange]);
  assert.equal(vars["--home"], undefined);
  assert.match(vars["--away"], /^light-dark\(hsl\(28 /);
  // The home side near violet: an away side with no usable colour falls back to blue.
  vars = matchColours([{ h: 258, s: 0.6, l: 0.45 }], [{ h: 250, s: 0.6, l: 0.45 }]);
  assert.match(vars["--away"], /^var\(--home-fallback\)$/);
  // An away crest as blue as the theme's home blue, home with no colour: away takes violet.
  vars = matchColours([], [blue]);
  assert.equal(vars["--away"], undefined);
  assert.deepEqual(matchColours(null, undefined), {});
});

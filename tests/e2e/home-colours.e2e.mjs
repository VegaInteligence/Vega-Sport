// E2E — the teams' colours on the home page's « Le choc de la semaine » (FAILURE_MODES.md § 66; hugo, 25 Nov 2026:
// « pour les couleurs je veux aussi sur le choc de la semaine sur la page d'accueil »).
//
// The two teams' crests are test images served for the files the home read names (home red, away green); the rest of
// the page comes from whatever API the frontend is configured with (the public API, or a replay of it).
//
//   node tests/e2e/home-colours.e2e.mjs <base url> <evidence dir> <api origin>
//
// K1 the card's home side in its crest's red, its away side in its crest's green (legend dots, xG lines, stat bars).
// K2 the page outside the card keeps the theme's --home and --away.
// K3 crests that cannot be read: blue and violet, no variable on the card.
// K4 no page error.
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { europeFocusIds } from "../../dashboard/shared/competition-scope.js";

const [base = "http://127.0.0.1:3000", out = "/tmp/home-colours-e2e", api = "https://dngp6kh9jx2bl.cloudfront.net"] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");

const getJson = async (p) => {
  const r = await fetch(api + p, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${p}`);
  return r.json();
};
const query = (values) => new URLSearchParams(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))).toString();
const manifest = await getJson("/api/dashboard/manifest");
const home = (await getJson(`/api/read/home?${query({ generation: manifest.publicationVersion, leagues: [...europeFocusIds(manifest)].sort().join(","), season: manifest.defaultSeason })}`)).data;
const match = home.featured;
if (!match) throw new Error("the home read has no « choc de la semaine »");
const fileOf = (url) => String(url || "").split("?")[0].split("/").pop();

/** A 40×40 RGBA PNG: `paint(x, y)` gives each pixel. */
function png(paint) {
  const size = 40, raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) raw.set(paint(x, y), y * (size * 4 + 1) + 1 + x * 4);
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(type, 4); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data]))); return Buffer.concat([head, data, tail]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const inside = (x, y) => (x - 19.5) ** 2 + (y - 19.5) ** 2 < 18 ** 2;
// Home: red with a white band; away: green.
const CREST_PNG = {
  [fileOf(match.home.imageUrl)]: png((x, y) => (!inside(x, y) ? [0, 0, 0, 0] : y < 10 ? [255, 255, 255, 255] : [218, 41, 28, 255])),
  [fileOf(match.away.imageUrl)]: png((x, y) => (!inside(x, y) ? [0, 0, 0, 0] : [0, 140, 70, 255])),
};

const results = [];
const check = async (id, expected, run) => {
  try {
    const actual = await run();
    results.push({ id, expected, actual, ok: true });
    console.log("PASS", id, JSON.stringify(actual));
  } catch (error) {
    results.push({ id, expected, error: String(error?.message || error), ok: false });
    console.log("FAIL", id, String(error?.message || error).slice(0, 400));
  }
};
const hueOf = (rgb) => {
  const [r, g, b] = (rgb.match(/[\d.]+/g) || []).slice(0, 3).map((v) => Number(v) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return null;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
};
const near = (h, target, span = 20) => h != null && Math.min(Math.abs(h - target), 360 - Math.abs(h - target)) <= span;

const browser = await chromium.launch();
async function open(crests) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  const errors = [];
  const serve = (route) => {
    const body = crests && CREST_PNG[fileOf(route.request().url())];
    return body ? route.fulfill({ status: 200, contentType: "image/png", body }) : route.fulfill({ status: 404, body: "" });
  };
  await context.route(/\/api\/crest\//, serve);
  await context.route(/dngp6kh9jx2bl\.cloudfront\.net\/data\//, (route) =>
    CREST_PNG[fileOf(route.request().url())] ? serve(route) : route.fallback());
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator(".home-motw").waitFor({ timeout: 90000 });
  await page.locator(".home-motw .home-line-home").first().waitFor({ timeout: 60000 }).catch(() => {});
  return { context, page, errors };
}
/** The colours the card draws in, and the page's own. */
const colours = (page) =>
  page.evaluate(() => {
    const card = document.querySelector(".home-motw");
    const css = (selector, prop) => {
      const el = card.querySelector(selector);
      return el ? getComputedStyle(el)[prop] : null;
    };
    const page = getComputedStyle(document.querySelector("main") || document.body);
    return {
      inline: card.getAttribute("style"),
      legendHome: css(".home-legend .is-home", "backgroundColor"),
      legendAway: css(".home-legend .is-away", "backgroundColor"),
      lineHome: css(".home-line-home", "stroke"),
      lineAway: css(".home-line-away", "stroke"),
      barHome: css(".home-stat-track.is-home > *", "backgroundColor"),
      barAway: css(".home-stat-track.is-away > *", "backgroundColor"),
      pageHome: page.getPropertyValue("--home").trim(),
      pageAway: page.getPropertyValue("--away").trim(),
    };
  });

let errors = [];
{
  const f = await open(true);
  await f.page.waitForFunction(() => /--home/.test(document.querySelector(".home-motw")?.getAttribute("style") || ""), null, { timeout: 30000 }).catch(() => {});
  await f.page.waitForTimeout(500);
  const got = await colours(f.page);
  await f.page.locator(".home-motw").screenshot({ path: join(out, "choc-couleurs-logos.png") });
  await check("K1 the card in its crests' colours: home red, away green", { home: "≈ 3°", away: "≈ 150°" }, async () => {
    const hues = Object.fromEntries(["legendHome", "lineHome", "barHome", "legendAway", "lineAway", "barAway"].map((k) => [k, got[k] && hueOf(got[k])]));
    for (const k of ["legendHome", "lineHome"]) if (!near(hues[k], 3)) throw new Error(`${k} hue ${hues[k]} (${got[k]})`);
    for (const k of ["legendAway", "lineAway"]) if (!near(hues[k], 150)) throw new Error(`${k} hue ${hues[k]} (${got[k]})`);
    if (got.barHome && !near(hues.barHome, 3)) throw new Error(`barHome hue ${hues.barHome}`);
    if (got.barAway && !near(hues.barAway, 150)) throw new Error(`barAway hue ${hues.barAway}`);
    return { hues, inline: got.inline };
  });
  await check("K2 the page outside the card keeps the theme's colours", { home: "#7fb0ff", away: "#b9a8f0" }, async () => {
    if (got.pageHome.toLowerCase() !== "#7fb0ff" || got.pageAway.toLowerCase() !== "#b9a8f0")
      throw new Error(`page --home ${got.pageHome}, --away ${got.pageAway}`);
    return { home: got.pageHome, away: got.pageAway };
  });
  errors.push(...f.errors);
  await f.context.close();
}
{
  const f = await open(false);
  await f.page.waitForTimeout(3000);
  const got = await colours(f.page);
  await f.page.locator(".home-motw").screenshot({ path: join(out, "choc-sans-logos.png") });
  await check("K3 crests that cannot be read: blue and violet", { home: "≈ 217°", away: "≈ 254°", inline: null }, async () => {
    if (/--home|--away/.test(got.inline || "")) throw new Error(`variables set: ${got.inline}`);
    const home = hueOf(got.legendHome), away = hueOf(got.legendAway);
    if (!near(home, 217, 10) || !near(away, 254, 10)) throw new Error(`hues ${home} / ${away}`);
    return { home, away };
  });
  errors.push(...f.errors);
  await f.context.close();
}
await check("K4 no page error", [], async () => {
  if (errors.length) throw new Error(errors.join(" | "));
  return [];
});
await browser.close();
await writeFile(join(out, "evidence.json"), JSON.stringify({ base, api, match: { id: match.id, home: match.home.name, away: match.away.name }, results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

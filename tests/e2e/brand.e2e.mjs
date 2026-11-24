// E2E — the site carries Vega's logo, the asterisk (the user, 24 Nov 2026: « pour moi le logo ça
// doit juste être un astérisque »; charter: docs/brand/README.md). In the header and the footer
// the wordmark « Vega* » with « Sport » small underneath; where room is short and on every icon
// the asterisk alone (it replaced the mark « V* » the same day); two colours only (ivory
// #F4F1EA, night #07080B).
// Written before the implementation, against the real pages, on a desktop (1365×900, dark and
// light) and an iPhone 16 (393×852).
//
// Failure modes and expected outcomes:
//  B1 (header) Desktop, dark: the home link of the header shows one image, the wordmark with
//     « Sport » underneath (/branding/vega/logo-dark.svg, 1.6 to 2.2 times wider than tall),
//     drawn at its own proportions, 36 to 44 px tall. The header keeps its 56 px and nothing
//     in it overlaps or leaves the window. Before: « Vega Sport. » on one line, 28 px.
//  B2 (theme) Light theme: the same place shows logo-light.svg and only it.
//  B3 (drawings) The served files are the new drawings: no gradient, no star outline
//     (« M 559 1 »), the ivory or night fill, and no circle left (the full stop is gone).
//     Checked on the logo, the mark, the two icons and the favicon. The asterisk is there:
//     the top right corner of the logo is mostly ink, where the full stop's logo had none.
//     The mark, the two icons and the favicon are one outline each: the asterisk, no letter.
//  B4 (phone) The header shows the asterisk alone (/branding/vega/symbol-dark.svg, a little
//     taller than wide: 0.85 to 1 times), 26 to 30 px tall, in a tap target of 44 px, and the
//     page does not scroll sideways. Before: « V* », 1.5 times wider than tall.
//  B5 (favicon) The page names one icon, the one of the site's theme: /branding/vega/icon-dark.svg
//     in the dark theme, icon-light.svg in the light one, with the new version number, in a
//     single icon link (« icon » or « shortcut icon »). favicon.svg follows the system's
//     colours, not the site's theme: a page with scripts must not name it. Each list of icons
//     is read five times over 1.2 s, after a navigation once React has rebuilt the head's icon
//     links, and every reading must be that one icon. How it failed before:
//      - at load (B5a dark, B5f light): React did not recognise the link whose address the theme
//        script had changed, and put the page's favicon.svg link back beside it;
//      - after a navigation inside the site (B5k dark, B5l light): React rebuilt the head's
//        links, and favicon.svg came back, beside the themed icon or in its place;
//      - after the theme button (B5m), then a navigation (B5n): two links, then favicon.svg again;
//      - storage refused by the browser (B5p): no themed icon at all, at load or after the button.
//     Without scripts (B5o) the page still names an icon: favicon.svg at the new version.
//     /favicon.ico and /apple-touch-icon.png answer with the new icon (night tile, ivory
//     mark, no blue). On each the asterisk stands alone, in the middle of its tile: as much
//     ink in the left half as in the right, in the top half as in the bottom (« V* » had
//     its letter on the left).
//  B6 (app icons) /api/vega-image?kind=icon at 180, 192 and 512 px: a PNG of that size, night
//     tile, ivory mark, no blue, no pure black; theme=light gives the ivory tile. The same
//     balance of ink, left and right, top and bottom.
//  B7 (share image) og:image and twitter:image name the same picture, 1200 × 630, with the
//     ivory wordmark in its lower left quarter and no blue; the old address
//     /api/vega-image?kind=og leads to that same picture.
//  B8 (footer) The footer's home link shows the wordmark, at its proportions, 48 to 64 px tall.
//  B9 (loading) While a page waits for its data, the loading mark is the asterisk alone: no
//     star outline, no gradient, no circle, one outline. It is seen turning: read eight times,
//     150 ms apart, its angle is at least once away from a multiple of 60° (a six-petalled
//     shape turned by 60° looks the same: before, it stepped by 60° and never seemed to move).
//  B10 (report card) A report image carries the wordmark in ivory at its top left, no blue star.
//  B11 (in between) The wordmark must not take the menus' room, the account button being in
//     the header (a local server shows it only with NEON_AUTH_BASE_URL and
//     NEON_AUTH_COOKIE_SECRET set, see the evidence's setup). At 1120 px the wordmark shows and
//     every menu still ends before the search field. At 1024, 768 and 700 px the asterisk
//     shows instead, in a link no wider than 44 px, and the header's parts neither overlap nor
//     leave the window. Before: at 1024 px « Vega Sport. » pushed two menus under the search.
//  B12 (theme colour) The page names one theme colour, the one of the site's theme: a single
//     meta[name="theme-color"], #0E0F12 in the dark theme, #F6F8FB in the light one, which is
//     also the page's own background. Read like the icons: five times over 1.2 s, after a
//     navigation once React has rebuilt the head. How it failed before, the tag being React's
//     (viewport.themeColor) and rewritten by the theme script and the theme button:
//      - light theme at load (B12e): React did not recognise the tag whose colour the script had
//        changed and added its own, #F6F8FB then #0E0F12; both stayed after a navigation (B12f),
//        and the button rewrote the first only (B12g, B12h);
//      - dark at load, the theme button, then a navigation (B12d): React rebuilt the head's tags
//        and the colour went back to #0E0F12 on a light page.
//     Dark at load (B12a), after a navigation (B12b) and after the button (B12c) held before and
//     must still hold; so must a page without scripts (B12i: dark, #0E0F12) and a browser that
//     refuses the storage (B12j: #0E0F12 at load, #F6F8FB after the button).
//  X1 No page error and no console error on the home page (desktop dark and light, phone,
//     without scripts, storage refused) nor on the Matchs page reached from it.
//     The loading page's console is recorded in the evidence, not judged here.
//
// Run against a local front (NEXT_PUBLIC_API_ORIGIN = the public API) or the public site:
//   node tests/e2e/brand.e2e.mjs <base url> <evidence dir>
// It writes evidence.json (setup, inputs, expected, actual, console) and screenshots; exit code 1
// when any check fails.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [base = "http://127.0.0.1:3000", out = path.join(os.tmpdir(), "brand-e2e")] =
  process.argv.slice(2);
await mkdir(out, { recursive: true });

function playwright() {
  const roots = [
    process.env.PLAYWRIGHT_CORE,
    ...(() => {
      const npx = path.join(os.homedir(), ".npm/_npx");
      return existsSync(npx)
        ? readdirSync(npx).map((d) => path.join(npx, d, "node_modules/playwright-core"))
        : [];
    })(),
  ].filter((p) => p && existsSync(path.join(p, "package.json")));
  if (!roots.length) throw new Error("playwright-core not found: set PLAYWRIGHT_CORE");
  return createRequire(import.meta.url)(roots[0]);
}

const IVORY = [244, 241, 234], NIGHT = [7, 8, 11];
const VERSION = 5; // faviconVersion of app/layout.jsx after the change
const REPORT = "t_1gkhxH"; // Arsenal: a club whose report exists
const results = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(`${ok ? "ok  " : "FAIL"} ${id} — ${expected} — ${typeof actual === "string" ? actual : JSON.stringify(actual)}`);
};
const pct = (v) => Math.round(v * 1000) / 10;

/** The images actually shown inside a link: address, own size, drawn size. */
const shown = (page, scope) =>
  page.evaluate((scope) => {
    const node = document.querySelector(scope);
    if (!node) return null;
    const link = node.getBoundingClientRect();
    const images = [...node.querySelectorAll("img")]
      .filter((img) => {
        const r = img.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(img).visibility !== "hidden";
      })
      .map((img) => {
        const r = img.getBoundingClientRect();
        return {
          src: new URL(img.currentSrc || img.src).pathname,
          natural: [img.naturalWidth, img.naturalHeight],
          box: [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10],
          alt: img.alt,
        };
      });
    return { images, link: [Math.round(link.width), Math.round(link.height)], label: node.getAttribute("aria-label") };
  }, scope);
const ratio = ([w, h]) => (h ? w / h : 0);
/** One image, at the proportions of its own drawing (2 %). */
const undistorted = (image) =>
  image && image.natural[1] > 0 && Math.abs(ratio(image.box) / ratio(image.natural) - 1) < 0.02;

/** What a picture is made of: its size and the share of ivory, night, pure black and blue. */
const pixels = (page, url, region) =>
  page.evaluate(
    async ([url, region, IVORY, NIGHT]) => {
      const response = await fetch(url);
      if (!response.ok) return { status: response.status };
      const blob = await response.blob();
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      try {
        await img.decode();
      } catch {
        return { status: response.status, type: blob.type, undecoded: true };
      }
      const w = img.naturalWidth, h = img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const g = canvas.getContext("2d");
      g.drawImage(img, 0, 0);
      const [x0, y0, x1, y1] = region ? region.map((v, i) => Math.round(v * (i % 2 ? h : w))) : [0, 0, w, h];
      const data = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const near = (i, c, t) => Math.abs(data[i] - c[0]) <= t && Math.abs(data[i + 1] - c[1]) <= t && Math.abs(data[i + 2] - c[2]) <= t;
      let ivory = 0, night = 0, black = 0, blue = 0;
      const n = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        if (near(i, IVORY, 16)) ivory++;
        if (near(i, NIGHT, 5)) night++;
        if (data[i] + data[i + 1] + data[i + 2] <= 3 && data[i + 3] > 250) black++;
        if (data[i + 2] - data[i] > 60 && data[i + 2] > 110) blue++;
      }
      const all = g.getImageData(0, 0, 1, 1).data;
      return { status: response.status, type: blob.type, size: [w, h], ivory: ivory / n, night: night / n, black: black / n, blue: blue / n, corner: [all[0], all[1], all[2]] };
    },
    [url, region || null, IVORY, NIGHT],
  );
const brief = (p) =>
  p.size ? `${p.size.join("×")} ${p.type} ivory ${pct(p.ivory)} % night ${pct(p.night)} % black ${pct(p.black)} % blue ${pct(p.blue)} % corner ${p.corner.join(",")}` : JSON.stringify(p);
/** Night tile, ivory mark: the dark icon. */
const darkIcon = (p, side) =>
  p.size && (!side || (p.size[0] === side && p.size[1] === side)) && p.night > 0.5 && p.ivory > 0.03 && p.blue === 0 && p.black < 0.01;
const lightIcon = (p, side) =>
  p.size && (!side || (p.size[0] === side && p.size[1] === side)) && p.ivory > 0.5 && p.night > 0.03 && p.blue === 0;

/** The icons the page names, read several times 300 ms apart: every different list seen. */
const icons = async (page, times = 5) => {
  const seen = [];
  for (let i = 0; i < times; i++) {
    if (i) await page.waitForTimeout(300);
    const list = await page.evaluate(() => [...document.querySelectorAll('link[rel~="icon"]')].map((l) => new URL(l.href).pathname + new URL(l.href).search));
    const names = list.join(", ") || "none";
    if (!seen.includes(names)) seen.push(names);
  }
  return seen;
};
const themeIcon = (theme) => `/branding/vega/icon-${theme}.svg?v=${VERSION}`;
/** That icon alone, at every reading. */
const only = (seen, address) => seen.length === 1 && seen[0] === address;
const readings = (seen) => seen.join(" ; then ");
/** The theme colours the page names, with the site's theme and the page's own background at
 *  that moment, read several times 300 ms apart: every different reading seen. */
const THEME_COLOUR = { dark: "#0E0F12", light: "#F6F8FB" };
const colours = async (page, times = 5) => {
  const seen = [];
  for (let i = 0; i < times; i++) {
    if (i) await page.waitForTimeout(300);
    const reading = await page.evaluate(() => {
      const named = [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content.trim().toUpperCase() + (m.media ? ` [${m.media}]` : ""));
      const rgb = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) || [];
      const background = "#" + rgb.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("").toUpperCase();
      return `${named.join(", ") || "none"} on the ${document.documentElement.dataset.theme} page (background ${background})`;
    });
    if (!seen.includes(reading)) seen.push(reading);
  }
  return seen;
};
/** One reading of a page that names its theme's colour alone. */
const themed = (theme) => `${THEME_COLOUR[theme]} on the ${theme} page (background ${THEME_COLOUR[theme]})`;
/** Follow a link inside the site and wait for the new page's head. Nothing on the network tells
 *  when it is there (the document stays the same), but React rebuilds the head's icon links
 *  on the way: the apple-touch-icon link becomes a new node. Answers whether that was seen. */
const follow = async (page, link, there) => {
  await page.evaluate(() => { const apple = document.querySelector('link[rel="apple-touch-icon"]'); if (apple) apple.dataset.before = "1"; });
  await page.locator(link).first().click();
  await page.waitForURL(there);
  return page
    .waitForFunction(() => { const apple = document.querySelector('link[rel="apple-touch-icon"]'); return Boolean(apple) && !apple.dataset.before; }, null, { timeout: 5000 })
    .then(() => true, () => false);
};
/** The asterisk alone in the middle of its tile: as much ink left as right, top as bottom. */
const balance = async (page, url, ink) => {
  const halves = [[0, 0, 0.5, 1], [0.5, 0, 1, 1], [0, 0, 1, 0.5], [0, 0.5, 1, 1]];
  const [left, right, top, bottom] = (await Promise.all(halves.map((region) => pixels(page, url, region)))).map((p) => p[ink] ?? -1);
  return { left: pct(left), right: pct(right), top: pct(top), bottom: pct(bottom), ok: [left, right, top, bottom].every((v) => v > 0.02) && Math.abs(left - right) < 0.006 && Math.abs(top - bottom) < 0.006 };
};

const text = async (address) => {
  const response = await fetch(new URL(address, base));
  return { status: response.status, body: response.ok ? await response.text() : "" };
};

const { chromium } = playwright();
const browser = await chromium.launch();
const consoleLog = [], elsewhere = [];
const watch = (page, name) => {
  const log = name === "loading" ? elsewhere : consoleLog;
  page.on("pageerror", (e) => log.push(`${name} pageerror ${e.message.split("\n")[0]}`));
  page.on("console", (m) => { if (m.type() === "error") log.push(`${name} console ${m.text().slice(0, 200)}`); });
};
const open = async (options, name, theme) => {
  const context = await browser.newContext({ locale: "fr-FR", ...options });
  if (theme) await context.addInitScript((t) => { try { localStorage.setItem("statarena.theme", t); } catch {} }, theme);
  const page = await context.newPage();
  watch(page, name);
  return page;
};
const DESKTOP = { viewport: { width: 1365, height: 900 } };
const PHONE = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

try {
  // ---- B1: header, desktop, dark
  const dark = await open(DESKTOP, "desktop-dark");
  await dark.goto(base + "/", { waitUntil: "networkidle" });
  await dark.waitForSelector(".topbar .brand img");
  await dark.waitForFunction(() => [...document.querySelectorAll(".topbar .brand img")].some((i) => i.complete && i.naturalWidth > 0));
  const head = await shown(dark, ".topbar .brand");
  const one = head.images.length === 1 ? head.images[0] : null;
  check("B1a", "one image in the header's home link: /branding/vega/logo-dark.svg", head.images.map((i) => i.src).join(", ") || "none", one?.src === "/branding/vega/logo-dark.svg");
  check("B1b", "the wordmark with « Sport » underneath (own width 1.6 to 2.2 times its height), drawn at its proportions, 36–44 px tall",
    one ? `own ${one.natural.join("×")} drawn ${one.box.join("×")}` : "none",
    one && ratio(one.natural) > 1.6 && ratio(one.natural) < 2.2 && undistorted(one) && one.box[1] >= 36 && one.box[1] <= 44);
  const bar = await dark.evaluate(() => {
    const top = document.querySelector(".topbar"), r = top.getBoundingClientRect();
    const parts = [...top.children].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 0);
    let overlap = 0;
    for (let i = 1; i < parts.length; i++) overlap = Math.max(overlap, parts[i - 1].right - parts[i].left);
    return { height: Math.round(r.height), right: Math.round(Math.max(...parts.map((b) => b.right))), window: innerWidth, overlap: Math.round(overlap), sideways: document.documentElement.scrollWidth - innerWidth };
  });
  check("B1c", "the header is 56 px tall, its parts neither overlap nor leave the window", bar, bar.height === 56 && bar.right <= bar.window && bar.overlap <= 0 && bar.sideways <= 0);
  check("B1d", "the link is named after what it shows: « Vega Sport »", `label « ${head.label} », alt « ${one?.alt ?? ""} »`, /Vega Sport/.test(head.label || "") && /Vega Sport/.test(one?.alt || ""));
  await dark.locator(".topbar").screenshot({ path: path.join(out, "header-desktop-dark.png") });
  await dark.screenshot({ path: path.join(out, "home-desktop-dark.png") });
  // ---- B11: the widths in between
  const between = [];
  for (const width of [1120, 1024, 768, 700]) {
    await dark.setViewportSize({ width, height: 900 });
    await dark.waitForTimeout(250);
    const brand = await shown(dark, ".topbar .brand");
    between.push({
      ...(await dark.evaluate((width) => {
        const top = document.querySelector(".topbar");
        const parts = [...top.children].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 0);
        let overlap = -Infinity;
        for (let i = 1; i < parts.length; i++) overlap = Math.max(overlap, parts[i - 1].right - parts[i].left);
        const actions = top.querySelector(".topbar-actions").getBoundingClientRect().left;
        const menus = [...top.children[1].querySelectorAll("a,button")].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
        return { width, right: Math.round(Math.max(...parts.map((b) => b.right))), overlap: Math.round(overlap), sideways: document.documentElement.scrollWidth - innerWidth, menusPastTheSearch: menus.filter((b) => b.right > actions + 0.5).length };
      }, width)),
      shows: brand.images.map((i) => i.src.split("/").pop()).join(","),
      link: brand.link[0],
    });
    await dark.locator(".topbar").screenshot({ path: path.join(out, `header-${width}.png`) });
  }
  const sane = (b) => b.right <= b.width && b.overlap <= 0 && b.sideways <= 0;
  const account = await dark.evaluate(() => Boolean(document.querySelector(".topbar .account-entry")));
  check("B11", "with the account button shown — 1120 px: the wordmark, every menu before the search; 1024, 768 and 700 px: the asterisk alone in a link of 44 px at most; nothing overlaps or leaves the window", { accountButton: account, between },
    account && between.every(sane) && between[0].shows === "logo-dark.svg" && between[0].menusPastTheSearch === 0 && between.slice(1).every((b) => b.shows === "symbol-dark.svg" && b.link <= 44));
  await dark.setViewportSize(DESKTOP.viewport);

  // ---- B5 (dark) and B7 on the same page
  const icon = await icons(dark);
  check("B5a", `dark theme: the page names one icon, ${themeIcon("dark")}`, readings(icon), only(icon, themeIcon("dark")));
  const colour = await colours(dark);
  check("B12a", `dark theme: the page names one theme colour, ${THEME_COLOUR.dark}`, readings(colour), only(colour, themed("dark")));
  for (const [id, address, test, what] of [
    ["B5b", "/branding/vega/icon-dark.svg", darkIcon, "night tile, ivory mark, no blue"],
    ["B5c", "/branding/vega/icon-light.svg", lightIcon, "ivory tile, night mark, no blue"],
    ["B5d", "/favicon.ico", darkIcon, "night tile, ivory mark, no blue"],
    ["B5e", "/apple-touch-icon.png", darkIcon, "night tile, ivory mark, no blue"],
  ]) {
    const p = await pixels(dark, address);
    check(id, `${address}: ${what}`, brief(p), test(p));
  }
  for (const [id, address, ink] of [["B5g", "/branding/vega/icon-dark.svg", "ivory"], ["B5h", "/branding/vega/icon-light.svg", "night"], ["B5i", "/favicon.ico", "ivory"], ["B5j", "/apple-touch-icon.png", "ivory"]]) {
    const b = await balance(dark, address, ink);
    check(id, `${address}: the asterisk alone, as much ink left as right, top as bottom`, b, b.ok);
  }
  // ---- B6: app icons
  for (const side of [180, 192, 512]) {
    const p = await pixels(dark, `/api/vega-image?kind=icon&size=${side}`);
    check(`B6-${side}`, `app icon ${side} px: a PNG of that size, night tile, ivory mark, no blue, no pure black`, brief(p), p.type === "image/png" && darkIcon(p, side));
  }
  const app = await balance(dark, "/api/vega-image?kind=icon&size=512", "ivory");
  check("B6-alone", "app icon 512 px: the asterisk alone, as much ink left as right, top as bottom", app, app.ok);
  const lightApp = await pixels(dark, "/api/vega-image?kind=icon&size=192&theme=light");
  check("B6-light", "app icon, theme=light: ivory tile, night mark", brief(lightApp), lightIcon(lightApp, 192));

  // ---- B7: share image
  const meta = await dark.evaluate(() => ({
    og: document.querySelector('meta[property="og:image"]')?.content || "",
    twitter: document.querySelector('meta[name="twitter:image"]')?.content || "",
  }));
  const sharePath = (() => { try { return new URL(meta.og).pathname; } catch { return ""; } })();
  check("B7a", "og:image and twitter:image name the same picture under /branding/vega/", meta, meta.og && meta.og === meta.twitter && sharePath.startsWith("/branding/vega/"));
  const card = await pixels(dark, sharePath || "/api/vega-image?kind=og", [0, 0.5, 0.75, 1]);
  check("B7b", "the share picture is 1200 × 630 with the ivory wordmark in its lower left and no blue", brief(card), card.size?.[0] === 1200 && card.size?.[1] === 630 && card.ivory > 0.02 && card.blue < 0.001);
  const old = await dark.evaluate(async () => { const r = await fetch("/api/vega-image?kind=og"); return { status: r.status, url: new URL(r.url).pathname, type: r.headers.get("content-type") }; });
  check("B7c", "the old address /api/vega-image?kind=og leads to the same picture", old, old.status === 200 && old.url === sharePath);

  // ---- B8: footer
  await dark.locator(".site-footer").scrollIntoViewIfNeeded();
  await dark.waitForFunction(() => [...document.querySelectorAll(".site-footer-home img")].some((i) => i.complete && i.naturalWidth > 0));
  const foot = await shown(dark, ".site-footer-home");
  const f1 = foot.images.length === 1 ? foot.images[0] : null;
  check("B8", "the footer's home link shows the wordmark at its proportions, 48–64 px tall",
    f1 ? `${f1.src} own ${f1.natural.join("×")} drawn ${f1.box.join("×")}` : `${foot.images.length} images`,
    f1 && f1.src === "/branding/vega/logo-dark.svg" && ratio(f1.natural) > 1.6 && ratio(f1.natural) < 2.2 && undistorted(f1) && f1.box[1] >= 48 && f1.box[1] <= 64);
  await dark.locator(".site-footer-home").screenshot({ path: path.join(out, "footer-dark.png") });

  // ---- B10: a report card
  // The place of the brand at the top left of a card: 146 × 70 px from (65, 54).
  const report = await pixels(dark, `/api/rapport/image?id=${REPORT}&n=1`, [0.06, 0.04, 0.195, 0.092]);
  check("B10", "report image 1080 × 1350: ivory wordmark at the top left (over 8 % of that place), no blue star", brief(report), report.size?.[0] === 1080 && report.size?.[1] === 1350 && report.ivory > 0.08 && report.blue === 0);
  // ---- B5k: the dark theme's icon after a navigation inside the site
  await dark.evaluate(() => { window.__sameDocument = true; });
  const rebuiltDark = await follow(dark, '.topbar a[href^="/matchs"]', (url) => url.pathname.startsWith("/matchs"));
  const movedDark = await icons(dark);
  const stayedDark = await dark.evaluate(() => window.__sameDocument === true);
  check("B5k", `dark theme, after a navigation inside the site (home → Matchs, same document): still ${themeIcon("dark")} alone`,
    `${readings(movedDark)} — same document: ${stayedDark} — head's icon links rebuilt: ${rebuiltDark}`, stayedDark && only(movedDark, themeIcon("dark")));
  // ---- B12b–B12d: the theme colour after that navigation, the theme button, and a navigation again
  const colourMovedDark = await colours(dark);
  check("B12b", `dark theme, after a navigation inside the site (home → Matchs, same document): still ${THEME_COLOUR.dark} alone`,
    `${readings(colourMovedDark)} — same document: ${stayedDark} — head rebuilt: ${rebuiltDark}`, stayedDark && only(colourMovedDark, themed("dark")));
  await dark.locator(".theme-toggle").first().click();
  await dark.waitForFunction(() => document.documentElement.dataset.theme === "light");
  const colourSwitchedLight = await colours(dark);
  check("B12c", `after the theme button (dark → light): ${THEME_COLOUR.light} alone`, readings(colourSwitchedLight), only(colourSwitchedLight, themed("light")));
  const rebuiltLight = await follow(dark, ".topbar .brand", (url) => url.pathname === "/");
  const colourBackLight = await colours(dark);
  const stayedLight = await dark.evaluate(() => window.__sameDocument === true);
  check("B12d", `after the button, then a navigation (Matchs → home, same document): still ${THEME_COLOUR.light} alone`,
    `${readings(colourBackLight)} — same document: ${stayedLight} — head rebuilt: ${rebuiltLight}`, stayedLight && only(colourBackLight, themed("light")));
  await dark.context().close();

  // ---- B2 and B5 (light)
  const light = await open(DESKTOP, "desktop-light", "light");
  await light.goto(base + "/", { waitUntil: "networkidle" });
  await light.waitForFunction(() => document.documentElement.dataset.theme === "light" && [...document.querySelectorAll(".topbar .brand img")].some((i) => i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width > 0));
  const headLight = await shown(light, ".topbar .brand");
  check("B2", "light theme: the header shows logo-light.svg and only it", headLight.images.map((i) => i.src).join(", ") || "none", headLight.images.length === 1 && headLight.images[0].src === "/branding/vega/logo-light.svg" && undistorted(headLight.images[0]));
  const iconLight = await icons(light);
  check("B5f", `light theme: the page names one icon, ${themeIcon("light")}`, readings(iconLight), only(iconLight, themeIcon("light")));
  const colourLight = await colours(light);
  check("B12e", `light theme: the page names one theme colour, ${THEME_COLOUR.light}`, readings(colourLight), only(colourLight, themed("light")));
  await light.locator(".topbar").screenshot({ path: path.join(out, "header-desktop-light.png") });
  // ---- B5o: without scripts
  const plain = await open({ ...DESKTOP, javaScriptEnabled: false }, "no-scripts");
  await plain.goto(base + "/", { waitUntil: "load" });
  const iconPlain = await icons(plain, 1);
  check("B5o", `without scripts the page names one icon, /branding/vega/favicon.svg?v=${VERSION}`, readings(iconPlain), only(iconPlain, `/branding/vega/favicon.svg?v=${VERSION}`));
  const colourPlain = await colours(plain, 1);
  check("B12i", `without scripts the page is dark and names one theme colour, ${THEME_COLOUR.dark}`, readings(colourPlain), only(colourPlain, themed("dark")));
  await plain.context().close();

  // ---- B5p: the browser refuses the storage (reads and writes throw)
  const refused = await open(DESKTOP, "storage-refused");
  await refused.context().addInitScript(() => {
    const refuse = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
    Storage.prototype.getItem = refuse;
    Storage.prototype.setItem = refuse;
  });
  await refused.goto(base + "/", { waitUntil: "networkidle" });
  const iconRefused = await icons(refused);
  const colourRefused = await colours(refused);
  await refused.locator(".theme-toggle").first().click();
  await refused.waitForFunction(() => document.documentElement.dataset.theme === "light");
  const iconRefusedLight = await icons(refused);
  const colourRefusedLight = await colours(refused);
  check("B5p", `storage refused: ${themeIcon("dark")} alone at load, ${themeIcon("light")} alone after the theme button`,
    `at load: ${readings(iconRefused)} — after the button: ${readings(iconRefusedLight)}`, only(iconRefused, themeIcon("dark")) && only(iconRefusedLight, themeIcon("light")));
  check("B12j", `storage refused: ${THEME_COLOUR.dark} alone at load, ${THEME_COLOUR.light} alone after the theme button`,
    `at load: ${readings(colourRefused)} — after the button: ${readings(colourRefusedLight)}`, only(colourRefused, themed("dark")) && only(colourRefusedLight, themed("light")));
  await refused.context().close();

  // ---- B3: the drawings themselves
  for (const [file, fill] of [["logo-dark", "#F4F1EA"], ["logo-light", "#07080B"], ["symbol-dark", "#F4F1EA"], ["symbol-light", "#07080B"], ["icon-dark", "#F4F1EA"], ["icon-light", "#07080B"], ["favicon", "#F4F1EA"]]) {
    const svg = await text(`/branding/vega/${file}.svg`);
    const facts = { status: svg.status, gradient: /linearGradient/i.test(svg.body), star: svg.body.includes("M 559 1"), fill: svg.body.toUpperCase().includes(fill), circles: (svg.body.match(/<circle/g) || []).length, outlines: (svg.body.match(/<path/g) || []).length };
    const alone = file.startsWith("logo") || facts.outlines === 1;
    check(`B3-${file}`, `${file}.svg: no gradient, no star outline, ${fill}, no circle left${file.startsWith("logo") ? "" : ", one outline (the asterisk alone)"}`, facts, svg.status === 200 && !facts.gradient && !facts.star && facts.fill && facts.circles === 0 && alone);
  }
  // The asterisk sits at the top right of the logo: the last 13 % of its width, the first 27 % of its height.
  const corner = await pixels(light, "/branding/vega/logo-dark.svg", [0.87, 0, 1, 0.27]);
  check("B3-asterisk", "logo-dark.svg: its top right corner is mostly ivory ink (the asterisk)", brief(corner), corner.ivory > 0.25);
  // ---- B5l–B5n: the icon across a navigation inside the site and the theme button
  await light.evaluate(() => { window.__sameDocument = true; });
  const sameDocument = () => light.evaluate(() => window.__sameDocument === true);
  const rebuilt = await follow(light, '.topbar a[href^="/matchs"]', (url) => url.pathname.startsWith("/matchs"));
  const moved = await icons(light);
  check("B5l", `light theme, after a navigation inside the site (home → Matchs, same document): still ${themeIcon("light")} alone`,
    `${readings(moved)} — same document: ${await sameDocument()} — head's icon links rebuilt: ${rebuilt}`, (await sameDocument()) && only(moved, themeIcon("light")));
  const colourMoved = await colours(light);
  check("B12f", `light theme, after a navigation inside the site (home → Matchs, same document): still ${THEME_COLOUR.light} alone`,
    `${readings(colourMoved)} — same document: ${await sameDocument()} — head rebuilt: ${rebuilt}`, (await sameDocument()) && only(colourMoved, themed("light")));
  await light.locator(".theme-toggle").first().click();
  await light.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  const switched = await icons(light);
  check("B5m", `after the theme button (light → dark): ${themeIcon("dark")} alone`, readings(switched), only(switched, themeIcon("dark")));
  const colourSwitched = await colours(light);
  check("B12g", `after the theme button (light → dark): ${THEME_COLOUR.dark} alone`, readings(colourSwitched), only(colourSwitched, themed("dark")));
  const rebuiltBack = await follow(light, ".topbar .brand", (url) => url.pathname === "/");
  const back = await icons(light);
  check("B5n", `after the button, then a navigation (Matchs → home, same document): still ${themeIcon("dark")} alone`,
    `${readings(back)} — same document: ${await sameDocument()} — head's icon links rebuilt: ${rebuiltBack}`, (await sameDocument()) && only(back, themeIcon("dark")));
  const colourBack = await colours(light);
  check("B12h", `after the button, then a navigation (Matchs → home, same document): still ${THEME_COLOUR.dark} alone`,
    `${readings(colourBack)} — same document: ${await sameDocument()} — head rebuilt: ${rebuiltBack}`, (await sameDocument()) && only(colourBack, themed("dark")));
  await light.context().close();

  // ---- B4: phone
  const phone = await open(PHONE, "phone");
  await phone.goto(base + "/", { waitUntil: "networkidle" });
  await phone.waitForFunction(() => [...document.querySelectorAll(".topbar .brand img")].some((i) => i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width > 0));
  const headPhone = await shown(phone, ".topbar .brand");
  const mark = headPhone.images.length === 1 ? headPhone.images[0] : null;
  check("B4a", "phone: the header shows the asterisk alone (symbol-dark.svg, 0.85 to 1 times as wide as tall), 26–30 px tall",
    mark ? `${mark.src} own ${mark.natural.join("×")} drawn ${mark.box.join("×")}` : `${headPhone.images.length} images`,
    mark && mark.src === "/branding/vega/symbol-dark.svg" && ratio(mark.natural) > 0.85 && ratio(mark.natural) < 1 && undistorted(mark) && mark.box[1] >= 26 && mark.box[1] <= 30);
  const sideways = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check("B4b", "phone: a 44 px tap target and no sideways scroll", { link: headPhone.link, sideways }, headPhone.link[0] >= 44 && headPhone.link[1] >= 44 && sideways <= 0);
  await phone.locator(".topbar").screenshot({ path: path.join(out, "header-phone.png") });
  await phone.context().close();

  // ---- B9: the loading mark, with the data held back
  const slow = await open(DESKTOP, "loading");
  await slow.route(
    (url) => url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/vega-image"),
    (route) => setTimeout(() => route.continue().catch(() => {}), 8000),
  );
  await slow.goto(base + "/joueurs/", { waitUntil: "commit" });
  const loader = await slow
    .waitForSelector("[data-page-loader] svg", { state: "visible", timeout: 7000 })
    .then(() =>
      slow.evaluate(() => {
        const svg = document.querySelector("[data-page-loader] svg");
        return {
          star: [...svg.querySelectorAll("path")].some((p) => (p.getAttribute("d") || "").startsWith("M 559 1")),
          gradients: svg.querySelectorAll("linearGradient").length,
          circles: svg.querySelectorAll("circle").length,
          outlines: svg.querySelectorAll("path").length,
          label: svg.closest("button")?.getAttribute("aria-label") || "",
        };
      }),
    )
    .then(async (facts) => {
      const angles = [];
      for (let i = 0; i < 8; i++) {
        angles.push(await slow.evaluate(() => {
          const path = document.querySelector("[data-page-loader] svg path:last-of-type");
          if (!path) return null;
          const m = new DOMMatrixReadOnly(getComputedStyle(path).transform);
          return Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI);
        }));
        await slow.waitForTimeout(150);
      }
      return { ...facts, angles };
    })
    .catch((error) => ({ missing: error.message.split("\n")[0] }));
  check("B9", "the loading mark is the asterisk alone: no star outline, no gradient, no circle, one outline", loader, loader.star === false && loader.gradients === 0 && loader.circles === 0 && loader.outlines === 1);
  const off = (loader.angles || []).filter((a) => a !== null).map((a) => Math.abs(((a % 60) + 90) % 60 - 30));
  check("B9b", "the loading mark is seen turning: an angle at least 5° away from a multiple of 60° among eight readings", loader.angles || "none", off.some((d) => d >= 5));
  // The page may finish loading while the picture is taken: a missing picture is not a failed check.
  if (!loader.missing) await slow.locator("[data-page-loader]").screenshot({ path: path.join(out, "loading.png"), timeout: 3000 }).catch(() => {});
  await slow.context().close();

  check("X1", "no page error and no console error", consoleLog.length ? consoleLog.slice(0, 5).join(" | ") : "none", consoleLog.length === 0);
} catch (error) {
  // A step that stops the run is a failure, never a shorter list of passes.
  check("RUN", "the run completes", `error: ${error.message.split("\n")[0]}`, false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  await writeFile(
    path.join(out, "evidence.json"),
    JSON.stringify(
      {
        subject: "Brand: Vega's logo on the site — the wordmark « Vega* » in the header and the footer, the asterisk alone as mark, icons and loading mark, the share image, the report cards; the page's theme colour",
        observed: new Date().toISOString(),
        base,
        rerun: `node tests/e2e/brand.e2e.mjs ${base} ${out}`,
        setup: "Chromium headless, fr-FR; desktop 1365×900 (dark, then light through localStorage statarena.theme), widths 1120, 1024, 768 and 700, phone 393×852 (touch, ×3). B5: every list of icons is read 5 times, 300 ms apart, after a navigation once the head's icon links are rebuilt (a new apple-touch-icon node, waited for 5 s at most); B5o runs with JavaScript off; B5p makes Storage.getItem and Storage.setItem throw. B12: every list of theme colours is read the same way, at the same moments, with the site's theme (html data-theme) and the body's computed background; B12c and B12d press the theme button on the dark page, then follow the home link; B12i and B12j use the pages of B5o and B5p. B9 holds every /api/ answer for 8 s. A local server needs ORION_API_ORIGIN (report images) and, for the header to carry the account button as in production, NEON_AUTH_BASE_URL=http://127.0.0.1:9 with any NEON_AUTH_COOKIE_SECRET of 32 characters.",
        inputs: { home: "/", loading: "/joueurs/", report: REPORT, faviconVersion: VERSION, themeColour: THEME_COLOUR, ivory: IVORY, night: NIGHT },
        results,
        console: consoleLog,
        consoleOfTheLoadingPage: elsewhere,
        passed: results.length - failed,
        failed,
      },
      null,
      2,
    ),
  );
  console.log(`${results.length - failed}/${results.length} passed — ${out}`);
  process.exitCode = failed ? 1 : 0;
}

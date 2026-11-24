// E2E — the site carries the logo « Vega. » chosen by the user on 24 Nov 2026 (charter:
// docs/brand/README.md): the wordmark « Vega Sport. » in the header and the footer, the mark
// « V. » where room is short, two colours only (ivory #F4F1EA, night #07080B).
// Written before the implementation, against the real pages, on a desktop (1365×900, dark and
// light) and an iPhone 16 (393×852).
//
// Failure modes and expected outcomes:
//  B1 (header) Desktop, dark: the home link of the header shows one image, the wordmark
//     (/branding/vega/logo-dark.svg, more than 3.5 times wider than tall), drawn at its own
//     proportions, 24 to 32 px tall. The header keeps its 56 px and nothing in it overlaps or
//     leaves the window. Before: the star alone, 30 px.
//  B2 (theme) Light theme: the same place shows logo-light.svg and only it.
//  B3 (drawings) The served files are the new drawings: no gradient, no star outline
//     (« M 559 1 »), the ivory or night fill, one point drawn as a circle. Checked on the
//     logo, the mark, the two icons and the favicon.
//  B4 (phone) The header shows the mark « V. » (/branding/vega/symbol-dark.svg, about square),
//     28 to 32 px tall, in a tap target of 44 px, and the page does not scroll sideways.
//  B5 (favicon) The page's icon is /branding/vega/icon-dark.svg in the dark theme and
//     icon-light.svg in the light one, with the new version number. React puts the page's own
//     favicon.svg link back beside it after hydration (as before this change): that one must
//     be the new drawing at the new version too, and no other icon may be named.
//     /favicon.ico and /apple-touch-icon.png answer with the new icon (night tile, ivory
//     mark, no blue).
//  B6 (app icons) /api/vega-image?kind=icon at 180, 192 and 512 px: a PNG of that size, night
//     tile, ivory mark, no blue, no pure black; theme=light gives the ivory tile.
//  B7 (share image) og:image and twitter:image name the same picture, 1200 × 630, with the
//     ivory wordmark in its lower left quarter and no blue; the old address
//     /api/vega-image?kind=og leads to that same picture.
//  B8 (footer) The footer's home link shows the wordmark, at its proportions, 34 to 48 px tall.
//  B9 (loading) While a page waits for its data, the loading mark is « V. »: no star outline,
//     no gradient, a circle for the point.
//  B10 (report card) A report image carries the wordmark in ivory at its top left, no blue star.
//  B11 (in between) The wordmark must not take the menus' room. At 1024 px it shows and every
//     menu still ends before the search field. At 768 and 700 px the mark « V. » shows
//     instead, in a link no wider than 44 px (the room the old mark took), and the header's
//     parts neither overlap nor leave the window.
//  X1 No page error and no console error on the home page (desktop dark and light, phone).
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
const VERSION = 3; // faviconVersion of app/layout.jsx after the change
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
  check("B1b", "a wordmark (own width over 3.5 times its height), drawn at its proportions, 24–32 px tall",
    one ? `own ${one.natural.join("×")} drawn ${one.box.join("×")}` : "none",
    one && ratio(one.natural) > 3.5 && undistorted(one) && one.box[1] >= 24 && one.box[1] <= 32);
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
  for (const width of [1024, 768, 700]) {
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
  check("B11", "1024 px: the wordmark, every menu before the search; 768 and 700 px: the mark « V. » in a link of 44 px at most; nothing overlaps or leaves the window", between,
    between.every(sane) && between[0].shows === "logo-dark.svg" && between[0].menusPastTheSearch === 0 && between.slice(1).every((b) => b.shows === "symbol-dark.svg" && b.link <= 44));
  await dark.setViewportSize(DESKTOP.viewport);

  // ---- B5 (dark) and B7 on the same page
  const icon = await dark.evaluate(() => [...document.querySelectorAll('link[rel="icon"]')].map((l) => new URL(l.href).pathname + new URL(l.href).search));
  const themed = (list, theme) => list.includes(`/branding/vega/icon-${theme}.svg?v=${VERSION}`) && list.every((href) => [`/branding/vega/icon-${theme}.svg?v=${VERSION}`, `/branding/vega/favicon.svg?v=${VERSION}`].includes(href));
  check("B5a", `the page's icon in the dark theme: /branding/vega/icon-dark.svg?v=${VERSION} (and at most the page's own favicon.svg?v=${VERSION})`, icon.join(", "), themed(icon, "dark"));
  for (const [id, address, test, what] of [
    ["B5b", "/branding/vega/icon-dark.svg", darkIcon, "night tile, ivory mark, no blue"],
    ["B5c", "/branding/vega/icon-light.svg", lightIcon, "ivory tile, night mark, no blue"],
    ["B5d", "/favicon.ico", darkIcon, "night tile, ivory mark, no blue"],
    ["B5e", "/apple-touch-icon.png", darkIcon, "night tile, ivory mark, no blue"],
  ]) {
    const p = await pixels(dark, address);
    check(id, `${address}: ${what}`, brief(p), test(p));
  }
  // ---- B6: app icons
  for (const side of [180, 192, 512]) {
    const p = await pixels(dark, `/api/vega-image?kind=icon&size=${side}`);
    check(`B6-${side}`, `app icon ${side} px: a PNG of that size, night tile, ivory mark, no blue, no pure black`, brief(p), p.type === "image/png" && darkIcon(p, side));
  }
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
  check("B8", "the footer's home link shows the wordmark at its proportions, 34–48 px tall",
    f1 ? `${f1.src} own ${f1.natural.join("×")} drawn ${f1.box.join("×")}` : `${foot.images.length} images`,
    f1 && f1.src === "/branding/vega/logo-dark.svg" && ratio(f1.natural) > 3.5 && undistorted(f1) && f1.box[1] >= 34 && f1.box[1] <= 48);
  await dark.locator(".site-footer-home").screenshot({ path: path.join(out, "footer-dark.png") });

  // ---- B10: a report card
  // The place of the brand at the top left of a card: 146 × 70 px from (65, 54).
  const report = await pixels(dark, `/api/rapport/image?id=${REPORT}&n=1`, [0.06, 0.04, 0.195, 0.092]);
  check("B10", "report image 1080 × 1350: ivory wordmark at the top left (over 8 % of that place), no blue star", brief(report), report.size?.[0] === 1080 && report.size?.[1] === 1350 && report.ivory > 0.08 && report.blue === 0);
  await dark.context().close();

  // ---- B2 and B5 (light)
  const light = await open(DESKTOP, "desktop-light", "light");
  await light.goto(base + "/", { waitUntil: "networkidle" });
  await light.waitForFunction(() => document.documentElement.dataset.theme === "light" && [...document.querySelectorAll(".topbar .brand img")].some((i) => i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width > 0));
  const headLight = await shown(light, ".topbar .brand");
  check("B2", "light theme: the header shows logo-light.svg and only it", headLight.images.map((i) => i.src).join(", ") || "none", headLight.images.length === 1 && headLight.images[0].src === "/branding/vega/logo-light.svg" && undistorted(headLight.images[0]));
  const iconLight = await light.evaluate(() => [...document.querySelectorAll('link[rel="icon"]')].map((l) => new URL(l.href).pathname + new URL(l.href).search));
  check("B5f", `the page's icon in the light theme: /branding/vega/icon-light.svg?v=${VERSION} (and at most the page's own favicon.svg?v=${VERSION})`, iconLight.join(", "), themed(iconLight, "light"));
  await light.locator(".topbar").screenshot({ path: path.join(out, "header-desktop-light.png") });
  await light.context().close();

  // ---- B3: the drawings themselves
  for (const [file, fill] of [["logo-dark", "#F4F1EA"], ["logo-light", "#07080B"], ["symbol-dark", "#F4F1EA"], ["symbol-light", "#07080B"], ["icon-dark", "#F4F1EA"], ["icon-light", "#07080B"], ["favicon", "#F4F1EA"]]) {
    const svg = await text(`/branding/vega/${file}.svg`);
    const facts = { status: svg.status, gradient: /linearGradient/i.test(svg.body), star: svg.body.includes("M 559 1"), fill: svg.body.toUpperCase().includes(fill), circles: (svg.body.match(/<circle/g) || []).length };
    check(`B3-${file}`, `${file}.svg: no gradient, no star outline, ${fill}, one circle for the point`, facts, svg.status === 200 && !facts.gradient && !facts.star && facts.fill && facts.circles === 1);
  }

  // ---- B4: phone
  const phone = await open(PHONE, "phone");
  await phone.goto(base + "/", { waitUntil: "networkidle" });
  await phone.waitForFunction(() => [...document.querySelectorAll(".topbar .brand img")].some((i) => i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width > 0));
  const headPhone = await shown(phone, ".topbar .brand");
  const mark = headPhone.images.length === 1 ? headPhone.images[0] : null;
  check("B4a", "phone: the header shows the mark « V. » (symbol-dark.svg, about square), 28–32 px tall",
    mark ? `${mark.src} own ${mark.natural.join("×")} drawn ${mark.box.join("×")}` : `${headPhone.images.length} images`,
    mark && mark.src === "/branding/vega/symbol-dark.svg" && ratio(mark.natural) > 0.9 && ratio(mark.natural) < 1.25 && undistorted(mark) && mark.box[1] >= 28 && mark.box[1] <= 32);
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
          label: svg.closest("button")?.getAttribute("aria-label") || "",
        };
      }),
    )
    .catch((error) => ({ missing: error.message.split("\n")[0] }));
  check("B9", "the loading mark is « V. »: no star outline, no gradient, a circle for the point", loader, loader.star === false && loader.gradients === 0 && loader.circles >= 1);
  if (!loader.missing) await slow.locator("[data-page-loader]").screenshot({ path: path.join(out, "loading.png") });
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
        subject: "Brand: the logo « Vega. » on the site (header, footer, icons, share image, loading mark, report cards)",
        observed: new Date().toISOString(),
        base,
        rerun: `node tests/e2e/brand.e2e.mjs ${base} ${out}`,
        setup: "Chromium headless, fr-FR; desktop 1365×900 (dark, then light through localStorage statarena.theme), phone 393×852 (touch, ×3). B9 holds every /api/ answer for 8 s.",
        inputs: { home: "/", loading: "/joueurs/", report: REPORT, faviconVersion: VERSION, ivory: IVORY, night: NIGHT },
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

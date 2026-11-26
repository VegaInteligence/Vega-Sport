// E2E — the site's navigation bar as piste B of the mock-up hugo chose on 26 Nov 2026 (14 h 44 « lets go on B »,
// https://claude.ai/artifact/AripxUsLqPgkJQndd7YQhr) with its menus as « Un panneau qui glisse, en tuiles »
// (piste 1 of https://claude.ai/artifact/GxP3vebwEg17Eo4Fk5wdFm, 14 h 48 « envoie ça en prod »). FAILURE_MODES § 76.
// Written before the implementation.
//
// Failure modes and expected outcomes (the home page, dark theme unless said):
//  N1  1440 px: no line under the header; the five sections sit in one track (999 px corners, the pills' track
//      veil), centred in the window (±2 px); the header stays 56 px tall.
//  N2  The current section (« Vue d’ensemble » on the home page) is a filled pill: ivory on night, 999 px corners,
//      no underline; the other sections have no fill.
//  N3  A mouse over « Compétitions » opens one panel under the track: 22 px corners, inside the window, below the
//      track; « Toutes les compétitions » and « Archives », then the six leagues as tiles, each with its logo
//      (an image, or its initials) and its name.
//  N4  Moving to « Équipes » keeps the same panel open (the same element, not closed and reopened) and shows
//      « Clubs » and « Nations »; « Équipes » is the expanded one.
//  N5  Under the mouse a veil glides in the track behind the section (its left edge and width those of the section).
//  N6  Moving to « Calendrier » (no menu) closes the panel.
//  N7  1440 px: the search is a round 34 px icon (no field text); a click opens the field (300 px at least,
//      focused); Escape twice closes it again.
//  N8  The theme button is round, the account button a pill.
//  N9  1000 px: the track follows the logo (no overlap with the logo nor the actions).
//  N10 Light theme: the current section is night on ivory.
//  N11 Phone (393 px): the tab bar is a floating pill; the current tab is filled; the other tabs show their icon only
//      but keep their name for a screen reader; a tap on « Compétitions » opens a sheet with 22 px corners, the two
//      pages and the six league tiles.
//  N12 No sideways scroll at 393 and 1440 px.
//  X1  No page error.
//
//   node tests/e2e/navbar.e2e.mjs <base url> <evidence dir>     (a `next build` + `next start`, not `next dev`)
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const { chromium, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const [base = "http://127.0.0.1:3000", out = "/tmp/navbar-e2e"] = process.argv.slice(2);
await mkdir(out, { recursive: true });

const results = [];
const errors = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${expected} — ${JSON.stringify(actual)}`);
};
const LEAGUES = ["Ligue 1", "Premier League", "LaLiga", "Bundesliga", "Serie A", "Ligue des champions"];
const IVORY = "rgb(244, 241, 234)", NIGHT = "rgb(7, 8, 11)", NIGHT_LIGHT = "rgb(11, 13, 15)";

const browser = await chromium.launch();
async function open(options, scheme = "dark", path = "/") {
  const context = await browser.newContext({ locale: "fr-FR", colorScheme: scheme, ...options });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("vega.consent.v1", JSON.stringify({ measurement: false, at: "2026-11-25T12:00:00Z" })));
  // The site's theme is its own choice (dark unless « statarena.theme » says light), not the system's.
  if (scheme === "light") await page.addInitScript(() => localStorage.setItem("statarena.theme", "light"));
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
  await page.goto(base + path, { waitUntil: "load", timeout: 90000 });
  await page.waitForSelector(".topbar .brand");
  await page.waitForTimeout(600);
  return page;
}

const bar = (page) => page.evaluate(() => {
  const top = document.querySelector(".topbar"), nav = top.querySelector(".main-nav");
  const box = (e) => { const r = e.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }; };
  const items = [...nav.querySelectorAll(":scope > a, :scope > .nav-menu > button")];
  const style = (e) => { const c = getComputedStyle(e), a = getComputedStyle(e, "::after"); return { bg: c.backgroundColor, color: c.color, radius: c.borderTopLeftRadius, after: a.content !== "none" && parseFloat(a.height) > 0 }; };
  const t = getComputedStyle(top), n = getComputedStyle(nav);
  return {
    height: box(top).height,
    line: t.borderBottomWidth === "0px" || /rgba\(.*, 0\)$/.test(t.borderBottomColor) || t.borderBottomColor === "transparent" ? "none" : `${t.borderBottomWidth} ${t.borderBottomColor}`,
    track: { radius: n.borderTopLeftRadius, bg: n.backgroundColor, ...box(nav), centre: Math.round((box(nav).left + box(nav).right) / 2) },
    items: items.map((e) => ({ text: e.innerText.trim(), current: e.getAttribute("aria-current"), expanded: e.getAttribute("aria-expanded"), ...style(e), ...box(e) })),
    brand: box(top.querySelector(".brand")),
    actions: box(top.querySelector(".topbar-actions")),
    window: innerWidth,
    sideways: document.documentElement.scrollWidth - innerWidth,
  };
});
const panel = (page) => page.evaluate(() => {
  const p = document.querySelector(".topbar .nav-panel");
  if (!p) return null;
  const label = (e) => (e.querySelector(":scope > span:last-child") || e).innerText.trim(); 
  const c = getComputedStyle(p), r = p.getBoundingClientRect();
  const leagues = [...p.querySelectorAll(".nav-league")].map((l) => ({ name: label(l), logo: Boolean(l.querySelector("img, .crest")) }));
  return {
    id: p.dataset.probe || null, shown: Number(c.opacity) > 0.9 && c.visibility !== "hidden" && r.height > 20,
    radius: c.borderTopLeftRadius, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top),
    entries: [...p.querySelectorAll(".nav-menu-item")].map(label), leagues,
  };
});
const hover = async (page, name) => {
  await page.locator(".topbar .main-nav").getByRole(name === "Calendrier" ? "link" : "button", { name, exact: true }).hover();
  await page.waitForTimeout(450);
};

try {
  // ------------------------------------------------------------------ computer, dark
  const page = await open({ viewport: { width: 1440, height: 900 } });
  const b = await bar(page);
  await page.locator(".topbar").screenshot({ path: join(out, "barre-1440.png") });
  check("N1", "no line under the header, one centred track (999 px, veil), header 56 px",
    { line: b.line, track: b.track, height: b.height },
    b.line === "none" && b.track.radius === "999px" && b.track.bg !== "rgba(0, 0, 0, 0)" && Math.abs(b.track.centre - 720) <= 2 && b.height === 56);
  const current = b.items.find((i) => i.current);
  check("N2", "the current section a filled pill (ivory on night, 999 px, no underline), the others unfilled",
    { current, others: b.items.filter((i) => !i.current).map((i) => i.bg) },
    current && current.text === "Vue d’ensemble" && current.bg === IVORY && current.color === NIGHT && current.radius === "999px" && !current.after &&
      b.items.filter((i) => !i.current).every((i) => i.bg === "rgba(0, 0, 0, 0)"));

  await hover(page, "Compétitions");
  await page.evaluate(() => { const p = document.querySelector(".topbar .nav-panel"); if (p) p.dataset.probe = "first"; });
  const comp = await panel(page);
  await page.screenshot({ path: join(out, "menu-competitions-1440.png"), clip: { x: 0, y: 0, width: 1440, height: 420 } });
  check("N3", "Compétitions: one panel under the track, 22 px, inside the window, two pages and six league tiles with logos",
    comp, comp && comp.shown && comp.radius === "22px" && comp.left >= 0 && comp.right <= 1440 && comp.top >= b.track.bottom &&
      ["Toutes les compétitions", "Archives"].every((n) => comp.entries.includes(n)) &&
      comp.leagues.length === 6 && LEAGUES.every((n, k) => comp.leagues[k]?.name === n) && comp.leagues.every((l) => l.logo));

  await hover(page, "Équipes");
  const teams = await panel(page);
  const after = await bar(page);
  check("N4", "Équipes: the same panel, moved, with Clubs and Nations; Équipes expanded, Compétitions not",
    { teams, expanded: after.items.filter((i) => i.expanded === "true").map((i) => i.text) },
    teams && teams.shown && teams.id === "first" && teams.entries.includes("Clubs") && teams.entries.includes("Nations") && teams.leagues.length === 0 &&
      after.items.find((i) => i.text.startsWith("Équipes"))?.expanded === "true" && after.items.find((i) => i.text.startsWith("Compétitions"))?.expanded === "false");

  await hover(page, "Joueurs");
  const glide = await page.evaluate(() => {
    const g = document.querySelector(".topbar .nav-glide"), j = [...document.querySelectorAll(".topbar .nav-menu > button")].find((x) => x.innerText.includes("Joueurs"));
    if (!g || !j) return null;
    const a = g.getBoundingClientRect(), r = j.getBoundingClientRect();
    return { opacity: Number(getComputedStyle(g).opacity), left: Math.round(a.left), width: Math.round(a.width), button: [Math.round(r.left), Math.round(r.width)] };
  });
  check("N5", "a veil glides behind the section under the mouse", glide,
    glide && glide.opacity > 0.9 && Math.abs(glide.left - glide.button[0]) <= 2 && Math.abs(glide.width - glide.button[1]) <= 2);

  await hover(page, "Calendrier");
  const gone = await panel(page);
  check("N6", "Calendrier (no menu) closes the panel", gone, !gone || !gone.shown);
  await page.mouse.move(3, 500);
  await page.waitForTimeout(400);

  const search = () => page.evaluate(() => {
    const f = document.querySelector(".topbar .global-search-field"), i = document.querySelector(".topbar .global-search input"), r = f.getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height), radius: getComputedStyle(f).borderTopLeftRadius, text: Number(getComputedStyle(i).opacity) > 0.5, focused: document.activeElement === i };
  });
  const closed = await search();
  await page.locator(".topbar .global-search input").click();
  await page.waitForTimeout(300);
  const opened = await search();
  await page.locator(".topbar").screenshot({ path: join(out, "recherche-1440.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const again = await search();
  check("N7", "1440 px: the search a round 34 px icon; a click opens the field (300 px, focused); Escape twice closes it",
    { closed, opened, again },
    closed.width === 34 && closed.height === 34 && parseFloat(closed.radius) >= 17 && !closed.text && opened.width >= 300 && opened.focused && opened.text && again.width === 34 && !again.text);

  const shapes = await page.evaluate(() => ({
    theme: getComputedStyle(document.querySelector(".topbar .theme-toggle")).borderTopLeftRadius,
    account: getComputedStyle(document.querySelector(".topbar .account-entry") || document.body).borderTopLeftRadius,
    hasAccount: Boolean(document.querySelector(".topbar .account-entry")),
  }));
  check("N8", "the theme button round, the account button a pill", shapes,
    parseFloat(shapes.theme) >= 17 && (!shapes.hasAccount || shapes.account === "999px"));

  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(300);
  const mid = await bar(page);
  await page.locator(".topbar").screenshot({ path: join(out, "barre-1000.png") });
  check("N9", "1000 px: the track after the logo, clear of the actions", { brand: mid.brand, track: mid.track, actions: mid.actions },
    mid.track.left >= mid.brand.right + 8 && mid.track.right <= mid.actions.left - 8 && mid.sideways <= 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  check("N12a", "1440 px: no sideways scroll", b.sideways, b.sideways <= 0);
  await page.context().close();

  // ------------------------------------------------------------------ computer, light
  const light = await open({ viewport: { width: 1440, height: 900 } }, "light");
  const lb = await bar(light);
  await light.locator(".topbar").screenshot({ path: join(out, "barre-1440-clair.png") });
  const lc = lb.items.find((i) => i.current);
  check("N10", "light theme: the current section night on ivory", lc, lc && lc.bg === NIGHT_LIGHT && lc.radius === "999px");
  await hover(light, "Compétitions");
  await light.screenshot({ path: join(out, "menu-competitions-1440-clair.png"), clip: { x: 0, y: 0, width: 1440, height: 420 } });
  await light.context().close();

  // ------------------------------------------------------------------ phone
  const phone = await open({ ...devices["iPhone 13"], viewport: { width: 393, height: 852 } });
  const tabs = await phone.evaluate(() => {
    const t = document.querySelector(".tabbar"), c = getComputedStyle(t);
    const items = [...t.querySelectorAll(".tabbar-item")].map((e) => {
      const s = getComputedStyle(e), label = e.querySelector("span"), lr = label?.getBoundingClientRect();
      return { name: (e.getAttribute("aria-label") || e.textContent).trim(), current: e.getAttribute("aria-current"), bg: s.backgroundColor, radius: s.borderTopLeftRadius, label: Boolean(lr && lr.width > 1 && getComputedStyle(label).visibility !== "hidden" && getComputedStyle(label).clip === "auto") };
    });
    return { radius: c.borderTopLeftRadius, height: Math.round(t.getBoundingClientRect().height), items, sideways: document.documentElement.scrollWidth - innerWidth };
  });
  await phone.screenshot({ path: join(out, "telephone.png") });
  const cur = tabs.items.find((i) => i.current);
  check("N11a", "phone: the tab bar a floating pill, the current tab filled with its label, the others an icon with a name",
    tabs, parseFloat(tabs.radius) >= tabs.height / 2 - 1 && cur && cur.bg === IVORY && cur.label &&
      tabs.items.filter((i) => !i.current).every((i) => !i.label && i.name.length > 2));
  await phone.locator(".tabbar").getByRole("button", { name: "Compétitions" }).click();
  await phone.waitForTimeout(400);
  const sheet = await phone.evaluate(() => {
    const s = document.querySelector(".nav-sheet");
    if (!s) return null;
    const label = (e) => (e.querySelector(":scope > span:last-child") || e).innerText.trim(); return { radius: getComputedStyle(s).borderTopLeftRadius, entries: [...s.querySelectorAll(".nav-menu-item")].map(label), leagues: [...s.querySelectorAll(".nav-league")].map((l) => ({ name: label(l), logo: Boolean(l.querySelector("img, .crest")) })) };
  });
  await phone.screenshot({ path: join(out, "telephone-competitions.png") });
  check("N11b", "phone: Compétitions opens a 22 px sheet with the two pages and the six league tiles", sheet,
    sheet && sheet.radius === "22px" && ["Toutes les compétitions", "Archives"].every((n) => sheet.entries.includes(n)) && sheet.leagues.length === 6 && sheet.leagues.every((l) => l.logo));
  check("N12b", "393 px: no sideways scroll", tabs.sideways, tabs.sideways <= 0);
  await phone.context().close();

  check("X1", "no page error", errors, errors.length === 0);
} catch (error) {
  check("RUN", "the run completes", error.message.split("\n")[0], false);
} finally {
  await browser.close();
  await writeFile(join(out, "evidence.json"), JSON.stringify({ base, results, errors }, null, 2));
}
if (results.some((r) => !r.ok)) process.exitCode = 1;

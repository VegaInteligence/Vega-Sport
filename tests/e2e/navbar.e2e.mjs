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
//  N7  1440 px: the search is a round 40 px icon (§ 76.2) (no field text); a click opens the field (300 px at least,
//      focused); Escape twice closes it again.
//  N8  No theme button in the header (it moved to the account's settings, § 76.2); the account button a pill.
//  N9  1000 px: the track follows the logo (no overlap with the logo nor the actions).
//  N10 Light theme: the current section is night on ivory.
//  N11 Phone (393 px): the tab bar is a floating pill; the current tab is filled; the other tabs show their icon only
//      but keep their name for a screen reader; a tap on « Compétitions » opens a sheet with 22 px corners, the two
//      pages and the six league tiles.
//  N12 No sideways scroll at 393 and 1440 px.
//  N13 (hugo, 26 Nov 2026, 15 h 13 « when i click on search icon the cors of the navabr disapear … make the corp of
//      navbar slide a bit to the left ») At 641, 760, 900, 1000, 1120, 1280 and 1440 px, a click on the search icon
//      opens the field and the track stays: fully opaque, its five sections drawn (30 px wide at least), right of the
//      logo (8 px), the field right of the track (8 px), 220 px wide at least, inside the window, focused. Where the
//      field needs the room the track slides left; where even that is not enough its sections show their symbol
//      alone (their names kept for screen readers). Escape twice puts the track back where it was (±1 px).
//  N14 (hugo, 15 h 14 « icon du user elle est carré c'est pas bon … enleve la ») The signed-in account button:
//      no square monogram. From 1024 px a quiet pill « Mon compte », the monogram not drawn; under it a 40 px round (§ 76.2)
//      (the initial, no square background).
//  N15 (hugo, 15 h 29 « search bar and search button, profil button should be same size as corps of navbar »,
//      § 76.2) At 1440 and 900 px: the track, the closed search and the account button are 40 px tall and share their
//      middle (±1 px); the search is a 40 px round; opened, the field is 40 px tall. No theme button, phone included.
//  N16 (15 h 29 « un peu trop gros les hover du corps de la navbar ») The menus are smaller: a league tile 100 × 84 px
//      at most, the Compétitions panel 540 px wide at most, a Joueurs tile 90 px tall and 136 px wide at most.
//  N17 (15 h 33, piste A of https://claude.ai/artifact/HWrnX3K1t1JY5asLRUqW7j) The account's menu: a 22 px panel with
//      no border, its formula in a pill, its links pills (999 px, 36 to 40 px tall) each with a symbol, « Se
//      déconnecter » with no line above it. (A local server has no session: AccountEntry's markup is put in.)
//  N18 (15 h 29 « add a system setting to follow the computer setting », 15 h 34 « pour non connecté on est en mode
//      system automatiquement ») Signed out, the site follows the computer: a light computer shows the light theme,
//      a dark one the dark theme, a change of the computer's setting switches the page at once, and a theme kept from
//      the old header button is forgotten (signed out the choice is the computer's).
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
async function open(options, scheme = "dark", path = "/", { stored = null } = {}) {
  const context = await browser.newContext({ locale: "fr-FR", colorScheme: scheme, ...options });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("vega.consent.v1", JSON.stringify({ measurement: false, at: "2026-11-25T12:00:00Z" })));
  // Signed out the site follows the computer (§ 76.2): the colour scheme is the theme. `stored` puts a kept choice in.
  if (stored) await page.addInitScript((value) => localStorage.setItem("statarena.theme", value), stored);
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
  check("N7", "1440 px: the search a round 40 px icon (§ 76.2); a click opens the field (300 px, focused); Escape twice closes it",
    { closed, opened, again },
    closed.width === 40 && closed.height === 40 && parseFloat(closed.radius) >= 20 && !closed.text && opened.width >= 300 && opened.focused && opened.text && again.width === 40 && !again.text);

  const shapes = await page.evaluate(() => ({
    themeButton: Boolean(document.querySelector(".topbar .theme-toggle")),
    account: getComputedStyle(document.querySelector(".topbar .account-entry") || document.body).borderTopLeftRadius,
    hasAccount: Boolean(document.querySelector(".topbar .account-entry")),
  }));
  check("N8", "no theme button in the header, the account button a pill", shapes,
    !shapes.themeButton && (!shapes.hasAccount || shapes.account === "999px"));

  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(300);
  const mid = await bar(page);
  await page.locator(".topbar").screenshot({ path: join(out, "barre-1000.png") });
  check("N9", "1000 px: the track after the logo, clear of the actions", { brand: mid.brand, track: mid.track, actions: mid.actions },
    mid.track.left >= mid.brand.right + 8 && mid.track.right <= mid.actions.left - 8 && mid.sideways <= 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  check("N12a", "1440 px: no sideways scroll", b.sideways, b.sideways <= 0);
  await page.context().close();

  // ------------------------------------------------------------------ the search opened beside the track (N13)
  const roomAt = [];
  for (const width of [641, 760, 900, 1000, 1120, 1280, 1440]) {
    const p = await open({ viewport: { width, height: 800 } });
    const place = () => p.evaluate(() => {
      const nav = document.querySelector(".topbar .main-nav"), r = nav.getBoundingClientRect();
      const f = document.querySelector(".topbar .global-search-field").getBoundingClientRect();
      const buttons = [...nav.querySelectorAll(":scope > a, :scope > .nav-menu > button")].map((b) => Math.round(b.getBoundingClientRect().width));
      return {
        nav: [Math.round(r.left), Math.round(r.right)], opacity: Number(getComputedStyle(nav).opacity), visibility: getComputedStyle(nav).visibility,
        buttons, names: [...nav.querySelectorAll(":scope > a, :scope > .nav-menu > button")].map((b) => b.textContent.trim().length > 2),
        brand: Math.round(document.querySelector(".topbar .brand").getBoundingClientRect().right),
        field: [Math.round(f.left), Math.round(f.right), Math.round(f.width)], window: innerWidth,
        focused: document.activeElement === document.querySelector(".topbar .global-search input"),
      };
    });
    const before = await place();
    await p.locator(".topbar .global-search input").click();
    await p.waitForTimeout(500);
    const during = await place();
    await p.locator(".topbar").screenshot({ path: join(out, `recherche-ouverte-${width}.png`) });
    await p.keyboard.press("Escape");
    await p.keyboard.press("Escape");
    await p.waitForTimeout(500);
    const after = await place();
    const ok = during.opacity > 0.99 && during.visibility === "visible" && during.buttons.length === 5 && during.buttons.every((w) => w >= 30) && during.names.every(Boolean) &&
      during.nav[0] >= during.brand + 8 && during.field[0] >= during.nav[1] + 8 && during.field[2] >= 220 && during.field[1] <= during.window && during.focused &&
      Math.abs(after.nav[0] - before.nav[0]) <= 1 && Math.abs(after.nav[1] - before.nav[1]) <= 1 && after.field[2] === 40;
    roomAt.push({ width, ok, before: before.nav, during: { nav: during.nav, field: during.field, buttons: during.buttons, opacity: during.opacity }, after: after.nav });
    await p.context().close();
  }
  check("N13", "the search opened: the track stays whole and opaque, slides left (or shows its symbols) to leave the field 220 px at least; back in place after Escape",
    roomAt.map(({ ok, ...rest }) => ({ ok, ...rest })), roomAt.every((r) => r.ok));

  // ------------------------------------------------------------------ the signed-in account button (N14)
  const signed = [];
  for (const width of [1440, 900]) {
    const p = await open({ viewport: { width, height: 800 } });
    // A local server has no session: the signed-in button's markup (AccountEntry.jsx) is put in the header as is.
    const look = await p.evaluate(() => {
      const actions = document.querySelector(".topbar .topbar-actions");
      const root = document.createElement("div");
      root.className = "account-menu-root";
      root.innerHTML = '<button type="button" class="account-entry account-entry-in" aria-label="Mon compte"><span class="account-entry-monogram" aria-hidden="true">H</span><span class="account-entry-label">Mon compte</span></button>';
      (actions.querySelector(".account-entry")?.closest(".account-menu-root, .account-entry") || actions.lastElementChild).replaceWith(root);
      const b = root.querySelector("button"), m = root.querySelector(".account-entry-monogram"), r = b.getBoundingClientRect(), cm = getComputedStyle(m), cb = getComputedStyle(b);
      return {
        width: Math.round(r.width), height: Math.round(r.height), radius: cb.borderTopLeftRadius, bg: cb.backgroundColor,
        monogram: { display: cm.display, width: Math.round(m.getBoundingClientRect().width), bg: cm.backgroundColor, radius: cm.borderTopLeftRadius },
        label: root.querySelector(".account-entry-label").getBoundingClientRect().width > 20,
      };
    });
    await p.locator(".topbar").screenshot({ path: join(out, `compte-connecte-${width}.png`) });
    signed.push({ width, ...look });
    await p.context().close();
  }
  const [wideAccount, narrowAccount] = signed;
  check("N14", "signed in: no square monogram; a pill « Mon compte » from 1024 px, a 40 px round with the initial under it (§ 76.2)", signed,
    wideAccount.radius === "999px" && wideAccount.monogram.display === "none" && wideAccount.label &&
      narrowAccount.width === 40 && parseFloat(narrowAccount.radius) >= 20 && narrowAccount.monogram.display !== "none" &&
      (narrowAccount.monogram.bg === "rgba(0, 0, 0, 0)" || parseFloat(narrowAccount.monogram.radius) >= narrowAccount.monogram.width / 2 - 1));

  // ------------------------------------------------------------------ heights (N15)
  const heights = [];
  for (const width of [1440, 900]) {
    const p = await open({ viewport: { width, height: 800 } });
    const read = () => p.evaluate(() => {
      const box = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), mid: Math.round(r.top + r.height / 2) }; };
      return { track: box(".topbar .main-nav"), search: box(".topbar .global-search-field"), account: box(".topbar .account-entry"), theme: Boolean(document.querySelector(".topbar .theme-toggle")), radius: getComputedStyle(document.querySelector(".topbar .global-search-field")).borderTopLeftRadius };
    });
    const closedLook = await read();
    await p.locator(".topbar .global-search input").click();
    await p.waitForTimeout(450);
    const openLook = await read();
    await p.locator(".topbar").screenshot({ path: join(out, `hauteurs-${width}.png`) });
    heights.push({ width, closed: closedLook, open: openLook.search });
    await p.context().close();
  }
  const phoneBar = await open({ ...devices["iPhone 13"], viewport: { width: 393, height: 852 } });
  const phoneTheme = await phoneBar.evaluate(() => Boolean(document.querySelector(".topbar .theme-toggle")));
  await phoneBar.context().close();
  check("N15", "the track, the search and the account 40 px tall on one middle; the search a 40 px round, 40 px open; no theme button (phone too)",
    { heights, phoneTheme },
    !phoneTheme && heights.every(({ closed: c, open: o }) => c.track.h === 40 && c.search.h === 40 && c.search.w === 40 && parseFloat(c.radius) >= 20 &&
      (!c.account || (c.account.h === 40 && Math.abs(c.account.mid - c.track.mid) <= 1)) && Math.abs(c.search.mid - c.track.mid) <= 1 && !c.theme && o.h === 40));

  // ------------------------------------------------------------------ smaller menus (N16)
  {
    const p = await open({ viewport: { width: 1440, height: 900 } });
    await hover(p, "Compétitions");
    const comp = await p.evaluate(() => {
      const panel = document.querySelector(".topbar .nav-panel.is-open"), tile = panel?.querySelector(".nav-league");
      return panel && tile ? { panel: Math.round(panel.getBoundingClientRect().width), tile: [Math.round(tile.getBoundingClientRect().width), Math.round(tile.getBoundingClientRect().height)] } : null;
    });
    await p.screenshot({ path: join(out, "menu-competitions-petit.png"), clip: { x: 0, y: 0, width: 1440, height: 360 } });
    await hover(p, "Joueurs");
    await p.waitForTimeout(300);
    const players = await p.evaluate(() => {
      const tile = document.querySelector(".topbar .nav-panel.is-open .nav-tile");
      return tile ? [Math.round(tile.getBoundingClientRect().width), Math.round(tile.getBoundingClientRect().height)] : null;
    });
    await p.screenshot({ path: join(out, "menu-joueurs-petit.png"), clip: { x: 0, y: 0, width: 1440, height: 300 } });
    await p.context().close();
    check("N16", "smaller menus: league tiles 100 × 84 at most, the Compétitions panel 540 px at most, Joueurs tiles 136 × 90 at most", { comp, players },
      comp && comp.tile[0] <= 100 && comp.tile[1] <= 84 && comp.panel <= 540 && players && players[0] <= 136 && players[1] <= 90);
  }

  // ------------------------------------------------------------------ the account's menu (N17)
  {
    const p = await open({ viewport: { width: 1440, height: 900 } });
    const menu = await p.evaluate(() => {
      const actions = document.querySelector(".topbar .topbar-actions");
      const root = document.createElement("div");
      root.className = "account-menu-root";
      const icon = '<svg class="account-menu-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"></svg>';
      root.innerHTML = `<button type="button" class="account-entry account-entry-in" aria-label="Mon compte" aria-expanded="true"><span class="account-entry-monogram" aria-hidden="true">P</span><span class="account-entry-label">Mon compte</span></button>
        <div class="account-menu"><p class="account-menu-who"><span class="account-menu-address">prenom@exemple.fr</span><span class="account-menu-plan">Gratuit</span></p>
        <nav class="account-menu-links" aria-label="Mon compte"><a href="/compte">${icon}Mon compte</a><a href="/compte#parametres">${icon}Paramètres</a></nav>
        <div class="account-menu-foot"><button class="account-menu-out" type="button">${icon}Se déconnecter</button></div></div>`;
      (actions.querySelector(".account-entry")?.closest(".account-menu-root, .account-entry") || actions.lastElementChild).replaceWith(root);
      const c = (s) => getComputedStyle(root.querySelector(s));
      const links = [...root.querySelectorAll(".account-menu-links a")].map((a) => ({ radius: getComputedStyle(a).borderTopLeftRadius, h: Math.round(a.getBoundingClientRect().height) }));
      return { radius: c(".account-menu").borderTopLeftRadius, border: c(".account-menu").borderTopWidth, plan: c(".account-menu-plan").borderTopLeftRadius, links, footLine: c(".account-menu-foot").borderTopWidth, whoLine: c(".account-menu-who").borderBottomWidth };
    });
    await p.screenshot({ path: join(out, "menu-compte.png"), clip: { x: 1040, y: 0, width: 400, height: 320 } });
    await p.context().close();
    check("N17", "the account's menu: 22 px panel without border, formula in a pill, links pills 36–40 px, no lines", menu,
      menu.radius === "22px" && menu.border === "0px" && parseFloat(menu.plan) >= 9 && menu.links.every((l) => l.radius === "999px" && l.h >= 36 && l.h <= 40) && menu.footLine === "0px" && menu.whoLine === "0px");
  }

  // ------------------------------------------------------------------ the computer's theme (N18)
  {
    const lightComputer = await open({ viewport: { width: 1280, height: 800 } }, "light");
    const shownLight = await lightComputer.evaluate(() => document.documentElement.dataset.theme);
    await lightComputer.emulateMedia({ colorScheme: "dark" });
    await lightComputer.waitForTimeout(300);
    const switched = await lightComputer.evaluate(() => document.documentElement.dataset.theme);
    await lightComputer.context().close();
    const darkComputer = await open({ viewport: { width: 1280, height: 800 } }, "dark");
    const shownDark = await darkComputer.evaluate(() => document.documentElement.dataset.theme);
    await darkComputer.context().close();
    // A theme kept by the old header button, signed out: forgotten, the computer's shown.
    const kept = await open({ viewport: { width: 1280, height: 800 } }, "light", "/", { stored: "dark" });
    await kept.waitForTimeout(1500);
    const keptShown = await kept.evaluate(() => ({ theme: document.documentElement.dataset.theme, stored: localStorage.getItem("statarena.theme"), status: document.querySelector(".topbar .account-entry-out") ? "signed-out" : document.querySelector(".topbar .account-entry") ? "other" : "off" }));
    await kept.context().close();
    check("N18", "signed out the site follows the computer: light shows light, dark shows dark, a change switches at once, an old kept theme is forgotten",
      { shownLight, switched, shownDark, keptShown },
      shownLight === "light" && switched === "dark" && shownDark === "dark" && keptShown.theme === "light" && keptShown.stored === null);
  }

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

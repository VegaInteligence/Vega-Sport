// E2E — the home page's buttons and menus (« Vue d'ensemble »), FAILURE_MODES § 77: the settings bar of piste B
// without the country, the week's results of piste A, the page's pills, the « i » and the windows
// (mock-up https://claude.ai/artifact/DPfYC6jW2ooKwPGzmaGsdD; hugo, 26 Nov 2026, 16 h 17). Written before the
// implementation.
//
// Failure modes and expected outcomes (the home page, dark theme, 1440 px unless said):
//  H1  The bar: one track (999 px corners, 40 px tall ±1) in the week's row, holding two segments, the season
//      (« 2026/2027 ») and the competitions (« Top 7 Europe + UEFA »). No season select, no « Filtrer » button, no
//      country anywhere in the toolbar.
//  H2  A click on the season opens one panel under the track: 22 px corners, no border, its right edge on the
//      track's (±2 px), below it; the segment is expanded and filled ivory; the seasons are pills (999 px), the
//      current one pressed and filled.
//  H3  A click on the competitions keeps the same panel element (it slides) and shows the presets « Toutes » and
//      « Top 7 Europe + UEFA » (the latter pressed), a search field, ten tiles at least each with a logo, no « Votre
//      pays » nor country menu; the pressed tiles are as many as the count says.
//  H4  A tile not chosen, clicked, is pressed and the count grows by one; « Annuler » closes the panel and the
//      segment still says « Top 7 Europe + UEFA »; opened again, that tile is not pressed.
//  H5  « Toutes » then « Appliquer »: the panel closes, the segment says « Toutes les compétitions », the stored
//      preferences hold no league (orion.preferences.v1 favoriteLeagueIds = []).
//  H6  The search « liga » leaves only tiles whose name or country holds it (LaLiga among them).
//  H7  A season chosen in the panel: the panel closes, the segment names that season.
//  H8  Escape closes the panel and gives the focus back to its segment; a click outside closes it.
//  H9  The week's results: no line above the strip; each match a card with 22 px corners and no right border; the
//      day a vertical pill (999 px).
//  H10 The pills: the cards' links 32 px tall with 999 px corners; « Analyse complète du match » a filled pill
//      (ivory); « Course au titre »'s leagues in a 999 px track with no line under it, the chosen one ivory;
//      « Efficaces » (pressed) ivory in a 999 px track.
//  H11 The « i »: no border; its bubble 22 px corners, no border.
//  H12 A player opened from « Ils ont aussi brillé »: the window has 22 px corners, its close button is round.
//  H13 The country menu (the account's settings, HomeCountryMenu, regression of f2d62a6): its markup put in the page,
//      the menu floats (absolute), 22 px corners, and the picker's height does not grow when it opens.
//  H14 Phone (390 × 844): the track spans the toolbar (±2 px); the competitions open a sheet (fixed, its bottom on
//      the screen's, 22 px top corners) over a veil; the folds are 40 px pills; no sideways scroll.
//  H15 The search clicked (§ 77.1, hugo's capture of 26 Nov): the field inside the pill stays transparent and without
//      a border, and the pill has no ring, so the pill lights up whole rather than in two halves.
//  H16 « Ils ont aussi brillé » (§ 80, piste B): one card, 22 px corners, no border, a ranked list in two columns,
//      rows without lines, grades as pills (green from 70), no « 0 but » or « 0 passe ».
//  H17 Phone: one column, five rows shown, the rest behind a 40 px « Voir les N joueurs » pill that opens them.
//  X1  No page error.
//
//   node tests/e2e/home-buttons.e2e.mjs <base url> <evidence dir>
// Against a `next build` + `next start` of the site reading the public API, or a recorded replay of it
// (NEXT_PUBLIC_API_ORIGIN at build time). Writes evidence.json and screenshots into the evidence dir; exit code 1
// when a check fails.
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const { chromium, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const [base = "http://127.0.0.1:3000", out = "/tmp/home-buttons-e2e"] = process.argv.slice(2);
await mkdir(out, { recursive: true });

const results = [];
const errors = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${expected} — ${JSON.stringify(actual)}`);
};
const IVORY = "rgb(244, 241, 234)";
const near = (a, b, d = 2) => Math.abs(a - b) <= d;
const round = (v) => v === "999px" || parseFloat(v) >= 100;

const browser = await chromium.launch();
async function open(options = { viewport: { width: 1440, height: 900 } }) {
  const context = await browser.newContext({ locale: "fr-FR", colorScheme: "dark", ...options });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("vega.consent.v1", JSON.stringify({ measurement: false, at: "2026-11-25T12:00:00Z" })));
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
  await page.goto(base + "/", { waitUntil: "load", timeout: 120000 });
  await page.waitForSelector(".home-page .home-bento", { timeout: 90000 });
  await page.waitForTimeout(800);
  return { context, page };
}
const shot = (page, name) => page.screenshot({ path: join(out, name + ".png") });
const track = (page) => page.locator(".home-toolbar .home-settings");
const segment = (page, key) => page.locator(`.home-settings-segment[data-key="${key}"]`);
const panel = (page) => page.locator(".home-settings-panel");

async function run(id, fn) {
  try {
    await fn();
  } catch (error) {
    check(id, "ran", String(error.message).split("\n")[0], false);
  }
}

// ---------- desktop ----------
{
  const { context, page } = await open();

  await run("H1", async () => {
    const t = track(page);
    const box = await t.boundingBox();
    const style = await t.evaluate((n) => ({ radius: getComputedStyle(n).borderTopLeftRadius }));
    const texts = await page.locator(".home-settings-segment").allTextContents();
    const toolbar = await page.locator(".home-toolbar").evaluate((n) => ({
      select: n.querySelectorAll("select").length,
      filter: n.querySelectorAll("#home-competition-filter, .home-filter-button").length,
      country: n.querySelectorAll("#home-country-filter, .home-country-picker").length + (/pays/i.test(n.textContent) ? 1 : 0),
    }));
    check("H1 the bar: one 40 px track, season and competitions, no select, no country", "40 px, 999 px, 2 segments", { h: box?.height, ...style, texts, ...toolbar },
      box && near(box.height, 40, 1) && round(style.radius) && texts.length === 2 && /2026\/2027/.test(texts[0]) && /Top 7 Europe \+ UEFA/.test(texts[1]) &&
        toolbar.select === 0 && toolbar.filter === 0 && toolbar.country === 0);
  });

  await run("H2", async () => {
    await segment(page, "season").click();
    await panel(page).waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(350);
    const p = await panel(page).evaluate((n) => { const s = getComputedStyle(n), r = n.getBoundingClientRect(); return { radius: s.borderTopLeftRadius, border: s.borderTopWidth, right: r.right, top: r.top }; });
    const t = await track(page).boundingBox();
    const seg = await segment(page, "season").evaluate((n) => ({ expanded: n.getAttribute("aria-expanded"), bg: getComputedStyle(n).backgroundColor }));
    const pills = await page.locator(".home-settings-season").evaluateAll((ns) => ns.map((n) => ({ text: n.textContent.trim(), pressed: n.getAttribute("aria-pressed"), radius: getComputedStyle(n).borderTopLeftRadius, bg: getComputedStyle(n).backgroundColor })));
    const current = pills.filter((x) => x.pressed === "true");
    await shot(page, "h2-saison");
    check("H2 the season's panel: 22 px, under the track, its right edge; the segment filled; seasons as pills", "22 px, filled, current pressed",
      { ...p, trackRight: t.right, trackBottom: t.y + t.height, seg, pills: pills.length, current },
      p.radius === "22px" && parseFloat(p.border) === 0 && near(p.right, t.x + t.width) && p.top >= t.y + t.height && seg.expanded === "true" && seg.bg === IVORY &&
        pills.length >= 2 && pills.every((x) => round(x.radius)) && current.length === 1 && current[0].text === "2026/2027" && current[0].bg === IVORY);
  });

  await run("H3", async () => {
    await panel(page).evaluate((n) => (n.dataset.same = "1"));
    await segment(page, "competitions").click();
    await page.waitForTimeout(450);
    const same = await panel(page).evaluate((n) => n.dataset.same === "1");
    const presets = await page.locator(".home-settings-presets button").evaluateAll((ns) => ns.map((n) => [n.textContent.trim(), n.getAttribute("aria-pressed")]));
    const tiles = await page.locator(".home-settings-tile").evaluateAll((ns) => ns.map((n) => ({ pressed: n.getAttribute("aria-pressed") === "true", logo: !!n.querySelector("img, .media-initials, [data-media-kind]") })));
    const count = (await page.locator(".home-settings-count").textContent()).trim();
    const country = await panel(page).evaluate((n) => n.querySelectorAll("#home-country-filter, .home-country-picker").length + (/Votre pays/.test(n.textContent) ? 1 : 0));
    const search = await panel(page).locator('input[type="search"]').count();
    await shot(page, "h3-competitions");
    const chosen = tiles.filter((x) => x.pressed).length;
    check("H3 the same panel slides to the competitions: presets, search, tiles with logos, no country", "same panel, Top 7 pressed, count = pressed tiles",
      { same, presets, tiles: tiles.length, chosen, count, country, search },
      same && presets.length === 2 && presets[0][0] === "Toutes" && presets[1][0] === "Top 7 Europe + UEFA" && presets[1][1] === "true" &&
        tiles.length >= 10 && tiles.every((x) => x.logo) && search === 1 && country === 0 && chosen > 0 && count.startsWith(String(chosen) + " "));
  });

  await run("H6", async () => {
    await panel(page).locator('input[type="search"]').fill("liga");
    await page.waitForTimeout(250);
    const shown = await page.locator(".home-settings-tile:visible").allTextContents();
    await panel(page).locator('input[type="search"]').fill("");
    check("H6 the search « liga »", "LaLiga among the tiles left, fewer than all", shown, shown.length > 0 && shown.length < 20 && shown.some((s) => /LaLiga/.test(s)));
  });

  await run("H15", async () => {
    const field = panel(page).locator('input[type="search"]');
    await field.click();
    await page.waitForTimeout(250);
    const d = await field.evaluate((n) => {
      const pill = n.closest(".home-settings-search");
      const a = getComputedStyle(n), b = getComputedStyle(pill);
      return { field: a.backgroundColor, border: a.borderTopWidth, outline: a.outlineStyle, ring: b.boxShadow, pill: b.backgroundColor };
    });
    await shot(page, "h15-search-focused");
    await field.blur();
    check("H15 the search clicked: one pill, the field transparent, no ring", "transparent, 0 px, none, none", d,
      d.field === "rgba(0, 0, 0, 0)" && d.border === "0px" && d.outline === "none" && d.ring === "none" && d.pill !== "rgba(0, 0, 0, 0)");
  });

  await run("H4", async () => {
    const free = page.locator('.home-settings-tile[aria-pressed="false"]').first();
    const name = (await free.textContent()).trim();
    const before = parseInt(await page.locator(".home-settings-count").textContent(), 10);
    await free.click();
    const pressed = await page.locator(".home-settings-tile").filter({ hasText: name }).first().getAttribute("aria-pressed");
    const after = parseInt(await page.locator(".home-settings-count").textContent(), 10);
    await panel(page).getByRole("button", { name: "Annuler" }).click();
    await page.waitForTimeout(300);
    const closed = (await panel(page).count()) === 0 || !(await panel(page).isVisible());
    const label = (await segment(page, "competitions").textContent()).trim();
    await segment(page, "competitions").click();
    await page.waitForTimeout(350);
    const again = await page.locator(".home-settings-tile").filter({ hasText: name }).first().getAttribute("aria-pressed");
    check("H4 a tile pressed then « Annuler »: nothing kept", "pressed, +1, closed, same label, not pressed again", { name, pressed, before, after, closed, label, again },
      pressed === "true" && after === before + 1 && closed && /Top 7 Europe \+ UEFA/.test(label) && again === "false");
  });

  await run("H8", async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    const closed = (await panel(page).count()) === 0 || !(await panel(page).isVisible());
    const focus = await page.evaluate(() => document.activeElement?.dataset?.key || document.activeElement?.className);
    await segment(page, "season").click();
    await page.waitForTimeout(300);
    await page.mouse.click(200, 700);
    await page.waitForTimeout(300);
    const outside = (await panel(page).count()) === 0 || !(await panel(page).isVisible());
    check("H8 Escape closes and gives the focus back; a click outside closes", "closed, focus on competitions, closed", { closed, focus, outside },
      closed && focus === "competitions" && outside);
  });

  await run("H9", async () => {
    const strip = await page.locator(".home-ticker").evaluate((n) => getComputedStyle(n).borderTopWidth);
    const ticks = await page.locator(".home-tick").evaluateAll((ns) => ns.slice(0, 4).map((n) => ({ radius: getComputedStyle(n).borderTopLeftRadius, right: getComputedStyle(n).borderRightWidth })));
    const day = await page.locator(".home-ticker-day").first().evaluate((n) => getComputedStyle(n).borderTopLeftRadius);
    await page.locator(".home-ticker").screenshot({ path: join(out, "h9-resultats.png") });
    check("H9 the week's results: one 22 px card per match, no lines, the day a pill", "0 px line, 22 px, 0 px, 999 px", { strip, ticks, day },
      parseFloat(strip) === 0 && ticks.length > 0 && ticks.every((x) => x.radius === "22px" && parseFloat(x.right) === 0) && round(day));
  });

  await run("H10", async () => {
    const links = await page.locator(".home-page .home-card-head .inline-link, .home-page .home-section-head .inline-link").evaluateAll((ns) => ns.map((n) => ({ h: Math.round(n.getBoundingClientRect().height), radius: getComputedStyle(n).borderTopLeftRadius })));
    const primary = await page.locator(".home-page .button-primary").first().evaluate((n) => ({ radius: getComputedStyle(n).borderTopLeftRadius, bg: getComputedStyle(n).backgroundColor }));
    const tabs = await page.locator(".home-tabs").first().evaluate((n) => ({ radius: getComputedStyle(n).borderTopLeftRadius, line: getComputedStyle(n).borderBottomWidth, on: getComputedStyle(n.querySelector('[aria-pressed="true"]')).backgroundColor }));
    const seg = await page.locator(".home-page .segmented-control").first().evaluate((n) => ({ radius: getComputedStyle(n).borderTopLeftRadius, on: getComputedStyle(n.querySelector('[aria-pressed="true"]')).backgroundColor }));
    await page.locator(".home-race").screenshot({ path: join(out, "h10-course.png") });
    check("H10 links 32 px pills, the main action filled, the leagues and the switches in tracks", "32 px 999, ivory", { links, primary, tabs, seg },
      links.length >= 2 && links.every((x) => x.h === 32 && round(x.radius)) && round(primary.radius) && primary.bg === IVORY &&
        round(tabs.radius) && parseFloat(tabs.line) === 0 && tabs.on === IVORY && round(seg.radius) && seg.on === IVORY);
  });

  await run("H11", async () => {
    const hint = page.locator(".home-potw .hint").first();
    const border = await hint.evaluate((n) => getComputedStyle(n).borderTopWidth);
    await hint.hover();
    await page.locator(".hint-bubble").waitFor({ timeout: 4000 });
    const bubble = await page.locator(".hint-bubble").evaluate((n) => ({ radius: getComputedStyle(n).borderTopLeftRadius, border: getComputedStyle(n).borderTopWidth }));
    check("H11 the « i » without border, its bubble 22 px without border", "0, 22 px, 0", { border, bubble },
      parseFloat(border) === 0 && bubble.radius === "22px" && parseFloat(bubble.border) === 0);
    await page.mouse.move(10, 10);
  });

  await run("H16", async () => {
    const section = page.locator("section[aria-labelledby=home-also]");
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const d = await section.evaluate((n) => {
      const card = n.querySelector(".home-list-card"), cs = card && getComputedStyle(card);
      const rows = [...n.querySelectorAll(".home-list-row")];
      const lefts = new Set(rows.map((r) => Math.round(r.getBoundingClientRect().left)));
      const grades = [...n.querySelectorAll(".home-grade")].map((g) => ({ v: Number(g.textContent), radius: getComputedStyle(g).borderTopLeftRadius, bg: getComputedStyle(g).backgroundColor, high: g.hasAttribute("data-high") }));
      return {
        cards: n.querySelectorAll(".home-list-card").length, rail: n.querySelectorAll(".home-rail, .home-rail-card").length,
        radius: cs?.borderTopLeftRadius, border: cs?.borderTopWidth,
        rows: rows.length, columns: lefts.size, rowBorder: rows.map((r) => getComputedStyle(r).borderTopWidth).find((w) => w !== "0px") || "0px",
        ranks: [...n.querySelectorAll(".home-list-rank")].map((r) => r.textContent).join(","),
        grades, zero: /(^|\D)0 but|(^|\D)0 passe/.test(n.textContent),
      };
    });
    await section.screenshot({ path: join(out, "h16-ils-ont-aussi-brille.png") });
    const greenOk = d.grades.every((g) => g.high === Number(g.v) >= 70) && d.grades.filter((g) => g.high).every((g) => g.bg === "rgb(52, 211, 153)");
    check("H16 « Ils ont aussi brillé »: one 22 px card, ranked list in two columns, grade pills, no zero", "1 card, 22 px, 0 border, 2 columns, pills",
      { ...d, grades: d.grades.map((g) => `${g.v}${g.high ? "+" : ""}`).join(" ") },
      d.cards === 1 && d.rail === 0 && d.radius === "22px" && d.border === "0px" && d.rows >= 2 && d.columns === 2 && d.rowBorder === "0px" &&
        d.ranks.startsWith("1,2") && d.grades.length === d.rows && d.grades.every((g) => round(g.radius)) && greenOk && !d.zero);
  });

  await run("H12", async () => {
    await page.locator("section[aria-labelledby=home-also] .home-list-row").first().click();
    const dialog = page.locator("dialog[open]");
    await dialog.waitFor({ timeout: 8000 });
    await page.waitForTimeout(300);
    const d = await dialog.evaluate((n) => {
      const close = n.querySelector('.modal-header button, button[aria-label*="Fermer"]');
      return { radius: getComputedStyle(n).borderTopLeftRadius, close: close ? getComputedStyle(close).borderTopLeftRadius : null };
    });
    await shot(page, "h12-fenetre");
    await page.keyboard.press("Escape");
    check("H12 a player's window: 22 px, round close", "22 px, round", d, d.radius === "22px" && d.close && (round(d.close) || d.close === "50%"));
  });

  await run("H13", async () => {
    const m = await page.evaluate(() => {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:40px;top:120px;width:320px;z-index:5";
      host.innerHTML = '<div class="account-country"><div class="home-country-picker"><button type="button" class="filter-input-wrap home-country-button" aria-expanded="true"><span>France</span></button></div></div>';
      document.body.appendChild(host);
      const picker = host.querySelector(".home-country-picker");
      const closed = picker.getBoundingClientRect().height;
      picker.insertAdjacentHTML("beforeend", '<div class="nav-menu-panel home-country-menu" role="menu" aria-label="Pays"><div class="nav-menu-list">' +
        ["Allemagne", "Angleterre", "Brésil", "France"].map((c) => `<button type="button" role="menuitemradio" class="nav-menu-item"><span>${c}</span></button>`).join("") + "</div></div>");
      const menu = picker.querySelector(".home-country-menu"), s = getComputedStyle(menu);
      const r = { position: s.position, radius: s.borderTopLeftRadius, closed, open: picker.getBoundingClientRect().height, bg: s.backgroundColor };
      host.remove();
      return r;
    });
    check("H13 the settings' country menu floats with 22 px corners and does not push", "absolute, 22 px, same height", m,
      m.position === "absolute" && m.radius === "22px" && near(m.closed, m.open, 1) && m.bg !== "rgba(0, 0, 0, 0)");
  });

  await run("H5", async () => {
    await segment(page, "competitions").click();
    await page.waitForTimeout(350);
    await page.locator(".home-settings-presets button", { hasText: "Toutes" }).click();
    await panel(page).getByRole("button", { name: "Appliquer" }).click();
    await page.waitForTimeout(1500);
    const closed = (await panel(page).count()) === 0 || !(await panel(page).isVisible());
    const label = (await segment(page, "competitions").textContent()).trim();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("orion.preferences.v1") || "{}").favoriteLeagueIds);
    check("H5 « Toutes » applied", "closed, « Toutes les compétitions », []", { closed, label, stored },
      closed && /Toutes les compétitions/.test(label) && Array.isArray(stored) && stored.length === 0);
  });

  await run("H7", async () => {
    await segment(page, "season").click();
    await page.waitForTimeout(350);
    const other = page.locator('.home-settings-season[aria-pressed="false"]').first();
    const season = (await other.textContent()).trim();
    await other.click();
    await page.waitForTimeout(1200);
    const closed = (await panel(page).count()) === 0 || !(await panel(page).isVisible());
    const label = (await segment(page, "season").textContent()).trim();
    check("H7 a season chosen: the panel closes, the segment names it", season, { closed, label }, closed && label.includes(season));
  });

  await context.close();
}

// ---------- phone ----------
{
  const { context, page } = await open({ ...devices["iPhone 14"] });
  await run("H14", async () => {
    const t = await track(page).boundingBox();
    const bar = await page.locator(".home-toolbar").boundingBox();
    const fold = await page.locator(".home-page .phone-fold-toggle").first().evaluate((n) => ({ h: Math.round(n.getBoundingClientRect().height), radius: getComputedStyle(n).borderTopLeftRadius }));
    await segment(page, "competitions").click();
    await page.waitForTimeout(450);
    const sheet = await panel(page).evaluate((n) => { const s = getComputedStyle(n), r = n.getBoundingClientRect(); return { position: s.position, bottom: Math.round(r.bottom), radius: s.borderTopLeftRadius, low: s.borderBottomLeftRadius }; });
    const veil = await page.locator(".home-settings-veil").count();
    const vh = await page.evaluate(() => innerHeight);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await shot(page, "h14-telephone-competitions");
    check("H14 phone: the track spans the row; a sheet from the bottom over a veil; folds 40 px pills; no sideways scroll", "full width, fixed sheet, 22 px top",
      { track: t?.width, toolbar: bar?.width, fold, sheet, vh, veil, overflow },
      near(t.width, bar.width) && fold.h === 40 && round(fold.radius) && sheet.position === "fixed" && near(sheet.bottom, vh, 1) && sheet.radius === "22px" &&
        parseFloat(sheet.low) === 0 && veil === 1 && overflow <= 0);
  });

  await run("H17", async () => {
    await page.keyboard.press("Escape");
    const section = page.locator("section[aria-labelledby=home-also]");
    await section.scrollIntoViewIfNeeded();
    const count = await section.locator(".home-list-row").count();
    const visible = () => section.locator(".home-list-row:visible").count();
    const before = await visible();
    const toggle = section.locator(".phone-fold-toggle");
    const t = await toggle.evaluate((n) => ({ text: n.textContent.trim(), h: Math.round(n.getBoundingClientRect().height), radius: getComputedStyle(n).borderTopLeftRadius }));
    const columns = await section.evaluate((n) => new Set([...n.querySelectorAll(".home-list-row")].slice(0, 2).map((r) => Math.round(r.getBoundingClientRect().left))).size);
    await shot(page, "h17-telephone-ils-ont-aussi-brille");
    await toggle.click();
    await page.waitForTimeout(250);
    const after = await visible();
    check("H17 phone: one column, five rows, a 40 px pill opens the rest", { before: 5, after: count, text: `Voir les ${count} joueurs` }, { count, before, after, columns, toggle: t },
      count > 5 && before === 5 && after === count && columns === 1 && t.text === `Voir les ${count} joueurs` && t.h === 40 && round(t.radius));
  });
  await context.close();
}

check("X1 no page error", "none", errors, errors.length === 0);
await browser.close();
await writeFile(join(out, "evidence.json"), JSON.stringify({ base, run: new Date().toISOString(), command: `node tests/e2e/home-buttons.e2e.mjs ${base} ${out}`, results, errors }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

// E2E — the competition page and the archives, FAILURE_MODES § 80: piste B of the mock-up
// https://claude.ai/artifact/8DpjahVVH1hHCaZ7oviEHW (hugo, 27 Nov 2026, 16 h 24 « c'est super »), with the standings'
// card as tall as the column beside it and the seasons by decade from nine on (version A, hugo 16 h 38).
//
// Failure modes and expected outcomes (dark theme, 1440 px unless said):
//  C1  /competitions/?id=l_3FJFUl: the page's title is the competition (h1 « Ligue 1 » with its logo), no row of ten
//      cards, no « Toutes les compétitions » button; on its right one track 40 px tall (±1) with the season, the
//      competition (« Ligue 1 ») and « Archives » (a link to /archives/).
//  C2  The views (Classement, Matchs…) under the title, out of the card, in a 999 px track; the chosen one ivory.
//  C3  The standings' card ends where the column beside it ends (±2 px): no gap under the table.
//  C4  The season opens a panel: Ligue 1 has more than eight seasons, so they come under « Années 2020 »,
//      « Années 2010 »…, three a row; the list scrolls inside at most 360 px and shows the chosen season.
//  C5  The competition opens the home's panel: « À la une » (pressed) and « Toutes », ten tiles, Ligue 1 pressed;
//      « Toutes » shows the countries' titles; the search « liga » keeps LaLiga; a tile (Premier League) opens its page.
//  C6  /archives/: the title « Archives » with the season and competition in one track and the search in a pill;
//      the matches in blocks by day (22 px), one line each, no table; the score a 999 px pill.
//  C7  An archived match: a home goal's scorer left of the minute, an away goal's right of it.
//  C8  Phone (390 × 844): no sideways scroll on either page; the competition's bar spans the width (±2), no word of
//      it cut (« 2026/2027 », « Ligue 1 », « Archives » whole); the season
//      opens a sheet whose bottom is the screen's.
//  C4b The archives' seasons (back to the 19th century): by decade, the list scrolls inside 360 px.
//  C9  Eight seasons or fewer keep the plain pills (the home's season: no decade titles).
//  X1  No page error.
//
//   node tests/e2e/competitions-archives.e2e.mjs <base url> <evidence dir> [replay origin]
// Against a `next build` + `next start` of the site reading the public API, or a recorded replay of it
// (NEXT_PUBLIC_API_ORIGIN at build time; with a replay origin, the requests the app sends to the API's own origin
// are answered by it too). Writes evidence.json and screenshots; exit code 1 when a check fails.
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const { chromium, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const [base = "http://127.0.0.1:3000", out = "/tmp/competitions-archives-e2e", replay] = process.argv.slice(2);
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
async function open(path, options = {}) {
  const context = await browser.newContext({ colorScheme: "dark", viewport: { width: 1440, height: 900 }, ...options });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("vega.consent.v1", JSON.stringify({ measurement: false, at: "2026-11-27T12:00:00Z" }));
    } catch {}
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${path}: ${error.message}`));
  if (replay)
    await page.route("https://dngp6kh9jx2bl.cloudfront.net/**", async (route) => {
      const url = route.request().url().replace("https://dngp6kh9jx2bl.cloudfront.net", replay);
      try {
        const response = await fetch(url);
        await route.fulfill({
          status: response.status,
          headers: { "content-type": response.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" },
          body: Buffer.from(await response.arrayBuffer()),
        });
      } catch {
        await route.abort();
      }
    });
  await page.goto(base + path, { waitUntil: "load", timeout: 120000 });
  return { context, page };
}
// A part that cannot go on (an element that never comes, as on a page without the change) fails, the others still run.
async function run(name, part) {
  try {
    await part();
  } catch (error) {
    check(`${name} stopped`, "the part runs to its end", String(error.message).split("\n")[0], false);
  }
}
const hideConsent = (page) => page.evaluate(() => document.querySelectorAll(".consent-live, .consent").forEach((n) => n.remove()));

// ------------------------------------------------------------------ the competition page, computer
await run("competition page", async () => {
  const { context, page } = await open("/competitions/?id=l_3FJFUl");
  await page.locator(".edition-head--page h1.edition-name").waitFor({ timeout: 90000 });
  await page.locator(".competition-highlights").first().waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await hideConsent(page);
  const head = await page.evaluate(() => {
    const h = document.querySelector(".edition-head--page");
    const bar = h?.querySelector(".edition-bar");
    const r = bar?.getBoundingClientRect();
    return {
      title: h?.querySelector("h1.edition-name")?.textContent.trim(),
      logo: Boolean(h?.querySelector(".edition-title .edition-logo")),
      cards: document.querySelectorAll(".league-spotlight-item").length,
      allButton: [...document.querySelectorAll("#main button, #main a")].some((n) => /Toutes les compétitions/.test(n.textContent)),
      barHeight: r ? Math.round(r.height) : null,
      barRadius: bar && getComputedStyle(bar).borderTopLeftRadius,
      items: bar ? [...bar.querySelectorAll(".home-settings-segment")].map((n) => n.textContent.trim()) : [],
      archives: bar?.querySelector("a.edition-bar-link")?.getAttribute("href"),
    };
  });
  check("C1 head", "h1 Ligue 1 + logo, no cards, no « Toutes », track 40 px: season · Ligue 1 · Archives → /archives/", head,
    head.title === "Ligue 1" && head.logo && head.cards === 0 && !head.allButton && near(head.barHeight, 40, 1) && round(head.barRadius) &&
      head.items.length === 3 && /\d{4}\/\d{4}/.test(head.items[0]) && head.items[1] === "Ligue 1" && head.items[2] === "Archives" && /^\/archives\/?/.test(head.archives || ""));
  const views = await page.evaluate(() => {
    const track = document.querySelector(".edition-head--page .edition-tools .segmented-control");
    const pressed = track?.querySelector('[aria-pressed="true"]');
    return {
      outOfCard: Boolean(track && !track.closest(".card")),
      radius: track && getComputedStyle(track).borderTopLeftRadius,
      pressed: pressed?.textContent.trim(),
      fill: pressed && getComputedStyle(pressed).backgroundColor,
    };
  });
  check("C2 views", "out of the card, 999 px track, Classement ivory", views, views.outOfCard && round(views.radius) && views.pressed === "Classement" && views.fill === IVORY);
  const heights = await page.evaluate(() => {
    const card = document.querySelector(".competition-detail-layout--overview > .competition-detail");
    const side = document.querySelector(".competition-detail-layout--overview > .competition-highlights");
    const standings = card?.querySelector(".competition-standings");
    return {
      card: card && Math.round(card.getBoundingClientRect().bottom),
      side: side && Math.round(side.getBoundingClientRect().bottom),
      veil: standings && Math.round(standings.getBoundingClientRect().bottom),
      // hugo, 27 Nov 2026, 16 h 59: « le super gap que tu as laissé sous le classement ». The empty space in the veil
      // under the table and its legend (its bottom padding taken off).
      empty: standings?.lastElementChild && Math.round(standings.getBoundingClientRect().bottom -
        Number.parseFloat(getComputedStyle(standings).paddingBottom) - standings.lastElementChild.getBoundingClientRect().bottom),
    };
  });
  check("C3 card height", "the card's and the veil's foot on the column's (±2), no empty space under the table (≤ 2)", heights,
    heights.card && heights.side && near(heights.card, heights.side) && near(heights.veil, heights.side) && heights.empty <= 2);
  await page.screenshot({ path: join(out, "competition-ordinateur.png"), fullPage: true });

  await page.locator(".edition-bar .settings-picker").nth(0).locator("button").click();
  await page.waitForTimeout(500);
  const seasons = await page.evaluate(() => {
    const list = document.querySelector('dialog[data-pane="season"] .home-settings-seasons');
    const chosen = list?.querySelector('[aria-pressed="true"]');
    const box = list?.getBoundingClientRect(), c = chosen?.getBoundingClientRect();
    const grid = list?.querySelector(".home-settings-decade-seasons");
    return {
      grouped: list?.classList.contains("is-grouped"),
      titles: list ? [...list.querySelectorAll(".home-settings-decade-title")].map((n) => n.textContent.trim()) : [],
      columns: grid && getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      height: box && Math.round(box.height),
      scrolls: list && list.scrollHeight > list.clientHeight,
      chosenVisible: Boolean(c && box && c.top >= box.top - 1 && c.bottom <= box.bottom + 1),
    };
  });
  check("C4 seasons by decade", "Années 2020, Années 2010, three a row, ≤ 360 px, chosen visible", seasons,
    seasons.grouped && seasons.titles[0] === "Années 2020" && seasons.titles.includes("Années 2010") && seasons.columns === 3 &&
      seasons.height <= 361 && seasons.chosenVisible);
  await page.screenshot({ path: join(out, "saisons-ordinateur.png") });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await page.locator(".edition-bar .settings-picker").nth(1).locator("button").click();
  await page.waitForTimeout(500);
  const panel = await page.evaluate(() => {
    const d = document.querySelector('dialog[data-pane="competitions"]');
    return {
      presets: d ? [...d.querySelectorAll(".home-settings-presets button")].map((b) => [b.textContent.trim(), b.getAttribute("aria-pressed")]) : [],
      tiles: d ? d.querySelectorAll(".home-settings-tile").length : 0,
      pressed: d ? [...d.querySelectorAll('.home-settings-tile[aria-pressed="true"] strong')].map((n) => n.textContent.trim()) : [],
      radius: d && getComputedStyle(d).borderTopLeftRadius,
    };
  });
  await page.screenshot({ path: join(out, "competitions-a-la-une.png") });
  await page.locator('dialog[data-pane="competitions"] .home-settings-presets button', { hasText: "Toutes" }).click();
  await page.waitForTimeout(400);
  const countries = await page.locator('dialog[data-pane="competitions"] .competition-switcher-country h3').count();
  await page.screenshot({ path: join(out, "competitions-toutes.png") });
  await page.locator('dialog[data-pane="competitions"] input[type="search"]').fill("liga");
  await page.waitForTimeout(300);
  const found = await page.locator('dialog[data-pane="competitions"] .home-settings-tile strong').allTextContents();
  await page.locator('dialog[data-pane="competitions"] input[type="search"]').fill("");
  await page.locator('dialog[data-pane="competitions"] .home-settings-presets button', { hasText: "À la une" }).click();
  await page.locator('dialog[data-pane="competitions"] .home-settings-tile', { hasText: "Premier League" }).click();
  await page.waitForFunction(() => document.querySelector(".edition-head--page h1")?.textContent.trim() === "Premier League", null, { timeout: 60000 }).catch(() => {});
  const after = { url: page.url(), title: await page.locator(".edition-head--page h1").textContent().catch(() => null) };
  check("C5 competitions", "À la une pressed + Toutes, 10 tiles, Ligue 1 pressed, 22 px; Toutes ≥ 5 countries; « liga » → LaLiga; PL opens", { panel, countries, found, after },
    panel.presets.length === 2 && panel.presets[0][0] === "À la une" && panel.presets[0][1] === "true" && panel.presets[1][0] === "Toutes" &&
      panel.tiles === 10 && panel.pressed.join() === "Ligue 1" && panel.radius === "22px" && countries >= 5 && found.includes("LaLiga") &&
      /[?&]id=l_4WFCIZ/.test(after.url) && after.title?.trim() === "Premier League");
  await context.close();
});

// ------------------------------------------------------------------ the archives, computer
let archivedMatch = null;
await run("archives", async () => {
  const { context, page } = await open("/archives/");
  await page.locator(".archive-day").first().waitFor({ timeout: 90000 }).catch(() => {});
  await hideConsent(page);
  const archives = await page.evaluate(() => {
    const heading = document.querySelector(".archive-heading");
    const bar = heading?.querySelector(".archive-bar");
    const day = document.querySelector(".archive-day");
    const pill = document.querySelector(".archive-line-score-pill");
    const open = document.querySelector(".archive-line.archive-row-open");
    return {
      title: heading?.querySelector("h1")?.textContent.trim(),
      bar: bar ? [...bar.querySelectorAll(".home-settings-segment")].map((n) => n.textContent.trim()) : [],
      barRadius: bar && getComputedStyle(bar).borderTopLeftRadius,
      search: Boolean(heading?.querySelector(".archive-search input[type=search]")),
      days: document.querySelectorAll(".archive-day").length,
      dayRadius: day && getComputedStyle(day).borderTopLeftRadius,
      lines: document.querySelectorAll(".archive-line").length,
      tables: document.querySelectorAll("#main table").length,
      pillRadius: pill && getComputedStyle(pill).borderTopLeftRadius,
      href: open?.querySelector(".archive-line-score a")?.getAttribute("href"),
    };
  });
  archivedMatch = archives.href;
  check("C6 archives", "h1 Archives, season + competition in a 999 px track, search pill, days 22 px, lines, no table, score pill", archives,
    archives.title === "Archives" && archives.bar.length === 2 && round(archives.barRadius) && archives.search && archives.days >= 1 &&
      archives.dayRadius === "22px" && archives.lines >= 1 && archives.tables === 0 && round(archives.pillRadius));
  await page.screenshot({ path: join(out, "archives-ordinateur.png") });
  // The archives reach back to the nineteenth century: their seasons come by decade too.
  await page.locator(".archive-bar .settings-picker").nth(0).locator("button").click();
  await page.waitForTimeout(400);
  const many = await page.evaluate(() => {
    const list = document.querySelector('dialog[data-pane="season"] .home-settings-seasons');
    const box = list?.getBoundingClientRect();
    return { count: list?.querySelectorAll(".home-settings-season").length, grouped: list?.classList.contains("is-grouped"), height: box && Math.round(box.height), scrolls: list && list.scrollHeight > list.clientHeight };
  });
  await page.screenshot({ path: join(out, "archives-saisons.png") });
  check("C4b archives' seasons", "many seasons: by decade, the list scrolls inside ≤ 360 px", many, many.count >= 9 && many.grouped && many.height <= 361 && many.scrolls);
  // Codex on #262: the list measured itself before the dialog opened, so an old season chosen far down was out of
  // sight on the next opening. Choose one deep in the list, reopen: it is in view.
  const deep = page.locator('dialog[data-pane="season"] .home-settings-season').nth(Math.floor(many.count * 0.6));
  const chosenSeason = await deep.textContent();
  await deep.click();
  await page.waitForTimeout(1500);
  if (await page.locator('dialog[data-pane="season"]').count()) await page.keyboard.press("Escape");
  await page.locator(".archive-bar .settings-picker").nth(0).locator("button").click();
  await page.waitForTimeout(400);
  const reopened = await page.evaluate(() => {
    const list = document.querySelector('dialog[data-pane="season"] .home-settings-seasons');
    const chosen = list?.querySelector('[aria-pressed="true"]');
    const box = list?.getBoundingClientRect(), c = chosen?.getBoundingClientRect();
    return {
      chosen: chosen?.textContent.trim(),
      scrollTop: list && Math.round(list.scrollTop),
      inView: Boolean(c && box && c.top >= box.top - 1 && c.bottom <= box.bottom + 1),
    };
  });
  await page.keyboard.press("Escape");
  check("C4c reopened on the chosen season", `${chosenSeason?.trim()} chosen deep in the list, in view on the next opening`, reopened,
    reopened.chosen === chosenSeason?.trim() && reopened.scrollTop > 0 && reopened.inView);
  await context.close();
});
if (archivedMatch) await run("archived match", async () => {
  const { context, page } = await open(archivedMatch);
  await page.locator(".archive-goal").first().waitFor({ timeout: 90000 }).catch(() => {});
  await hideConsent(page);
  const goals = await page.evaluate(() =>
    [...document.querySelectorAll(".archive-goal")].map((li) => {
      const copy = li.querySelector(".archive-goal-copy").getBoundingClientRect();
      const minute = li.querySelector(".archive-goal-minute").getBoundingClientRect();
      return { side: li.className.replace(/.*archive-goal-(home|away|unknown).*/, "$1"), left: copy.right <= minute.left + 1, right: copy.left >= minute.right - 1 };
    }),
  );
  check("C7 archived match", "home scorers left of the minute, away right of it", goals,
    goals.length > 0 && goals.every((g) => (g.side === "away" ? g.right : g.left)));
  await page.screenshot({ path: join(out, "archive-match-ordinateur.png") });
  await context.close();
});
else check("C7 archived match", "a match with goals to open", null, false);

// ------------------------------------------------------------------ the home: eight seasons or fewer
await run("home", async () => {
  const { context, page } = await open("/");
  await page.locator('.home-settings-segment[data-key="season"]').waitFor({ timeout: 90000 });
  await page.locator('.home-settings-segment[data-key="season"]').click();
  await page.waitForTimeout(500);
  const plain = await page.evaluate(() => {
    const list = document.querySelector(".home-settings-panel .home-settings-seasons");
    return { count: list?.querySelectorAll(".home-settings-season").length, grouped: list?.classList.contains("is-grouped"), titles: list?.querySelectorAll(".home-settings-decade-title").length, wrap: list && getComputedStyle(list).flexWrap };
  });
  check("C9 few seasons", "the home's seasons (≤ 8): plain wrapping pills, no decade", plain, plain.count > 0 && plain.count <= 8 && !plain.grouped && plain.titles === 0 && plain.wrap === "wrap");
  await context.close();
});

// ------------------------------------------------------------------ phone
await run("phone", async () => {
  const { context, page } = await open("/competitions/?id=l_3FJFUl", { ...devices["iPhone 13"], colorScheme: "dark" });
  await page.locator(".edition-head--page h1").waitFor({ timeout: 90000 });
  await page.waitForTimeout(1500);
  await hideConsent(page);
  const phone = await page.evaluate(() => {
    const bar = document.querySelector(".edition-bar").getBoundingClientRect();
    const head = document.querySelector(".edition-head--page").getBoundingClientRect();
    const cut = [...document.querySelectorAll(".edition-bar .home-settings-segment > span")].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent);
    return { sideways: document.documentElement.scrollWidth > window.innerWidth + 1, bar: Math.round(bar.width), head: Math.round(head.width), cut };
  });
  await page.screenshot({ path: join(out, "competition-telephone.png") });
  await page.locator(".edition-bar .settings-picker").nth(0).locator("button").click();
  await page.waitForTimeout(500);
  const sheet = await page.evaluate(() => {
    const d = document.querySelector('dialog[data-pane="season"]').getBoundingClientRect();
    return { bottom: Math.round(d.bottom), screen: window.innerHeight };
  });
  await page.screenshot({ path: join(out, "saisons-telephone.png") });
  await context.close();
  const archive = await open("/archives/", { ...devices["iPhone 13"], colorScheme: "dark" });
  await archive.page.locator(".archive-day").first().waitFor({ timeout: 90000 }).catch(() => {});
  await hideConsent(archive.page);
  const archiveSideways = await archive.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await archive.page.screenshot({ path: join(out, "archives-telephone.png") });
  await archive.context.close();
  check("C8 phone", "no sideways scroll, bar spans the head, season sheet at the bottom", { phone, sheet, archiveSideways },
    !phone.sideways && near(phone.bar, phone.head) && phone.cut.length === 0 && near(sheet.bottom, sheet.screen) && !archiveSideways);
});

check("X1 no page error", "none", errors, errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
await writeFile(
  join(out, "evidence.json"),
  JSON.stringify({ base, replay: replay || null, rerun: `node tests/e2e/competitions-archives.e2e.mjs ${base} ${out}${replay ? " " + replay : ""}`, at: new Date().toISOString(), results }, null, 2),
);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

// E2E — the players' pages and the rankings, FAILURE_MODES § 87: piste B of the mock-up
// https://claude.ai/artifact/QoP4LsHw9q64zrwcvyzhYK (hugo, 27 Nov 2026, 20 h 56 « je suis d'accord avec tous les choix
// recommandés »; « avoir tous ses filtres sur 2 lignes je trouve ça mauvais » on a player's tabs above its filters).
// Written before the code.
//
// Failure modes and expected outcomes (dark theme, 1440 px unless said):
//  B1  /classement-joueurs: the title at the left (with its trophy), the season in a 40 px bar on the title's line.
//  B2  « La une »: the leader's card the widest, the second and the third stacked beside it, their column as tall as
//      the leader's card (±2); « En tête de la course » and « … d'avance sur … » on it.
//  B3  Ranks 4 to 30 on one 22 px card, each of the 27 rows with its gauge (`.rank-gap`).
//  B4  The method's four steps of one height; B5 the breakouts (when the season has some) on a 22 px card.
//  P1  /power-ranking: the bar (season, position) 40 px on the title's line; Joueurs / Clubs in a 999 px track.
//  P2  The first three on three cards of one height; the table starts at the fourth.
//  P3  The score a 999 px pill; every row with its club's crest.
//  P4  The clubs: ≥ 20 `tr[data-team-id]`, no pages.
//  J1  /joueurs: one 40 px bar on the title's line: season, competitions, playing time, advanced filters.
//  J2  The tabs in a 999 px track, the search (#player-search) on their line.
//  J3  The Score Vega a 999 px pill.
//  F1  /joueurs?id=…: « ← Joueurs » and the bar (season, period, comparison) on one line, above the head; nothing of
//      the bar on the tabs' line.
//  F2  A head card: the name (h1), ≥ 6 facts, the actions; no left column.
//  F3  Four tiles (value, Vega index, positions, availability) of one height; F4 the tabs in a 999 px track.
//  M1  Phone (390 px): no sideways scroll on the four pages.
//  S1  Every read held: each route opens on its skeleton (html[data-route-skeleton] ballon / power / players /
//      player), its title and bar drawn, never the logo.
//  X1  No page error.
//
//   node tests/e2e/players-rankings.e2e.mjs <base url> <evidence dir> [replay origin]
// Against a `next build` + `next start` (or `next dev`) of the site reading the public API, or a recorded replay of it.
// Writes evidence.json and screenshots; exit code 1 when a check fails.
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const { chromium, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const [base = "http://127.0.0.1:3000", out = "/tmp/players-rankings-e2e", replay] = process.argv.slice(2);
await mkdir(out, { recursive: true });

const SEASON = "2026%2F2027";
const BALLON = `/classement-joueurs?season=${SEASON}`;
const POWER = `/power-ranking?season=${SEASON}`;
const PLAYERS = `/joueurs?season=${SEASON}`;
const PLAYER = `/joueurs?season=${SEASON}&focus=europe&id=p_217YMB`;
const API = "https://dngp6kh9jx2bl.cloudfront.net";

const results = [];
const errors = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${expected} — ${JSON.stringify(actual)}`);
};
const near = (a, b, d = 2) => a != null && b != null && Math.abs(a - b) <= d;
const round = (v) => parseFloat(v) >= 100;
const card = (v) => Math.abs(parseFloat(v) - 22) <= 1;

const browser = await chromium.launch();
async function open(path, options = {}, { held = false, wait = "load" } = {}) {
  const context = await browser.newContext({ colorScheme: "dark", viewport: { width: 1440, height: 900 }, ...options });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("vega.consent.v1", JSON.stringify({ measurement: false, at: "2026-11-27T12:00:00Z" }));
    } catch {}
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${path}: ${error.message}`));
  for (const origin of [API, ...(replay ? [replay] : [])])
    await page.route(`${origin}/**`, async (route) => {
      if (held) return new Promise(() => {});
      if (!replay || origin !== API) return route.continue();
      try {
        const response = await fetch(route.request().url().replace(API, replay));
        await route.fulfill({
          status: response.status,
          headers: { "content-type": response.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" },
          body: Buffer.from(await response.arrayBuffer()),
        });
      } catch {
        await route.abort();
      }
    });
  await page.goto(base + path, { waitUntil: wait, timeout: 120000 });
  return { context, page };
}
async function run(name, part) {
  try {
    await part();
  } catch (error) {
    check(`${name} stopped`, "the part runs to its end", String(error.message).split("\n")[0], false);
  }
}
const hideConsent = (page) => page.evaluate(() => document.querySelectorAll(".consent-live, .consent").forEach((n) => n.remove()));
// A box, rounded, for an element (or null).
const BOX = `(el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom), mid: Math.round(r.top + r.height / 2) }; }`;
// The heading's bar: on the title's line, its height and segments.
const headingBar = (page) =>
  page.evaluate((BOX) => {
    const box = eval(BOX);
    const heading = document.querySelector("#main .page-heading");
    const title = heading?.querySelector("h1");
    const bar = heading?.querySelector(".heading-actions .home-settings");
    return {
      title: title?.textContent.trim(),
      titleBox: box(title),
      heading: box(heading),
      bar: box(bar),
      radius: bar && getComputedStyle(bar).borderTopLeftRadius,
      items: bar ? [...bar.querySelectorAll(".home-settings-segment")].map((n) => n.textContent.replace(/\s+/g, " ").trim()) : [],
    };
  }, BOX);
const sameLine = (h) => h.bar && h.titleBox && near(h.bar.mid, h.titleBox.mid, 8);

// ------------------------------------------------------------------ Ballon d'Or
await run("ballon", async () => {
  const { context, page } = await open(BALLON);
  await page.locator('.podium li[aria-label^="Rang 1 :"]').waitFor({ timeout: 90000 });
  await page.waitForTimeout(1200);
  await hideConsent(page);
  const h = await headingBar(page);
  check("B1 title left, season bar 40 px on its line", "h1 at the heading's left, bar 40 (±1) on the same line, 999 px", h,
    h.titleBox && near(h.titleBox.x, h.heading.x, 4) && h.bar && near(h.bar.h, 40, 1) && sameLine(h) && round(h.radius) && /\d{4}\/\d{4}/.test(h.items[0] || ""));
  const une = await page.evaluate((BOX) => {
    const box = eval(BOX);
    const one = document.querySelector('.podium li[aria-label^="Rang 1 :"]'), two = document.querySelector('.podium li[aria-label^="Rang 2 :"]'), three = document.querySelector('.podium li[aria-label^="Rang 3 :"]');
    return { one: box(one), two: box(two), three: box(three), text: one?.textContent.replace(/\s+/g, " ").trim(), radius: one && getComputedStyle(one).borderTopLeftRadius };
  }, BOX);
  check("B2 la une", "leader widest; 2 and 3 stacked beside it; their column as tall as the leader (±2); « En tête de la course », « d’avance sur »", une,
    une.one && une.two && une.three && une.one.w > une.two.w && near(une.two.x, une.three.x) && une.three.y > une.two.bottom - 1 && une.two.x >= une.one.right &&
      near(une.one.y, une.two.y) && near(une.one.bottom, une.three.bottom) && /En tête de la course/.test(une.text) && /d’avance sur/.test(une.text) && card(une.radius));
  const board = await page.evaluate(() => {
    const b = document.querySelector('.rank-board[aria-label="Rangs 4 à 30"]');
    const rows = b ? [...b.querySelectorAll("li.rank-row")] : [];
    return { radius: b && getComputedStyle(b).borderTopLeftRadius, rows: rows.length, gauges: rows.filter((r) => r.querySelector(".rank-gap")).length, bg: b && getComputedStyle(b).backgroundColor };
  });
  check("B3 ranks 4–30", "one 22 px card, 27 rows, each with its gauge", board, card(board.radius) && board.rows === 27 && board.gauges === 27);
  const method = await page.evaluate(() => {
    const steps = [...document.querySelectorAll(".award-method li")].map((n) => Math.round(n.getBoundingClientRect().height));
    const m = document.querySelector(".award-method");
    const breakouts = document.querySelector('section[aria-labelledby="breakouts-title"]');
    return { steps, radius: m && getComputedStyle(m).borderTopLeftRadius, breakouts: breakouts ? getComputedStyle(breakouts).borderTopLeftRadius : null };
  });
  check("B4 method", "four steps of one height, on a 22 px card", method, method.steps.length === 4 && method.steps.every((v) => near(v, method.steps[0], 1)) && card(method.radius));
  check("B5 breakouts", "on a 22 px card (or none this season)", method.breakouts, method.breakouts === null || card(method.breakouts));
  await page.screenshot({ path: join(out, "ballon-ordinateur.png"), fullPage: true });
  await context.close();
});

// ------------------------------------------------------------------ Power Ranking
await run("power", async () => {
  const { context, page } = await open(POWER);
  await page.locator(".power-ranking-table tbody tr td a").first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(1200);
  await hideConsent(page);
  const h = await headingBar(page);
  const tabs = await page.evaluate(() => {
    const t = [...document.querySelectorAll("#main .segmented-control")].find((n) => /Joueurs/.test(n.textContent) && /Clubs/.test(n.textContent));
    return { radius: t && getComputedStyle(t).borderTopLeftRadius };
  });
  check("P1 bar and track", "bar 40 (±1) on the title's line with season and position; Joueurs / Clubs in a 999 px track", { h, tabs },
    h.bar && near(h.bar.h, 40, 1) && sameLine(h) && h.items.length >= 2 && /\d{4}\/\d{4}/.test(h.items[0]) && round(tabs.radius));
  const top = await page.evaluate((BOX) => {
    const box = eval(BOX);
    const cards = [...document.querySelectorAll(".power-top3 > li")];
    const first = document.querySelector(".power-ranking-table tbody tr td");
    return { cards: cards.map(box), radius: cards[0] && getComputedStyle(cards[0]).borderTopLeftRadius, firstRank: first?.textContent.trim() };
  }, BOX);
  check("P2 top three", "three cards of one height (22 px), the table from the 4th", top,
    top.cards.length === 3 && top.cards.every((c) => near(c.h, top.cards[0].h, 1) && near(c.y, top.cards[0].y, 1)) && card(top.radius) && top.firstRank === "4");
  const rows = await page.evaluate(() => {
    const trs = [...document.querySelectorAll(".power-ranking-table tbody tr")];
    const pill = document.querySelector(".power-ranking-table .power-score");
    return { rows: trs.length, crests: trs.filter((tr) => tr.querySelector(".power-club .crest, .power-club img")).length, radius: pill && getComputedStyle(pill).borderTopLeftRadius };
  });
  check("P3 score pill and crests", "the score in a 999 px pill, a crest in every row", rows, rows.rows > 5 && rows.crests === rows.rows && round(rows.radius));
  await page.screenshot({ path: join(out, "power-ordinateur.png"), fullPage: true });
  await context.close();
  const clubs = await open(POWER + "&tab=clubs");
  await clubs.page.locator("tr[data-team-id]").first().waitFor({ timeout: 90000 });
  await clubs.page.waitForTimeout(800);
  await hideConsent(clubs.page);
  const c = await clubs.page.evaluate(() => ({
    rows: document.querySelectorAll(".power-ranking-table tr[data-team-id]").length,
    pager: document.querySelectorAll("#main .pagination").length,
    top: document.querySelectorAll(".power-top3 > li").length,
  }));
  check("P4 clubs", "≥ 20 tr[data-team-id], no pages, the first three on cards", c, c.rows >= 20 && c.pager === 0 && c.top === 3);
  await clubs.page.screenshot({ path: join(out, "power-clubs-ordinateur.png"), fullPage: true });
  await clubs.context.close();
});

// ------------------------------------------------------------------ Joueurs
await run("players", async () => {
  const { context, page } = await open(PLAYERS);
  await page.locator("#main table tbody tr").first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(1200);
  await hideConsent(page);
  const h = await headingBar(page);
  const text = h.items.join(" | ");
  check("J1 one bar on the title's line", "40 px: season, competitions, playing time, advanced filters", h,
    h.bar && near(h.bar.h, 40, 1) && sameLine(h) && /\d{4}\/\d{4}/.test(text) && /Top 7|compétitions|Europe/i.test(text) && /entrés en jeu/.test(text) && /Filtres avancés/.test(text));
  const row = await page.evaluate((BOX) => {
    const box = eval(BOX);
    const tabs = document.querySelector('#main [role="tablist"][aria-label="Vues des joueurs"]');
    const search = document.querySelector("#main #player-search");
    return { tabs: box(tabs), radius: tabs && getComputedStyle(tabs).borderTopLeftRadius, search: box(search), searchPill: search && getComputedStyle(search.closest(".home-settings-search") || search).borderTopLeftRadius };
  }, BOX);
  check("J2 tabs track and search on their line", "999 px track; #player-search on the same line, in a pill", row,
    round(row.radius) && row.search && near(row.search.mid, row.tabs.mid, 6) && row.search.x > row.tabs.right && round(row.searchPill));
  const pill = await page.evaluate(() => {
    const p = document.querySelector("#main table tbody .rating-pill");
    return p && getComputedStyle(p).borderTopLeftRadius;
  });
  check("J3 Score Vega pill", "999 px", pill, round(pill));
  await page.screenshot({ path: join(out, "joueurs-ordinateur.png") });
  await context.close();
});

// ------------------------------------------------------------------ a player
await run("player", async () => {
  const { context, page } = await open(PLAYER);
  await page.locator("h1.player-profile-name").waitFor({ timeout: 90000 });
  await page.locator('[role="tablist"][aria-label="Analyse du joueur"]').waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  await hideConsent(page);
  const top = await page.evaluate((BOX) => {
    const box = eval(BOX);
    const row = document.querySelector(".player-top");
    const back = row?.querySelector("a");
    const bar = row?.querySelector(".home-settings");
    const head = document.querySelector(".player-head");
    const tabs = document.querySelector('[role="tablist"][aria-label="Analyse du joueur"]');
    const tabsLine = tabs?.parentElement;
    return {
      back: back?.textContent.trim(), backBox: box(back), bar: box(bar), barText: bar?.textContent.replace(/\s+/g, " ").trim(),
      head: box(head), tabs: box(tabs), tabsRadius: tabs && getComputedStyle(tabs).borderTopLeftRadius,
      // anything of the bar beside the tabs
      onTabsLine: tabs ? [...document.querySelectorAll('.home-settings, [aria-label="Filtres du joueur"]')].filter((n) => { const r = n.getBoundingClientRect(), t = tabs.getBoundingClientRect(); return r.height && r.bottom > t.top && r.top < t.bottom; }).length : null,
    };
  }, BOX);
  check("F1 bar on the back link's line", "« Joueurs » and the bar (Saison · Période · Comparer) on one line above the head; nothing of it on the tabs' line", top,
    /Joueurs/.test(top.back || "") && top.bar && near(top.bar.mid, top.backBox.mid, 8) && near(top.bar.h, 40, 1) && /Période/.test(top.barText) && /Comparer/.test(top.barText) &&
      top.head && top.bar.bottom <= top.head.y && top.onTabsLine === 0);
  const head = await page.evaluate(() => {
    const h = document.querySelector(".player-head");
    return {
      name: h?.querySelector("h1.player-profile-name")?.textContent.trim(),
      facts: h ? h.querySelectorAll("dl > div").length : 0,
      actions: h ? [...h.querySelectorAll("button, a")].map((n) => n.textContent.trim()).filter((t) => /Favoris|Enregistr|Comparer|Rapport/.test(t)) : [],
      radius: h && getComputedStyle(h).borderTopLeftRadius,
      rail: [...document.querySelectorAll('aside[aria-label="Identité du joueur"]')].filter((n) => n.getBoundingClientRect().height > 0).length,
    };
  });
  check("F2 head card, no rail", "h1 Kylian Mbappé, ≥ 6 facts, actions, 22 px; no left column", head,
    head.name === "Kylian Mbappé" && head.facts >= 6 && head.actions.length >= 2 && card(head.radius) && head.rail === 0);
  const tiles = await page.evaluate((BOX) => {
    const box = eval(BOX);
    const list = [...document.querySelectorAll(".player-tiles > *")];
    return { tiles: list.map(box), titles: list.map((n) => n.querySelector("p, h3")?.textContent.replace(/\s+/g, " ").trim()) };
  }, BOX);
  check("F3 four tiles", "value, Vega index, positions, availability, one height, one row", tiles,
    tiles.tiles.length === 4 && tiles.tiles.every((t) => near(t.h, tiles.tiles[0].h, 1) && near(t.y, tiles.tiles[0].y, 1)));
  check("F4 tabs track", "999 px", top.tabsRadius, round(top.tabsRadius));
  await page.screenshot({ path: join(out, "fiche-ordinateur.png"), fullPage: true });
  await context.close();
});

// ------------------------------------------------------------------ phone
await run("phone", async () => {
  const sideways = {};
  for (const [name, path, ready] of [
    ["ballon", BALLON, '.podium li[aria-label^="Rang 1 :"]'],
    ["power", POWER, ".power-ranking-table tbody tr td a"],
    ["joueurs", PLAYERS, "#main table tbody tr, #main .player-card, #main [role=tabpanel] li"],
    ["fiche", PLAYER, "h1.player-profile-name"],
  ]) {
    const { context, page } = await open(path, { ...devices["iPhone 13"], colorScheme: "dark" });
    await page.locator(ready).first().waitFor({ timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await hideConsent(page);
    sideways[name] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: join(out, `${name}-telephone.png`), fullPage: true });
    await context.close();
  }
  check("M1 phone", "no sideways scroll (≤ 1 px) on the four pages", sideways, Object.values(sideways).every((v) => v <= 1));
});

// ------------------------------------------------------------------ skeletons
await run("skeletons", async () => {
  const seen = {};
  for (const [kind, path] of [["ballon", BALLON], ["power", POWER], ["players", PLAYERS], ["player", PLAYER]]) {
    const { context, page } = await open(path, {}, { held: true, wait: "domcontentloaded" });
    await page.waitForTimeout(2500);
    seen[kind] = await page.evaluate((kind) => {
      const visible = (el) => {
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
        }
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const root = [...document.querySelectorAll(".ranking-skeleton, .players-skeleton")].find(visible);
      const part = (name) => (root ? [...root.querySelectorAll(`[data-skeleton-part="${name}"]`)].filter(visible).length : 0);
      return {
        flag: document.documentElement.getAttribute("data-route-skeleton"),
        skeleton: Boolean(root),
        logo: [...document.querySelectorAll("[data-page-loader]")].some(visible),
        title: part("title"), bar: part("bar"), card: part("card"),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    }, kind);
    await page.screenshot({ path: join(out, `squelette-${kind}.png`) });
    await context.close();
  }
  check("S1 skeletons", "each route flagged, its skeleton (title, bar, ≥ 1 card) shown, never the logo", seen,
    Object.entries(seen).every(([kind, s]) => s.flag === kind && s.skeleton && !s.logo && s.title >= 1 && s.bar >= 1 && s.card >= 1));
});

check("X1 no page error", "none", errors, errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
await writeFile(
  join(out, "evidence.json"),
  JSON.stringify({ base, replay: replay || null, rerun: `node tests/e2e/players-rankings.e2e.mjs ${base} ${out}${replay ? " " + replay : ""}`, at: new Date().toISOString(), results }, null, 2),
);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

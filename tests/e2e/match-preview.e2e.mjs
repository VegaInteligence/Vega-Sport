// E2E — the page of a match to come, as the page of a match played (FAILURE_MODES.md § 81, GitHub #259), written before
// the code from the mock-up hugo chose on 27 Nov 2026 (piste A, v2: https://claude.ai/artifact/EqAeUKgG3TLJSKbcF7bQeV).
//
// It runs on a replay of production for Nottingham Forest – Chelsea (m_3xkED2, Premier League, 27 Nov 2026 20:00 UTC),
// captured at 15:29 UTC that day: the frontend reads the replay as its API (NEXT_PUBLIC_API_ORIGIN) and the browser's
// reads of the API's public origin are sent to it too. The clock is set at 16:05 UTC, before the kick-off. Overlays
// (Playwright routes) add the model's grid of scores (81.1, not in production before its Deploy), take the standings
// away (P9) or make the match played (P11). The replay and its capture are kept beside the evidence, never in git.
//
//   REPLAY=http://127.0.0.1:8765 node tests/e2e/match-preview.e2e.mjs <base url> <evidence dir>
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const [base, out] = process.argv.slice(2);
const replay = process.env.REPLAY || "http://127.0.0.1:8765";
const { chromium, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const id = "m_3xkED2";
const NOW = Date.parse("2026-11-27T16:05:00Z");
const desktop = { viewport: { width: 1440, height: 900 } };
const mobile = { ...devices["iPhone 15"], viewport: { width: 393, height: 852 } };
const results = [], runs = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch();

/** The model's grid as 81.1 defines it (Dixon-Coles, 5+ in the last row and column), written here from the law. */
function grid(lh, la, rho, top = 5) {
  const pois = (lam) => {
    const p = [];
    let v = Math.exp(-lam);
    for (let k = 0; k < top; k++) { p.push(v); v *= lam / (k + 1); }
    p.push(1 - p.reduce((a, b) => a + b, 0));
    return p;
  };
  const tau = (i, j) => (i === 0 && j === 0 ? 1 - lh * la * rho : i === 0 && j === 1 ? 1 + lh * rho : i === 1 && j === 0 ? 1 + la * rho : i === 1 && j === 1 ? 1 - rho : 1);
  const ph = pois(lh), pa = pois(la);
  const g = ph.map((x, i) => pa.map((y, j) => Math.max(0, x * y * tau(i, j))));
  const sum = g.flat().reduce((a, b) => a + b, 0);
  return g.map((row) => row.map((v) => Math.round((v / sum) * 1e4) / 1e4));
}
const GRID = grid(1.52, 1.19, -0.05);
const overTwo = 1 - GRID.reduce((s, row, i) => s + row.reduce((t, v, j) => t + (i + j <= 2 ? v : 0), 0), 0);
const both = GRID.reduce((s, row, i) => s + row.reduce((t, v, j) => t + (i > 0 && j > 0 ? v : 0), 0), 0);
const pct = (v) => Math.round(v * 100) + " %";

async function check(name, expected, run) {
  const result = { name, expected };
  results.push(result);
  try {
    result.actual = await run();
    result.passed = true;
  } catch (error) {
    result.actual = error.message.split("\n").slice(0, 24).join("\n");
    result.passed = false;
  }
  process.stdout.write((result.passed ? "PASS " : "FAIL ") + name + (result.passed ? "" : " — " + result.actual.split("\n")[0]) + "\n");
}

/** A page on the match. `plan`: { grid, standings, played, view }. */
async function open(label, device, plan = {}) {
  const { grid: withGrid = true, standings = true, played = false, lineups = false, grades = true, unreliable = false, query = {}, view } = plan;
  const context = await browser.newContext({ ...device, locale: "fr-FR", colorScheme: "dark", timezoneId: "Europe/Paris" });
  const page = await context.newPage();
  const run = { label, plan, errors: [], misses: [] };
  runs.push(run);
  page.setDefaultTimeout(20000);
  await page.addInitScript(() => localStorage.setItem("vega.consent.v1", JSON.stringify({ measurement: false, at: "2026-11-25T12:00:00Z" })));
  page.on("pageerror", (error) => run.errors.push(error.message));
  // A render error the page's boundary catches shows only in the console (« Chargement impossible »).
  page.on("console", (message) => message.type() === "error" && /\b\w*Error: /.test(message.text()) && run.errors.push(message.text().split("\n")[0]));
  // The public origin's reads go to the replay (pages, images).
  await context.route(/dngp6kh9jx2bl\.cloudfront\.net/, async (route) => {
    const url = route.request().url().replace(/^https:\/\/dngp6kh9jx2bl\.cloudfront\.net/, replay);
    try {
      const response = await route.fetch({ url });
      if (response.status() === 404) run.misses.push(url.slice(replay.length));
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  // The crests' copies on the site's origin (§ 64) from the replay as well.
  await context.route(/\/api\/crest\//, async (route) => {
    const file = route.request().url().split("/").pop();
    const response = await route.fetch({ url: replay + "/data/sources/v2/images/" + file }).catch(() => null);
    return response ? route.fulfill({ response }) : route.fulfill({ status: 404, body: "" });
  });
  await context.route("**/live/config", (route) => route.fulfill({ json: { enabled: false } }));
  await context.route(/\/api\/forecasts\/match\?/, async (route) => {
    const response = await route.fetch({ url: replay + "/api/forecasts/match?match=" + id });
    const body = await response.json();
    if (withGrid) body.forecast.grid = GRID;
    // Both elevens confirmed (§ 70 kept in 81.4): the forecast that read them, each eleven against its usual one.
    if (lineups)
      body.lineups = { forecast: { home: 0.5012, draw: 0.2541, away: 0.2447, homeGoals: 1.61, awayGoals: 1.08, score: [1, 1], ...(withGrid ? { grid: GRID } : {}) },
        home: { deviation: 0.31, elo: 13.9 }, away: { deviation: -0.72, elo: -32.3 }, computedAt: "2026-11-27T19:05:00.000Z" };
    return route.fulfill({ status: 200, json: body, headers: { "access-control-allow-origin": "*" } });
  });
  // No grade read for any player (early in a season, P14), or every match's team statistics flagged unreliable (P16).
  if (!grades || unreliable)
    await context.route(/\/api\/read\/club\?/, async (route) => {
      const url = route.request().url().replace(/^https:\/\/dngp6kh9jx2bl\.cloudfront\.net/, replay);
      const response = await route.fetch({ url });
      const body = await response.json();
      if (!grades) for (const row of body.data?.appearances || []) Object.assign(row, { grade: null, gradeZ: null });
      if (unreliable) for (const m of body.data?.matches || []) m.coverage = { ...m.coverage, teamStatsReliable: false };
      return route.fulfill({ status: response.status(), json: body, headers: { "access-control-allow-origin": "*" } });
    });
  if (!standings) await context.route(/\/api\/standings\?/, (route) => route.fulfill({ status: 404, json: { error: "Donnée indisponible." } }));
  if (played)
    await context.route(new RegExp("/api/matches/" + id + "/summary"), async (route) => {
      const response = await route.fetch({ url: replay + "/api/matches/" + id + "/summary" });
      const body = await response.json();
      const match = body.data?.match || body.data || body;
      Object.assign(match, { status: "finished" });
      match.home.score = 1;
      match.away.score = 2;
      return route.fulfill({ status: 200, json: body, headers: { "access-control-allow-origin": "*" } });
    });
  await page.clock.install({ time: played ? NOW + 6 * 3600_000 : NOW });
  await page.goto(base + "/matchs?" + new URLSearchParams({ id, ...query, ...(view ? { view } : {}) }), { waitUntil: "domcontentloaded", timeout: 120000 });
  return { page, run, close: () => context.close() };
}

const panel = (page) => page.getByRole("tabpanel");
const card = (page, name) => panel(page).locator(`[data-preview="${name}"]`);
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, " ").trim();
const box = async (locator) => {
  const b = await locator.boundingBox();
  return b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
};
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

try {
  // ------------------------------------------------------------------ desktop, with the model's grid
  {
    const { page, run, close } = await open("ordinateur", desktop);
    try {
      // A miss is left to the checks, which record it (the run on main is red, not stopped).
      await page.getByRole("tab").first().waitFor({ timeout: 60000 });
      for (const name of ["model", "absents", "h2h"]) await card(page, name).waitFor({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(out, "ordinateur.png"), fullPage: true });

      await check("P1 tableau d'affichage : rang, points, compte à rebours, cinq chiffres", {
        sides: ["17ᵉ · 9 pts", "8ᵉ · 16 pts"], countdown: "dans 3 h 55",
        tiles: ["Victoire", "Buts attendus", "Score le plus probable", "xG / match sur la saison", "5 derniers matchs"],
      }, async () => {
        const sides = await page.locator(".match-scoreboard .scoreboard-team > div > span").allInnerTexts();
        const countdown = await text(page.locator("[data-countdown]"));
        const tiles = page.locator(".match-scoreboard .match-kpis > *");
        const labels = [];
        for (let i = 0; i < (await tiles.count()); i++) labels.push(await text(tiles.nth(i).locator("span").first()));
        const values = await text(page.locator(".match-scoreboard .match-kpis"));
        const pills = await page.locator(".match-scoreboard .match-kpis [data-result]").count();
        assert.match(sides[0], /17ᵉ · 9 pts/);
        assert.match(sides[1], /8ᵉ · 16 pts/);
        assert.equal(countdown, "dans 3 h 55");
        assert.deepEqual(labels, ["Victoire", "Buts attendus", "Score le plus probable", "xG / match sur la saison", "5 derniers matchs"]);
        assert.match(values, /45 %\s*–\s*29 %/);
        assert.match(values, /1,52\s*–\s*1,19/);
        assert.match(values, /1,58\s*–\s*1,25/);
        assert.equal(pills, 10);
        return { sides, countdown, labels, values, pills };
      });

      await check("P2 quatre cartes : une ligne, même hauteur, photo, nom et chiffre alignés, sans graphique", {
        cards: 4, sameRow: true, sameHeight: true, oneLine: true, charts: 0,
      }, async () => {
        const cards = panel(page).locator("[data-preview-heroes] > *");
        const n = await cards.count();
        const boxes = [];
        const lines = [];
        for (let i = 0; i < n; i++) {
          boxes.push(await box(cards.nth(i)));
          const line = cards.nth(i).locator("[data-hero-line]");
          const parts = await line.evaluate((el) => [...el.children].map((c) => { const r = c.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }));
          lines.push(parts);
        }
        const eyebrows = await panel(page).locator("[data-preview-heroes] > * small").allInnerTexts();
        const charts = await panel(page).locator("[data-preview-heroes] svg, [data-preview-heroes] .spark, [data-preview-heroes] canvas").count();
        const heroText = await text(panel(page).locator("[data-preview-heroes]"));
        assert.equal(n, 4);
        assert.ok(boxes.every((b) => Math.abs(b.y - boxes[0].y) <= 1), "same row");
        assert.ok(boxes.every((b) => Math.abs(b.h - boxes[0].h) <= 1), "same height");
        assert.ok(lines.every((centres) => centres.length >= 3 && Math.max(...centres) - Math.min(...centres) <= 12), "one line");
        assert.equal(charts, 0);
        assert.match(heroText, /Favori du modèle/);
        assert.match(heroText, /45 %/);
        assert.match(heroText, /Grand absent/);
        return { boxes, lines, eyebrows, heroText };
      });

      await check("P3 le match selon le modèle, avec la grille : trois vues, 36 cases, 1 – 1 encadré, six chiffres, le pied", {
        views: ["Résultat", "Score exact", "Buts"], cells: 36, likely: "1–1", figures: 6, over: pct(overTwo), both: pct(both),
      }, async () => {
        const model = card(page, "model");
        const views = (await model.locator('[role="group"] button').allInnerTexts()).map((t) => t.trim());
        const figures = model.locator("[data-model-figures] > *");
        const figureText = await text(model.locator("[data-model-figures]"));
        const read = (await model.locator("[data-model-read] [data-read]").allInnerTexts()).map((t) => t.trim());
        const whole = await text(model);
        await model.getByRole("button", { name: "Score exact", exact: true }).click();
        await model.locator("[data-score-cell]").first().waitFor();
        const cells = await model.locator("[data-score-cell]").count();
        const likely = await model.locator("[data-score-cell][data-likely]").getAttribute("data-score-cell");
        await model.screenshot({ path: join(out, "ordinateur-score-exact.png") });
        await model.getByRole("button", { name: "Buts", exact: true }).click();
        await model.locator("[data-goals-view]").waitFor();
        const goals = await model.locator("[data-goals-view] [data-goals]").count();
        await model.screenshot({ path: join(out, "ordinateur-buts.png") });
        await model.getByRole("button", { name: "Résultat", exact: true }).click();
        assert.deepEqual(views, ["Résultat", "Score exact", "Buts"]);
        assert.equal(cells, 36);
        assert.equal(likely, "1–1");
        assert.equal(goals, 12);
        assert.equal(await figures.count(), 6);
        assert.ok(figureText.includes("Plus de 2,5 buts " + pct(overTwo)), figureText);
        assert.ok(figureText.includes("Les deux marquent " + pct(both)), figureText);
        assert.match(figureText, /Nottingham Forest ne perd pas 71 %/);
        assert.match(figureText, /Chelsea ne perd pas 55 %/);
        assert.ok(read.includes("Force des deux équipes") && read.includes("10 derniers matchs (xG)") && read.includes("Onze probable") && read.includes("Absents"), read.join(" | "));
        assert.doesNotMatch(whole, /ne connaît ni/);
        return { views, cells, likely, goals, figureText, read };
      });

      await check("P5 cartes côte à côte de même hauteur, rien de vide sous le bloc du modèle", {
        pairs: 2, sameHeight: true, modelGap: "< 24 px",
      }, async () => {
        const pairs = panel(page).locator("[data-preview-pair]");
        const n = await pairs.count();
        const heights = [];
        for (let i = 0; i < n; i++) {
          const kids = pairs.nth(i).locator(":scope > *");
          const hs = [];
          for (let k = 0; k < (await kids.count()); k++) hs.push((await box(kids.nth(k))).h);
          heights.push(hs);
        }
        // The model's card: its last child ends near its own bottom (no column leaving a hole).
        const gap = await card(page, "model").evaluate((el) => {
          const r = el.getBoundingClientRect();
          const kids = [...el.querySelectorAll(":scope > *")].filter((k) => k.offsetParent);
          return Math.round(r.bottom - Math.max(...kids.map((k) => k.getBoundingClientRect().bottom)));
        });
        assert.equal(n, 2);
        assert.ok(heights.every((hs) => hs.length === 2 && Math.abs(hs[0] - hs[1]) <= 1), JSON.stringify(heights));
        assert.ok(gap < 24, "gap " + gap);
        return { heights, gap };
      });

      await check("P6 absents : pleine largeur, une liste sur deux colonnes (3 et 2), un blason par ligne, les comptes", {
        rows: 5, columns: [3, 2], crests: 5, counts: ["Nottingham Forest 1", "Chelsea 4"], fullWidth: true,
      }, async () => {
        const absents = card(page, "absents");
        const rows = absents.locator("li");
        const n = await rows.count();
        const xs = [];
        for (let i = 0; i < n; i++) xs.push((await box(rows.nth(i))).x);
        const columns = [...new Set(xs)].sort((a, b) => a - b).map((x) => xs.filter((v) => v === x).length);
        const crests = await absents.locator("li [data-absent-club]").count();
        const head = await text(absents.locator("[data-absent-counts]"));
        const width = (await box(absents)).w, panelWidth = (await box(panel(page))).w;
        const names = await text(absents);
        assert.equal(n, 5);
        assert.deepEqual(columns, [3, 2]);
        assert.equal(crests, 5);
        assert.match(head, /Nottingham Forest\s*1/);
        assert.match(head, /Chelsea\s*4/);
        assert.ok(width >= panelWidth - 40, `${width} / ${panelWidth}`);
        for (const name of ["Nicolás Dominguez", "Reece James", "João Pedro", "Jamie Gittens", "Aaron Anselmino"]) assert.ok(names.includes(name), name);
        return { n, columns, crests, head, width, panelWidth };
      });

      await check("P13 blasons seuls nommés : forme (adversaires), absents, coin de la grille", { form: 20, absents: 5 }, async () => {
        const form = await card(page, "form").locator('[role="img"][aria-label]').count();
        const hidden = await card(page, "form").locator('[data-result] ~ [aria-hidden="true"]').count();
        const absents = await card(page, "absents").locator('[data-absent-club] [role="img"][aria-label]').count();
        assert.ok(form >= 20, "form " + form);
        assert.equal(hidden, 0);
        assert.equal(absents, 5);
        return { form, hidden, absents };
      });

      await check("P7 confrontations : 2 · 3 · 3, six cases", { record: [2, 3, 3], tiles: 6 }, async () => {
        const h2h = card(page, "h2h");
        const record = (await h2h.locator("[data-record] b").allInnerTexts()).map(Number);
        const tiles = await h2h.locator("li").count();
        assert.deepEqual(record, [2, 3, 3]);
        assert.equal(tiles, 6);
        return { record, tiles };
      });

      await check("P8 rien de perdu : face-à-face, parts, absents ; la ligne technique partie", {
        values: ["0,82", "1,45", "1,82", "1,36", "1,58", "1,25", "1,24", "1,62", "16,55", "13,64", "46", "50"],
        gone: ["compétitions collectées", "Joueurs les plus utilisés", "Repères de la saison", "Probabilités"],
      }, async () => {
        const f2f = await text(card(page, "face"));
        const whole = await text(panel(page));
        for (const v of ["0,82", "1,45", "1,82", "1,36", "1,58", "1,25", "1,24", "1,62", "16,55", "13,64", "46", "50"]) assert.ok(f2f.includes(v), v);
        for (const label of ["Points / match", "Buts marqués / match", "Buts encaissés / match", "xG pour / match", "xG contre / match", "Tirs / match", "Possession moyenne (%)"]) assert.ok(f2f.includes(label), label);
        assert.match(whole, /45 %/);
        assert.match(whole, /26 %/);
        assert.match(whole, /29 %/);
        for (const gone of ["compétitions collectées", "Joueurs les plus utilisés", "Repères de la saison"]) assert.ok(!whole.includes(gone), gone);
        assert.equal(await panel(page).locator(".card-title", { hasText: /^Probabilités$/ }).count(), 0);
        assert.match(await text(card(page, "stakes")), /pts en fin de saison/);
        assert.match(await text(card(page, "form")), /Forme · 10 derniers matchs/);
        assert.equal(await card(page, "notes").locator("li").count(), 6);
        return { f2f };
      });

      await check("P10a ordinateur : pas de défilement de côté, aucune erreur", { sideways: 0, errors: [] }, async () => {
        const width = await sideways(page);
        assert.ok(width <= 0, "sideways " + width);
        assert.deepEqual(run.errors, []);
        return { width, misses: run.misses };
      });
    } finally {
      await close();
    }
  }

  // ------------------------------------------------------------------ without the grid (production before its Deploy)
  {
    const { page, run, close } = await open("sans grille", desktop, { grid: false });
    try {
      await check("P4 sans grille : une vue, quatre chiffres", { views: 0, figures: 4 }, async () => {
        const model = card(page, "model");
        await model.waitFor({ timeout: 60000 });
        const views = await model.locator('[role="group"] button').count();
        const figures = await model.locator("[data-model-figures] > *").count();
        const whole = await text(model);
        assert.equal(views, 0);
        assert.equal(figures, 4);
        assert.doesNotMatch(whole, /Plus de 2,5 buts|Les deux marquent|ne connaît ni/);
        assert.deepEqual(run.errors, []);
        return { views, figures };
      });
    } finally {
      await close();
    }
  }

  // ------------------------------------------------------------------ both line-ups confirmed
  {
    const { page, run, close } = await open("compositions", desktop, { lineups: true });
    try {
      await check("P12 compositions confirmées : le pronostic qui les a lues, chaque onze, avec et sans, au pied « Compositions confirmées »", {
        shares: ["50 %", "25 %", "24 %"], elevens: 2, table: ["Avec les compositions", "Sans les compositions"], read: "Compositions confirmées",
      }, async () => {
        const model = card(page, "model");
        await model.waitFor({ timeout: 60000 });
        const whole = await text(model);
        const read = (await model.locator("[data-model-read] [data-read]").allInnerTexts()).map((t) => t.trim());
        const elevens = await model.locator(".match-forecast-elevens li").count();
        assert.match(whole, /50 %.*25 %.*24 %/);
        assert.equal(elevens, 2);
        assert.match(whole, /Avec les compositions 50 % 25 % 24 %/);
        assert.match(whole, /Sans les compositions 45 % 26 % 29 %/);
        assert.ok(read.includes("Compositions confirmées") && !read.includes("Onze probable"), read.join(" | "));
        // The scoreboard's strip reads the same forecast as the card (Codex on #263).
        const strip = await text(page.locator(".match-scoreboard [data-upcoming]"));
        assert.match(strip, /Victoire\s*50 %\s*–\s*24 %/, strip);
        assert.deepEqual(run.errors, []);
        await model.screenshot({ path: join(out, "ordinateur-compositions.png") });
        return { read, elevens };
      });
    } finally {
      await close();
    }
  }

  // ------------------------------------------------------------------ no grade read
  {
    const { page, run, close } = await open("sans notes", desktop, { grades: false });
    try {
      await check("P14 sans notes : la forme seule sur sa ligne, pas de colonne vide", { notes: 0, formAlone: true }, async () => {
        await card(page, "form").waitFor({ timeout: 60000 });
        await page.waitForTimeout(1500);
        const notes = await card(page, "notes").count();
        const form = await box(card(page, "form")), p = await box(panel(page));
        assert.equal(notes, 0);
        assert.ok(form.w >= p.w - 40, `${form.w} / ${p.w}`);
        assert.deepEqual(run.errors, []);
        return { notes, form, panel: p };
      });
    } finally {
      await close();
    }
  }

  // ------------------------------------------------------------------ opened with another competition's filter
  {
    const { page, run, close } = await open("filtre d'une autre compétition", desktop, { query: { league: "l_3FJFUl" } });
    try {
      await check("P15 liens des joueurs : la saison du match, sans le filtre de compétition de la page", { season: "2026/2027", league: "" }, async () => {
        await card(page, "notes").waitFor({ timeout: 60000 });
        const links = [
          ...(await panel(page).locator("[data-preview-heroes] a").evaluateAll((as) => as.map((a) => a.getAttribute("href")))),
          ...(await card(page, "notes").locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")))),
        ].filter((h) => h.includes("/joueurs"));
        const params = links.map((h) => new URL(h, "http://x").searchParams);
        assert.ok(links.length >= 4, links.join(" | "));
        assert.ok(params.every((q) => q.get("season") === "2026/2027"), links.join(" | "));
        assert.ok(params.every((q) => !q.get("league")), links.join(" | "));
        assert.deepEqual(run.errors, []);
        return { links: links.slice(0, 3), n: links.length };
      });
    } finally {
      await close();
    }
  }

  // ------------------------------------------------------------------ team statistics flagged unreliable
  {
    const { page, run, close } = await open("stats non fiables", desktop, { unreliable: true });
    try {
      await check("P16 statistiques non fiables : les résultats restent, pas de barres xG", { results: 20, xg: 0 }, async () => {
        await card(page, "form").waitFor({ timeout: 60000 });
        await page.waitForTimeout(1500);
        const results = await card(page, "form").locator("i[data-result]").count();
        const xg = await card(page, "form").locator('[title*="xG"]').count();
        assert.equal(results, 20);
        assert.equal(xg, 0);
        assert.deepEqual(run.errors, []);
        return { results, xg };
      });
    } finally {
      await close();
    }
  }

  // ------------------------------------------------------------------ no standings
  {
    const { page, run, close } = await open("sans classement", desktop, { standings: false });
    try {
      await check("P9 sans classement : le face-à-face seul sur sa ligne", { stakes: 0, faceAlone: true }, async () => {
        await card(page, "face").waitFor({ timeout: 60000 });
        await page.waitForTimeout(1500);
        const stakes = await card(page, "stakes").count();
        const face = await box(card(page, "face")), p = await box(panel(page));
        assert.equal(stakes, 0);
        assert.ok(face.w >= p.w - 40, `${face.w} / ${p.w}`);
        assert.deepEqual(run.errors, []);
        return { stakes, face, panel: p };
      });
    } finally {
      await close();
    }
  }

  // ------------------------------------------------------------------ phone
  {
    const { page, run, close } = await open("téléphone", mobile);
    try {
      await check("P10b téléphone : tout empilé, pas de défilement de côté, aucune erreur", { sideways: 0, stacked: true, errors: [] }, async () => {
        await card(page, "h2h").waitFor({ timeout: 60000 });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: join(out, "telephone.png"), fullPage: true });
        const width = await sideways(page);
        const pairs = panel(page).locator("[data-preview-pair]");
        const stacked = [];
        for (let i = 0; i < (await pairs.count()); i++) {
          const kids = pairs.nth(i).locator(":scope > *");
          if ((await kids.count()) === 2) stacked.push((await box(kids.nth(1))).y > (await box(kids.nth(0))).y);
        }
        assert.ok(width <= 0, "sideways " + width);
        assert.ok(stacked.length && stacked.every(Boolean));
        assert.deepEqual(run.errors, []);
        return { width, stacked };
      });
    } finally {
      await close();
    }
  }

  // ------------------------------------------------------------------ a match played
  {
    const { page, run, close } = await open("match joué", desktop, { played: true, view: "context" });
    try {
      await check("P11 match joué : l'Avant-match comme avant", { titles: ["Forme avant le match", "Repères de la saison"], preview: 0 }, async () => {
        await panel(page).locator(".card-title", { hasText: "Forme avant le match" }).waitFor({ timeout: 60000 });
        const titles = (await panel(page).locator(".card-title").allInnerTexts()).map((t) => t.trim());
        const preview = await panel(page).locator("[data-preview]").count();
        const band = await page.locator(".match-scoreboard [data-countdown]").count();
        assert.ok(titles.includes("Forme avant le match") && titles.includes("Repères de la saison"), titles.join(" | "));
        assert.ok(!titles.includes("Absents"), "the absents of a match started are in « Compositions » (§ 79.7)");
        assert.equal(preview, 0);
        assert.equal(band, 0);
        assert.deepEqual(run.errors, []);
        return { titles };
      });
    } finally {
      await close();
    }
  }
} finally {
  await browser.close();
  await writeFile(join(out, "evidence.json"), JSON.stringify({
    base, replay, match: id, clock: new Date(NOW).toISOString(), grid: GRID,
    rerun: `REPLAY='${replay}' node tests/e2e/match-preview.e2e.mjs '${base}' '${out}'`,
    results, runs,
  }, null, 2));
}
if (results.some((r) => !r.passed)) process.exitCode = 1;

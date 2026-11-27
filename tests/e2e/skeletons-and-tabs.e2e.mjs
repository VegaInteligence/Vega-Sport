// E2E — loading skeletons in the pages' new shapes, and the tab kept from one competition to the next, FAILURE_MODES
// § 84: hugo, 27 Nov 2026, 18 h 46 « change le skeleton loader vu que le design a changé […] accueil, match,
// compétition ; quand je suis sur l'onglet projection et que je change de compétition je dois aller sur la nouvelle
// compétition sur le même onglet ». Written before the code.
//
// Failure modes and expected outcomes (dark theme; desktop 1440 px and iPhone 13), every API read held:
//  C1  Competition: its skeleton, never the logo.
//  C2  No row of ten competition tiles any more (piste B, § 82): the title is a logo and a name.
//  C3  The bar (Saison · Compétition · Archives) and the views are pills (999 px); on a computer the bar is at the
//      right of the title.
//  C4  The table on a 22 px card of the veil (≥ 18 rows), three 22 px cards beside it (computer) or below (phone).
//  M1  Match (?id=…): a skeleton of the match page, never the logo.
//  M2  Its top line: the way back, the competition and the two actions as pills.
//  M3  The matchday strip: tiles on 22 px cards (≥ 5 on a computer) between two round buttons.
//  M4  The score's head (two crests and the score), then the 22 px card of five figures.
//  M5  The tabs, then ≥ 4 cards of 22 px.
//  H1  Home, while the week is read again (another season chosen): the home's skeleton, not two grey lines, never
//      the logo; the toolbar (Saison · Compétitions) above it, or its place in the skeleton.
//  H2  Its results strip: ≥ 4 tiles (2 on a phone) on 22 px cards; then ≥ 3 cards of the bento.
//  P1  Phone: no sideways scroll on the three skeletons.
// With the data (replay), Ligue 1 then a switch of competition through the bar:
//  T1  Projection → Premier League: Projection still chosen, the projection shown, `view=projection` in the address.
//  T2  Joueurs → Premier League: Joueurs, the race shown.
//  T3  Matchs → Premier League: Matchs, the matchday shown.
//  T4  Projection → a league without one (LaLiga in the replay): Classement, the table shown, nothing blank.
//  T5  Projection → Champions League (a cup): one of its views shown, no error.
//  T6  The address `?id=<Premier League>&view=projection` opens on Projection.
//  X1  No page error.
//
//   node tests/e2e/skeletons-and-tabs.e2e.mjs <base url> <evidence dir> [replay origin]
// Against a `next build` + `next start` of the site (NEXT_PUBLIC_API_ORIGIN at build time). Writes evidence.json and
// screenshots; exit code 1 when a check fails.
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const { chromium, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const [base = "http://127.0.0.1:3000", out = "/tmp/skeletons-and-tabs-e2e", replay] = process.argv.slice(2);
await mkdir(out, { recursive: true });

const LIGUE_1 = "l_3FJFUl";
const PREMIER_LEAGUE = "l_4WFCIZ";
const LALIGA = "l_0ErfuF";
const CHAMPIONS_LEAGUE = "l_0bfbkO";
const MATCH = "m_0BcQYa";
const API = ["https://dngp6kh9jx2bl.cloudfront.net", ...(replay ? [replay] : [])];

const results = [];
const errors = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${expected} — ${JSON.stringify(actual)}`);
};
const pill = (radius) => parseFloat(radius) >= 100;
const card = (radius) => Math.abs(parseFloat(radius) - 22) <= 1;

const browser = await chromium.launch();
const KINDS = {
  desktop: { viewport: { width: 1440, height: 1000 } },
  phone: { ...devices["iPhone 13"] },
};
async function context(kind, { held = false } = {}) {
  const ctx = await browser.newContext({ colorScheme: "dark", ...KINDS[kind] });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("vega.consent.v1", JSON.stringify({ measurement: false, at: "2026-11-27T12:00:00Z" }));
    } catch {}
  });
  ctx.held = held;
  for (const origin of API)
    await ctx.route(`${origin}/**`, async (route) => {
      // Every read held: the page stays on what it shows while it loads.
      if (ctx.held) return new Promise(() => {});
      if (origin !== "https://dngp6kh9jx2bl.cloudfront.net" || !replay) return route.continue();
      const url = route.request().url().replace(origin, replay);
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
  return ctx;
}
async function page(ctx, label) {
  const p = await ctx.newPage();
  p.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
  return p;
}
async function run(name, part) {
  try {
    await part();
  } catch (error) {
    check(`${name} stopped`, "the part runs to its end", String(error.message).split("\n")[0], false);
  }
}
const shot = (p, name) => p.screenshot({ path: join(out, `${name}.png`) }).catch(() => {});

// What is on screen, for a skeleton's root selector.
const reading = (p, root) =>
  p.evaluate((root) => {
    const visible = (el) => {
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return { x: Math.round(r.left), y: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), radius: s.borderRadius, bg: s.backgroundColor };
    };
    const skeleton = [...document.querySelectorAll(root)].find(visible) || null;
    const all = (selector) => (skeleton ? [...skeleton.querySelectorAll(selector)].filter(visible).map(box) : []);
    return {
      skeleton: Boolean(skeleton),
      logo: [...document.querySelectorAll("[data-page-loader]")].some(visible),
      plainLines: [...document.querySelectorAll("main .skeleton:not([class*='-skeleton'])")].filter(visible).length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main: box(document.querySelector("#main")),
      all,
      parts: skeleton
        ? Object.fromEntries(
            [
              "title", "logo", "bar", "views", "table", "row", "card", "tile",
              "top-pill", "tick", "step", "crest", "score", "kpis", "kpi", "tab", "panel",
              "ticks", "home-tick", "home-card", "settings",
            ].map((name) => [name, all(`[data-skeleton-part="${name}"]`)]),
          )
        : {},
      tiles: skeleton ? skeleton.querySelectorAll(".competition-skeleton-tile, .competition-skeleton-spotlight").length : 0,
    };
  }, root);

// C1-C4 · M1-M5 · P1 — competition and match, held from the start.
for (const kind of ["desktop", "phone"]) {
  await run(`competition skeleton (${kind})`, async () => {
    const ctx = await context(kind, { held: true });
    const p = await page(ctx, `competition skeleton ${kind}`);
    await p.goto(`${base}/competitions/?id=${LIGUE_1}`, { waitUntil: "commit", timeout: 120000 });
    await p.waitForTimeout(3500);
    await shot(p, `competition-loading-${kind}`);
    const r = await reading(p, ".competition-skeleton");
    check(`C1 competition skeleton, never the logo (${kind})`, { skeleton: true, logo: false }, { skeleton: r.skeleton, logo: r.logo }, r.skeleton && !r.logo);
    check(`C2 no row of ten tiles (${kind})`, { tiles: 0, logo: "1 (title)" }, { tiles: r.tiles, logo: r.parts.logo?.length }, r.tiles === 0 && r.parts.logo?.length === 1);
    const bar = r.parts.bar?.[0], views = r.parts.views?.[0], title = r.parts.title?.[0];
    check(`C3 bar and views as pills (${kind})`, kind === "desktop" ? "999 px, bar at the title's right" : "999 px", { bar, views, title },
      bar && views && pill(bar.radius) && pill(views.radius) && (kind !== "desktop" || (title && near(bar.y, title.y, 12) && bar.x > title.x + 400)));
    const table = r.parts.table?.[0], cards = r.parts.card || [];
    const rows = r.parts.row?.length || 0;
    const beside = table && cards[0] && cards[0].x >= table.right - 1;
    const below = table && cards[0] && cards[0].y >= table.bottom - 1;
    check(`C4 table and three cards of 22 px on the veil (${kind})`, kind === "desktop" ? "≥ 18 rows, 3 cards beside" : "≥ 18 rows, 3 cards below",
      { table, rows, cards: cards.map((c) => c.radius) },
      table && card(table.radius) && table.bg !== "rgba(0, 0, 0, 0)" && rows >= 18 && cards.length === 3 && cards.every((c) => card(c.radius)) && (kind === "desktop" ? beside : below));
    if (kind === "phone") check("P1 no sideways scroll (competition)", "≤ 0", r.overflow, r.overflow <= 0);
    await ctx.close();
  });

  await run(`match skeleton (${kind})`, async () => {
    const ctx = await context(kind, { held: true });
    const p = await page(ctx, `match skeleton ${kind}`);
    await p.goto(`${base}/matchs/?id=${MATCH}`, { waitUntil: "commit", timeout: 120000 });
    await p.waitForTimeout(3500);
    await shot(p, `match-loading-${kind}`);
    const r = await reading(p, ".match-skeleton");
    check(`M1 match skeleton, never the logo (${kind})`, { skeleton: true, logo: false }, { skeleton: r.skeleton, logo: r.logo }, r.skeleton && !r.logo);
    const top = r.parts["top-pill"] || [];
    check(`M2 top line in pills (${kind})`, "≥ 3 pills of 999 px", top.map((b) => [b.w, b.radius]), top.length >= 3 && top.every((b) => pill(b.radius)));
    const ticks = r.parts.tick || [], steps = r.parts.step || [];
    check(`M3 matchday strip (${kind})`, kind === "desktop" ? "≥ 5 tiles of 22 px, 2 round buttons" : "≥ 2 tiles of 22 px",
      { ticks: ticks.length, radius: ticks[0]?.radius, steps: steps.map((s) => s.radius) },
      ticks.length >= (kind === "desktop" ? 5 : 2) && ticks.every((t) => card(t.radius)) && (kind !== "desktop" || (steps.length === 2 && steps.every((s) => parseFloat(s.radius) >= 20))));
    const crests = r.parts.crest || [], kpis = r.parts.kpis?.[0], kpi = r.parts.kpi || [];
    check(`M4 score's head and five figures (${kind})`, "2 crests, a score, a 22 px card of 5", { crests: crests.length, score: r.parts.score?.length, kpis, kpi: kpi.length },
      crests.length === 2 && r.parts.score?.length === 1 && kpis && card(kpis.radius) && kpi.length === 5);
    const tabs = r.parts.tab || [], panels = r.parts.panel || [];
    check(`M5 tabs then cards (${kind})`, "≥ 3 tabs, ≥ 4 cards of 22 px", { tabs: tabs.length, panels: panels.map((c) => c.radius) },
      tabs.length >= 3 && panels.length >= 4 && panels.every((c) => card(c.radius)));
    if (kind === "phone") check("P1 no sideways scroll (match)", "≤ 0", r.overflow, r.overflow <= 0);
    await ctx.close();
  });

  await run(`home skeleton (${kind})`, async () => {
    const ctx = await context(kind);
    const p = await page(ctx, `home skeleton ${kind}`);
    await p.goto(`${base}/`, { waitUntil: "load", timeout: 120000 });
    await p.waitForSelector(".home-toolbar .home-settings", { timeout: 60000 });
    await p.waitForTimeout(1500);
    ctx.held = true;
    // Another season: the week is read again, and held.
    await p.locator('.home-toolbar .home-settings-segment[data-key="season"]').first().click();
    await p.waitForTimeout(400);
    const other = p.locator('.home-settings-seasons button[aria-pressed="false"]').first();
    await other.click();
    await p.waitForTimeout(3000);
    await shot(p, `home-loading-${kind}`);
    const r = await reading(p, ".home-skeleton");
    // The bar itself, or its place in the skeleton while the whole page is redrawn.
    const toolbar = await p.evaluate(() =>
      [...document.querySelectorAll("#main .home-toolbar .home-settings, .home-skeleton [data-skeleton-part='settings']")].some((bar) => {
        const r = bar.getBoundingClientRect();
        return r.height > 0 && r.width > 0 && getComputedStyle(bar).visibility !== "hidden";
      }),
    );
    check(`H1 home skeleton under its toolbar, never the logo (${kind})`, { skeleton: true, logo: false, plainLines: 0, toolbar: true },
      { skeleton: r.skeleton, logo: r.logo, plainLines: r.plainLines, toolbar }, r.skeleton && !r.logo && r.plainLines === 0 && toolbar);
    const ticks = r.parts["home-tick"] || [], cards = r.parts["home-card"] || [];
    check(`H2 results strip and bento (${kind})`, kind === "desktop" ? "≥ 4 tiles of 22 px, ≥ 3 cards" : "≥ 2 tiles of 22 px, ≥ 3 cards",
      { ticks: ticks.length, radius: ticks[0]?.radius, cards: cards.length },
      ticks.length >= (kind === "desktop" ? 4 : 2) && ticks.every((t) => card(t.radius)) && cards.length >= 3);
    if (kind === "phone") check("P1 no sideways scroll (home)", "≤ 0", r.overflow, r.overflow <= 0);
    await ctx.close();
  });
}

// T1-T6 — the tab kept from one competition to the next.
const chosenView = (p) =>
  p.evaluate(() => document.querySelector('.edition-head--page .segmented-control button[aria-pressed="true"]')?.textContent?.trim() || null);
async function pick(p, id) {
  await p.locator(".edition-bar .settings-picker").nth(1).locator("button").first().click();
  await p.waitForTimeout(400);
  await p.locator(`dialog[data-pane="competitions"] .home-settings-tile[data-league="${id}"]`).first().click();
  await p.waitForTimeout(3500);
}
async function chooseView(p, name) {
  await p.locator(".edition-head--page .segmented-control button", { hasText: name }).first().click();
  await p.waitForTimeout(2000);
}
const shown = (p, selector) =>
  p.evaluate((selector) => {
    const el = document.querySelector(selector);
    return Boolean(el && el.getBoundingClientRect().height > 40);
  }, selector);
const viewParam = (p) => new URL(p.url()).searchParams.get("view");

for (const [id, name, selector, param] of [
  ["T1", "Projection", ".season-projection-view", "projection"],
  ["T2", "Joueurs", ".league-race-view", "joueurs"],
  ["T3", "Matchs", ".matchday-current", "matchs"],
]) {
  await run(`${id} ${name}`, async () => {
    const ctx = await context("desktop");
    const p = await page(ctx, `${id} ${name}`);
    await p.goto(`${base}/competitions/?id=${LIGUE_1}`, { waitUntil: "load", timeout: 120000 });
    await p.waitForSelector(".edition-head--page .segmented-control", { timeout: 60000 });
    await p.waitForTimeout(2500);
    await chooseView(p, name);
    await pick(p, PREMIER_LEAGUE);
    const state = { url: new URL(p.url()).search, view: await chosenView(p), shown: await shown(p, selector) };
    await shot(p, `tab-${param}-premier-league`);
    check(`${id} ${name} kept on Premier League`, { view: name, shown: true, param }, state,
      state.view === name && state.shown && viewParam(p) === param && state.url.includes(PREMIER_LEAGUE));
    await ctx.close();
  });
}

await run("T4 Projection → LaLiga", async () => {
  const ctx = await context("desktop");
  const p = await page(ctx, "T4");
  await p.goto(`${base}/competitions/?id=${PREMIER_LEAGUE}&view=projection`, { waitUntil: "load", timeout: 120000 });
  await p.waitForSelector(".edition-head--page .segmented-control", { timeout: 60000 });
  await p.waitForTimeout(3000);
  const opened = { view: await chosenView(p), shown: await shown(p, ".season-projection-view") };
  check("T6 the address opens on Projection", { view: "Projection", shown: true }, opened, opened.view === "Projection" && opened.shown);
  await pick(p, LALIGA);
  await p.waitForTimeout(2000);
  const state = { view: await chosenView(p), table: await shown(p, ".competition-detail-layout") };
  await shot(p, "tab-projection-laliga");
  check("T4 a league without a projection opens on Classement", { view: "Classement", page: true }, state, state.view === "Classement" && state.table);
  await ctx.close();
});

await run("T5 Projection → Champions League", async () => {
  const ctx = await context("desktop");
  const p = await page(ctx, "T5");
  await p.goto(`${base}/competitions/?id=${LIGUE_1}&view=projection`, { waitUntil: "load", timeout: 120000 });
  await p.waitForSelector(".edition-head--page .segmented-control", { timeout: 60000 });
  await p.waitForTimeout(2500);
  await pick(p, CHAMPIONS_LEAGUE);
  await p.waitForTimeout(2000);
  const state = { view: await chosenView(p), body: await shown(p, ".competition-detail, .competition-standings, .standings-group, .match-list, .cup-bracket") };
  await shot(p, "tab-projection-champions-league");
  check("T5 a cup opens on one of its views", "a view chosen, something shown", state, Boolean(state.view) && state.view !== "Projection" && state.body);
  await ctx.close();
});

function near(a, b, d = 2) {
  return Math.abs(a - b) <= d;
}

check("X1 no page error", "none", errors, errors.length === 0);
await browser.close();
await writeFile(join(out, "evidence.json"), JSON.stringify({ base, replay, results, errors }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks pass`);
process.exit(failed.length ? 1 : 0);

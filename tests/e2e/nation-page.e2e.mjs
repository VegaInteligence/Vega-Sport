// E2E — a nation's page (/nations?id=) brought level with a club's page.
// Written before the implementation, from the product review of 23 Nov 2026 (nation page « far behind »
// the club page).
//
// Failure modes and expected outcomes:
//  H1 The nation's name is the page's main heading (`#main h1`), so the « ← » link of a page reached
//     from it is named after the nation: a click on the page stores « France » under its history entry
//     (sessionStorage `vega:back-labels`).
//  B1 The back link « ← Toutes les nations » is at the top of the identity column.
//  B2 Unknown nation (404): the empty state keeps the back link.
//  B3 The nation's read fails (500): the error state keeps the back link.
//  L1 Loading (every API response held back): the page never shows the logo; it shows the nation's
//     skeleton ([data-nation-skeleton]) until the name appears.
//  L2 Phone: the skeleton's identity column sits above its main column (stacked, no overlap).
//  T1 Three tabs: Vue d'ensemble, Matchs, Joueurs (no « Historique »).
//  T2 The open tab is in the address: « Matchs » adds nationView=matches, a reload opens Matchs,
//     « Vue d'ensemble » removes the parameter.
//  T3 An old link to the removed tab (nationView=history) opens the overview.
//  O1 « Prochains matchs » beside the Elo chart: the not-started matches, soonest first (France has two:
//     25 and 28 March 2027), each against « Espagne ». No « Derniers matchs » card.
//  O2 No coming match (served without them): no « Prochains matchs » card; the Elo card takes the
//     panel's whole width.
//  O3 The Elo card switches between the recent window and the whole history (two buttons, the
//     second one changes the chart's axis).
//  O4 « Les joueurs » in the overview: 5 rows and the link to the whole table, which opens « Joueurs »
//     with more rows.
//  O5 « Grands tournois » stays in the overview.
//  S1 « Enregistrer » in the identity column; a click turns it to « Enregistré » and stores the nation
//     under kind « nations » (never « clubs »), keeping an already saved club.
//  S2 /nations: « Mes sélections » beside the list's filters lists the saved nation only.
//  S3 Phone: the save button is visible without opening the identity column's fold.
//  P1 Phone: the heading, three tabs and « Prochains matchs »; no sideways page scroll.
//  X1 No page error in the console during the whole run.
//
// Run (local front against the API named by NEXT_PUBLIC_API_ORIGIN, or the public site):
//   node tests/e2e/nation-page.e2e.mjs <base url> <evidence dir> [api origin]
// e.g. node tests/e2e/nation-page.e2e.mjs http://127.0.0.1:3012 /tmp/nation-e2e http://127.0.0.1:8765
// The optional api origin receives the requests the page sends to the built-in API distribution
// (images included), for a local replay of the API. The nation and season default to France 2026/2027
// (NATION, SEASON environment variables). It writes evidence.json (setup, inputs, expected, actual,
// console) and one screenshot per step into the evidence dir; exit code 1 when any check fails.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [base = "http://127.0.0.1:3000", out = path.join(os.tmpdir(), "nation-e2e"), apiOrigin = ""] = process.argv.slice(2);
const NATION = process.env.NATION || "t_2ysHaw", NAME = process.env.NATION_NAME || "France";
const SEASON = process.env.SEASON || "2026/2027";
const DISTRIBUTION = "https://dngp6kh9jx2bl.cloudfront.net";
await mkdir(out, { recursive: true });

function playwright() {
  const global = (() => {
    try {
      return path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright");
    } catch {
      return null;
    }
  })();
  const roots = [process.env.PLAYWRIGHT_CORE, ...(() => {
    const npx = path.join(os.homedir(), ".npm/_npx");
    return existsSync(npx) ? readdirSync(npx).map((d) => path.join(npx, d, "node_modules/playwright-core")) : [];
  })(), global].filter((p) => p && existsSync(path.join(p, "package.json")));
  if (!roots.length) throw new Error("playwright-core not found: set PLAYWRIGHT_CORE");
  return createRequire(import.meta.url)(roots[0]);
}

const results = [], consoleLog = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(ok ? "PASS" : "FAIL", id, "—", actual);
};
const { chromium } = playwright();
const browser = await chromium.launch();
const desktop = { width: 1440, height: 900 }, phone = { width: 393, height: 852 };
const nationUrl = (extra = {}) => `${base}/nations?${new URLSearchParams({ season: SEASON, id: NATION, ...extra })}`;
const listUrl = () => `${base}/nations?${new URLSearchParams({ season: SEASON })}`;

/** A context whose API requests go to `apiOrigin` when given, after `delay` ms, through `edit`. */
async function context(viewport, { delay = 0, edit } = {}) {
  const ctx = await browser.newContext({
    locale: "fr-FR",
    viewport,
    ...(viewport.width < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
  });
  await ctx.route(/va\.vercel-scripts\.com|vercel-insights|_vercel\//, (route) => route.abort());
  const serve = async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (edit) {
      const done = await edit(route, url);
      if (done) return;
    }
    if (!apiOrigin || url.origin === apiOrigin) return route.continue().catch(() => {});
    try {
      const response = await fetch(apiOrigin + url.pathname + url.search);
      await route.fulfill({
        status: response.status,
        contentType: response.headers.get("content-type") || "application/octet-stream",
        body: Buffer.from(await response.arrayBuffer()),
        headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "*" },
      });
    } catch {
      await route.abort().catch(() => {});
    }
  };
  await ctx.route(`${DISTRIBUTION}/**`, serve);
  if (apiOrigin) await ctx.route(`${apiOrigin}/**`, serve);
  return ctx;
}
async function open(ctx, url, wait = true) {
  const page = await ctx.newPage();
  const width = page.viewportSize().width;
  page.on("console", (m) => m.type() === "error" && consoleLog.push(`[${width}] ${m.text()}`));
  page.on("pageerror", (e) => consoleLog.push(`[${width}] pageerror ${e.message}`));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  page.setDefaultTimeout(8000);
  if (wait) await ready(page);
  return page;
}
const ready = (page) =>
  page.waitForFunction(() => document.querySelector("#main")?.getAttribute("data-page-ready") === "true" &&
    !document.querySelector("#main [data-page-loading]"), null, { timeout: 90000 }).catch(() => {});
const shot = (page, name, fullPage = true) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
const tabNames = async (page) =>
  (await page.locator("#main [role=tablist]").first().getByRole("tab").allInnerTexts()).map((t) => t.trim());
const selectedTab = async (page) =>
  ((await page.locator("#main [role=tablist]").first().getByRole("tab", { selected: true }).innerText().catch(() => "")) || "").trim();
const card = (page, title) => page.locator("#main section").filter({ has: page.locator("h3", { hasText: title }) }).first();
const backLink = (page) => page.locator("#main [data-back]").first();
const box = async (locator) => ((await locator.count()) ? locator.boundingBox({ timeout: 5000 }).catch(() => null) : null);
const visible = (locator) => locator.evaluate((el) => el.checkVisibility({ visibilityProperty: true })).catch(() => false);

try {
  // Warm the dev server's compilation so the timed run below measures the page, not the build.
  {
    const ctx = await context(desktop);
    const page = await open(ctx, nationUrl());
    await page.close();
    await ctx.close();
  }

  // H1, B1, T1, O1, O3, O4, O5, T2, T3
  let ctx = await context(desktop);
  let page = await open(ctx, nationUrl());
  const h1 = ((await page.locator("#main h1").first().textContent().catch(() => "")) || "").trim();
  check("H1-heading", `#main h1 « ${NAME} »`, h1 || "(no h1)", h1 === NAME);
  const back = ((await backLink(page).textContent().catch(() => "")) || "").trim();
  check("B1", "« ← Toutes les nations » at the top of the identity column", back || "(none)",
    /Toutes les nations/.test(back) && (await page.locator("aside [data-back]").count()) === 1);
  const names = await tabNames(page);
  check("T1", "Vue d’ensemble · Matchs · Joueurs", names.join(" · "),
    names.length === 3 && names[0] === "Vue d’ensemble" && names[1] === "Matchs" && names[2] === "Joueurs");
  await shot(page, "overview-desktop");

  const upcoming = card(page, "Prochains matchs");
  const rows = await upcoming.locator("[data-upcoming]").evaluateAll((list) =>
    list.map((row) => ({ date: row.getAttribute("data-upcoming"), text: row.innerText.replace(/\s+/g, " ") })));
  check("O1-upcoming", "2 coming matches, soonest first, against Espagne", JSON.stringify(rows),
    rows.length === 2 && rows[0].date < rows[1].date && rows.every((r) => /Espagne/.test(r.text)));
  const latest = await card(page, "Derniers matchs").count();
  check("O1-no-latest", "no « Derniers matchs » card", `${latest} card(s)`, latest === 0);
  const eloBox = await box(card(page, "Évolution de l’Elo"));
  const upBox = await box(upcoming);
  check("O1-beside", "« Prochains matchs » beside the Elo chart", JSON.stringify({ elo: eloBox, upcoming: upBox }),
    eloBox && upBox && Math.abs(eloBox.y - upBox.y) < 4 && upBox.x > eloBox.x + eloBox.width - 1);

  const period = page.getByRole("group", { name: "Période de l’Elo" });
  const periodButtons = await period.getByRole("button").allInnerTexts().catch(() => []);
  const axis = () => card(page, "Évolution de l’Elo").locator("svg").first().textContent().catch(() => "");
  const before = await axis();
  if (periodButtons.length === 2) await period.getByRole("button").nth(1).click();
  await page.waitForTimeout(300);
  const after = await axis();
  const pressed = periodButtons.length === 2 ? await period.getByRole("button").nth(1).getAttribute("aria-pressed") : null;
  check("O3", "two periods; the second is pressed and changes the axis", `${periodButtons.join(" / ")} · pressed ${pressed} · axis changed ${before !== after}`,
    periodButtons.length === 2 && pressed === "true" && before && after && before !== after);
  await shot(page, "overview-elo-all", false);

  const players = card(page, "Les joueurs");
  const playerRows = await players.locator("tbody tr").count();
  const playersLink = players.getByRole("button", { name: /joueurs/ });
  const linkCount = await playersLink.count();
  check("O4-overview", "5 player rows and the link to the whole table", `${playerRows} rows, link ${linkCount}`,
    playerRows === 5 && linkCount === 1);
  const tournaments = await card(page, "Grands tournois").count();
  check("O5", "« Grands tournois » in the overview", `${tournaments} card(s)`, tournaments === 1);

  // H1 back label: a click stores the page's heading under its history entry.
  await page.locator("#main [role=tablist]").first().getByRole("tab").nth(1).click();
  await page.waitForTimeout(300);
  const labels = await page.evaluate(() => sessionStorage.getItem("vega:back-labels") || "");
  check("H1-back-label", `the click stored « ${NAME} » as this page's name`, labels || "(nothing)", labels.includes(`"${NAME}"`));
  let url = new URL(page.url());
  check("T2-write", "« Matchs » sets nationView=matches", url.search, url.searchParams.get("nationView") === "matches" && (await selectedTab(page)) === "Matchs");
  await shot(page, "matches-desktop");
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  const reopened = await selectedTab(page);
  check("T2-reload", "a reload opens Matchs", reopened || "(none)", reopened === "Matchs");
  await page.locator("#main [role=tablist]").first().getByRole("tab").nth(0).click();
  await page.waitForTimeout(300);
  url = new URL(page.url());
  check("T2-overview", "« Vue d’ensemble » removes nationView", url.search, !url.searchParams.has("nationView"));
  if (linkCount === 1) {
    await card(page, "Les joueurs").getByRole("button", { name: /joueurs/ }).click();
    await page.waitForTimeout(300);
    const full = await page.locator("#main [role=tabpanel] tbody tr").count();
    url = new URL(page.url());
    check("O4-full", "the link opens « Joueurs » with more than 5 rows", `${await selectedTab(page)} · ${full} rows · ${url.search}`,
      (await selectedTab(page)) === "Joueurs" && full > 5 && url.searchParams.get("nationView") === "players");
    await shot(page, "players-desktop");
  } else check("O4-full", "the link opens « Joueurs »", "no link", false);
  await page.close();

  page = await open(ctx, nationUrl({ nationView: "history" }));
  const legacy = await selectedTab(page);
  check("T3", "nationView=history opens the overview", legacy || "(none)", legacy === "Vue d’ensemble");
  await page.close();

  // S1, S2: a club is already saved; the nation is saved beside it, under its own kind.
  await page.context().addInitScript(() => {
    if (localStorage.getItem("e2e-seeded")) return;
    localStorage.setItem("e2e-seeded", "1");
    localStorage.setItem("statarena.research.v1", JSON.stringify({
      version: 1, activeList: "main",
      lists: [{ id: "main", name: "Ma sélection", entries: [{ kind: "clubs", id: "t_41iFW3", name: "Paris Saint-Germain", season: "2026/2027" }] }],
    }));
  });
  page = await open(ctx, nationUrl());
  const save = page.locator("aside").getByRole("button", { name: new RegExp(`Enregistrer ${NAME}`) });
  const saveText = ((await save.innerText().catch(() => "")) || "").trim();
  if (saveText) await save.click();
  await page.waitForTimeout(300);
  const savedText = ((await page.locator("aside .research-bookmark").first().innerText().catch(() => "")) || "").trim();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("statarena.research.v1") || "null"));
  const entries = stored?.lists?.flatMap((l) => l.entries) || [];
  check("S1", "Enregistrer → Enregistré; stored as kind nations, the saved club kept",
    `${saveText || "(no button)"} → ${savedText} · ${JSON.stringify(entries.map((e) => `${e.kind}:${e.id}`))}`,
    saveText === "Enregistrer" && savedText === "Enregistré" &&
      entries.some((e) => e.kind === "nations" && e.id === NATION) &&
      !entries.some((e) => e.kind === "clubs" && e.id === NATION) &&
      entries.some((e) => e.kind === "clubs" && e.id === "t_41iFW3"));
  await shot(page, "saved-desktop", false);
  await page.close();
  page = await open(ctx, listUrl());
  await page.locator("#main table").first().waitFor({ timeout: 60000 }).catch(() => {});
  const mine = page.getByRole("button", { name: /^Mes sélections/ });
  const mineCount = await mine.count();
  if (mineCount) await mine.click();
  await page.waitForTimeout(300);
  const listed = await page.locator("#main tbody th").allInnerTexts().catch(() => []);
  check("S2", `« Mes sélections » lists « ${NAME} » only`, `${mineCount} button(s) · ${listed.join(" | ")}`,
    mineCount === 1 && listed.length === 1 && listed[0].trim() === NAME);
  await shot(page, "list-saved-desktop", false);
  await page.close();
  await ctx.close();

  // O2: served without its coming matches.
  ctx = await context(desktop, {
    edit: async (route, u) => {
      if (!u.pathname.endsWith(`/api/nations/${NATION}`)) return false;
      const response = await fetch((apiOrigin || u.origin) + u.pathname + u.search);
      const body = await response.json();
      body.data.matches = body.data.matches.filter((m) => m.status === "finished");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body), headers: { "access-control-allow-origin": "*" } });
      return true;
    },
  });
  page = await open(ctx, nationUrl());
  const none = await card(page, "Prochains matchs").count();
  const panel = await box(page.locator("#main [role=tabpanel]").first());
  const wide = await box(card(page, "Évolution de l’Elo"));
  check("O2", "no « Prochains matchs »; the Elo card as wide as the panel", `${none} card(s) · elo ${Math.round(wide?.width || 0)} / panel ${Math.round(panel?.width || 0)}`,
    none === 0 && wide && panel && wide.width >= panel.width - 2);
  await shot(page, "overview-no-upcoming", false);
  await page.close();
  await ctx.close();

  // B2: unknown nation.
  ctx = await context(desktop);
  page = await open(ctx, `${base}/nations?${new URLSearchParams({ season: SEASON, id: "t_zzzzzz" })}`);
  const emptyBack = ((await backLink(page).textContent().catch(() => "")) || "").trim();
  check("B2", "unknown nation: the back link stays", emptyBack || "(none)", /Toutes les nations/.test(emptyBack));
  await shot(page, "unknown-desktop", false);
  await page.close();
  await ctx.close();

  // B3: the read fails.
  ctx = await context(desktop, {
    edit: async (route, u) => {
      if (!u.pathname.endsWith(`/api/nations/${NATION}`)) return false;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "E2E" }), headers: { "access-control-allow-origin": "*" } });
      return true;
    },
  });
  page = await open(ctx, nationUrl());
  await page.locator("#main [role=alert]").first().waitFor({ timeout: 60000 }).catch(() => {});
  const errorBack = ((await backLink(page).textContent().catch(() => "")) || "").trim();
  const alert = await page.locator("#main [role=alert]").count();
  check("B3", "read error: an alert and the back link", `alert ${alert} · ${errorBack || "(no back link)"}`, alert > 0 && /Toutes les nations/.test(errorBack));
  await shot(page, "error-desktop", false);
  await page.close();
  await ctx.close();

  // L1, L2: every API response held back; sample the screen every 50 ms until the name shows.
  for (const [label, viewport] of [["desktop", desktop], ["phone", phone]]) {
    ctx = await context(viewport, { delay: 1200 });
    page = await ctx.newPage();
    page.on("pageerror", (e) => consoleLog.push(`[${viewport.width}] pageerror ${e.message}`));
    const samples = [];
    page.goto(nationUrl(), { waitUntil: "commit", timeout: 90000 }).catch(() => {});
    const start = Date.now();
    let stacked = null, shotTaken = false;
    while (Date.now() - start < 60000) {
      const s = await page.evaluate(() => {
        const seen = (el) => Boolean(el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
        const skeleton = [...document.querySelectorAll("[data-nation-skeleton]")].find(seen);
        const aside = skeleton?.querySelector("[data-skeleton-part=rail]")?.getBoundingClientRect();
        const main = skeleton?.querySelector("[data-skeleton-part=main]")?.getBoundingClientRect();
        return {
          body: Boolean(document.body?.children.length),
          logo: [...document.querySelectorAll("[data-page-loader]")].some(seen),
          skeleton: Boolean(skeleton),
          stacked: aside && main ? aside.bottom <= main.top + 1 : null,
          h1: document.querySelector("#main h1")?.textContent?.trim() || "",
        };
      }).catch(() => null);
      if (s?.body) {
        samples.push({ t: Date.now() - start, ...s });
        if (s.skeleton && stacked === null) stacked = s.stacked;
        if (s.skeleton && !shotTaken) {
          shotTaken = true;
          await shot(page, `loading-${label}`, false);
        }
        if (s.h1) break;
      }
      await page.waitForTimeout(50);
    }
    const logo = samples.filter((s) => s.logo && !s.h1).length, skeleton = samples.filter((s) => s.skeleton).length;
    check(`L1-${label}`, "never the logo; the nation's skeleton until the name",
      `${samples.length} samples · logo ${logo} · skeleton ${skeleton} · name ${samples.at(-1)?.h1 ? "shown" : "never"}`,
      samples.length > 0 && logo === 0 && skeleton > 0);
    if (label === "phone") check("L2", "phone skeleton: identity column above the main column", String(stacked), stacked === true);
    await page.close();
    await ctx.close();
  }

  // P1, S3: phone.
  ctx = await context(phone);
  page = await open(ctx, nationUrl());
  const phoneTabs = await tabNames(page);
  const phoneH1 = ((await page.locator("#main h1").first().textContent().catch(() => "")) || "").trim();
  const phoneUpcoming = await card(page, "Prochains matchs").count();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("P1", "phone: heading, 3 tabs, « Prochains matchs », no sideways scroll",
    `h1 « ${phoneH1} » · ${phoneTabs.join(" · ")} · upcoming ${phoneUpcoming} · overflow ${overflow}px`,
    phoneH1 === NAME && phoneTabs.length === 3 && phoneUpcoming === 1 && overflow <= 0);
  const phoneSave = page.locator("aside .research-bookmark").first();
  check("S3", "phone: the save button visible with the fold closed", `visible ${await visible(phoneSave)}`, await visible(phoneSave));
  await shot(page, "overview-phone");
  await page.close();
  await ctx.close();
} catch (error) {
  check("RUN", "the run completes", String(error?.stack || error), false);
} finally {
  const errors = consoleLog.filter((line) => /pageerror/.test(line));
  check("X1", "no page error", errors.length ? errors.slice(0, 5).join(" | ") : "none", errors.length === 0);
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  await writeFile(path.join(out, "evidence.json"), JSON.stringify({
    run: new Date().toISOString(),
    setup: { base, apiOrigin: apiOrigin || null, nation: NATION, name: NAME, season: SEASON },
    command: `node tests/e2e/nation-page.e2e.mjs ${base} ${out}${apiOrigin ? ` ${apiOrigin}` : ""}`,
    passed, failed: results.length - passed, results, console: consoleLog,
  }, null, 2));
  console.log(`${passed}/${results.length} passed · evidence ${out}/evidence.json`);
  process.exitCode = passed === results.length ? 0 : 1;
}

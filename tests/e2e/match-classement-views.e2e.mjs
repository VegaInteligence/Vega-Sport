// E2E — a match's « Classement » tab like the competition page, and every season menu whole, FAILURE_MODES § 85:
// hugo, 27 Nov 2026, 20 h 43 (two screenshots of an upcoming match's « Classement ») « quand je clique sur projection,
// match etc j'ai pas le meme design […] corrige ca et aussi bug sur choix de saison ». Written before the code.
//
// Failure modes and expected outcomes (dark theme, 1440 px unless said), an upcoming Ligue 1 match, its « Classement »:
//  S1  The season's trigger between the arrows reads its season (« 2026/2027 ») whole, as wide as its words: not a
//      32 px circle, no white disc over its symbol; the arrows ‹ › stay 32 px circles.
//  S2  Its menu: every season a pill wider than tall, its words whole (« 2026/2027 », not « 6/2027 »), none a grey
//      circle; the chosen season filled (ivory on the night).
//  S3  The same on a phone (iPhone 13): the trigger whole, the sheet's seasons whole.
//  S4  Every other season menu of the site keeps its seasons whole: the competition page's bar, the players' ranking,
//      the power ranking.
//  V0  The views' choice (Classement, Matchs, Projection, Joueurs) in the competition page's track: a 999 px track,
//      the chosen view filled, the others without a frame.
//  V1  Matchs: the chosen matchday and the next one on 22 px cards of the veil, the next one's title without a box,
//      days and state under each title, the competition's name not repeated on each row.
//  V2  Projection: the table on a 22 px card, the columns that stay put the card's colour, the shares 999 px pills.
//  V3  Joueurs: the race on a 22 px card, « Après la journée N », the pages and the grades 999 px pills.
//  V4  Phone: the four views in sight on the card's width (none hidden in a sliding track); no sideways scroll on
//      the three views (the tab was as wide as the standings' 800 px table).
//  X1  No page error.
//
//   node tests/e2e/match-classement-views.e2e.mjs <base url> <evidence dir> [replay origin]
// Against a `next build` + `next start` of the site (NEXT_PUBLIC_API_ORIGIN at build time). The match's own reads are
// mocked (an upcoming Ligue 1 match of 2026/2027); the rest (manifest, standings, rounds, projection, race) comes from
// the API the site is built with, or from the replay origin. Writes evidence.json and screenshots; exit 1 on a failure.
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const { chromium, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const [base = "http://127.0.0.1:3000", out = "/tmp/match-classement-views-e2e", replay] = process.argv.slice(2);
await mkdir(out, { recursive: true });

const results = [];
const errors = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${expected} — ${JSON.stringify(actual)}`);
};
const IVORY = "rgb(244, 241, 234)";
const round = (v) => v === "999px" || parseFloat(v) >= 100;

const ID = "m_e2eCLS";
const API = "/api/matches/" + ID;
const KICKOFF = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
const summary = {
  id: ID, season: "2026/2027", leagueId: "l_3FJFUl", league: "Ligue 1", summaryVersion: 1, roundName: "Journée 14",
  date: KICKOFF.slice(0, 10), timeUtc: KICKOFF, status: "not_started",
  home: { id: "t_41iFW3", name: "Paris Saint-Germain", imageUrl: null, score: null },
  away: { id: "t_2lHmy6", name: "Lorient", imageUrl: null, score: null },
  shots: [], stats: [], leadingPlayers: [], players: [],
  coverage: { shots: false, players: false, playerStats: false, teamStatsReliable: false },
};
const headers = { "access-control-allow-origin": "*", "cache-control": "no-store" };

const browser = await chromium.launch();
async function open(path, options = {}) {
  const context = await browser.newContext({ colorScheme: "dark", viewport: { width: 1440, height: 900 }, locale: "fr-FR", ...options });
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
  // The match's own families (registered last, so they answer before the replay's catch-all).
  await page.route(new RegExp(API + "(?:/[^?]+)?(?:\\?|$)"), (route) => {
    const family = new URL(route.request().url()).pathname.slice(API.length + 1);
    if (family === "summary")
      return route.fulfill({ status: 200, headers, json: { data: { version: 1, state: "ready", match: summary } } });
    return route.fulfill({ status: 404, headers, json: { error: "Donnée indisponible." } });
  });
  await page.goto(base + path, { waitUntil: "load", timeout: 120000 });
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

async function openClassement(options) {
  const opened = await open("/matchs?" + new URLSearchParams({ id: ID }), options);
  const { page } = opened;
  await page.getByRole("tab", { name: "Classement" }).waitFor({ timeout: 90000 });
  await hideConsent(page);
  await page.getByRole("tab", { name: "Classement" }).click();
  await page.locator(".match-table-view .edition-stepper").waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  return opened;
}

/** The stepper's trigger and arrows, then its menu's seasons, once opened. */
async function seasonMenu(page, scope) {
  const trigger = page.locator(`${scope} .settings-picker button[aria-haspopup="dialog"]`).first();
  await trigger.waitFor({ timeout: 60000 });
  const head = await trigger.evaluate((button, scopeSel) => {
    const css = getComputedStyle(button);
    const text = button.querySelector("span:not(.icon)") || button;
    const r = button.getBoundingClientRect();
    const arrows = [...(button.closest(".edition-stepper")?.querySelectorAll(":scope > button") || [])].map((n) => {
      const a = n.getBoundingClientRect();
      return { w: Math.round(a.width), h: Math.round(a.height), radius: getComputedStyle(n).borderTopLeftRadius };
    });
    return {
      scope: scopeSel,
      text: text.textContent.trim(),
      width: Math.round(r.width),
      height: Math.round(r.height),
      clipped: text.scrollWidth > text.clientWidth + 1,
      background: css.backgroundColor,
      arrows,
    };
  }, scope);
  await trigger.click();
  const dialog = page.locator("dialog.settings-picker-panel[open]");
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  const seasons = await dialog.evaluate((d) =>
    [...d.querySelectorAll(".home-settings-season")].map((n) => {
      const r = n.getBoundingClientRect();
      const css = getComputedStyle(n);
      return {
        text: n.textContent.trim(),
        w: Math.round(r.width),
        h: Math.round(r.height),
        clipped: n.scrollWidth > n.clientWidth + 1,
        pressed: n.getAttribute("aria-pressed") === "true",
        background: css.backgroundColor,
      };
    }),
  );
  return { head, seasons };
}
const triggerWhole = (h) => h.width > 70 && !h.clipped && /\d{4}/.test(h.text) && h.background !== IVORY;
const seasonsWhole = (s) =>
  s.length > 0 && s.every((x) => !x.clipped && x.w > x.h * 1.5 && x.h >= 30) && s.some((x) => x.pressed && x.background === IVORY);
const brief = (s) => ({ count: s.length, clipped: s.filter((x) => x.clipped).map((x) => x.text), narrow: s.filter((x) => x.w <= x.h * 1.5).map((x) => `${x.text} ${x.w}×${x.h}`), pressed: s.find((x) => x.pressed) });

await run("seasons on the match", async () => {
  const { context, page } = await openClassement();
  const { head, seasons } = await seasonMenu(page, ".match-table-view .edition-stepper");
  check("S1 trigger", "the season whole, as wide as its words; the arrows 32 px circles", head,
    triggerWhole(head) && head.arrows.length === 2 && head.arrows.every((a) => a.w === 32 && a.h === 32 && round(a.radius)));
  check("S2 menu", "every season a whole pill, the chosen one filled", brief(seasons), seasonsWhole(seasons));
  await page.screenshot({ path: join(out, "menu-saisons-match.png") });
  await context.close();
});

await run("seasons on the match, phone", async () => {
  const { context, page } = await openClassement({ ...devices["iPhone 13"], colorScheme: "dark" });
  const { head, seasons } = await seasonMenu(page, ".match-table-view .edition-stepper");
  check("S3 phone", "the trigger and the sheet's seasons whole", { head, seasons: brief(seasons) }, triggerWhole(head) && seasonsWhole(seasons));
  await page.screenshot({ path: join(out, "telephone-menu-saisons-match.png") });
  await context.close();
});

await run("other season menus", async () => {
  const seen = {};
  for (const [name, path, scope] of [
    ["competition", "/competitions/?id=l_3FJFUl", ".edition-bar"],
    ["players' ranking", "/classement-joueurs", "main"],
    ["power ranking", "/power-ranking", "main"],
  ]) {
    const { context, page } = await open(path);
    try {
      await hideConsent(page);
      const season = page.locator(`${scope} .settings-picker`).filter({ has: page.locator('[aria-label^="Saison"], [data-key="season"]') }).first();
      const fallback = page.locator(`${scope} .settings-picker`).first();
      const scoped = (await season.count()) ? season : fallback;
      await scoped.waitFor({ timeout: 60000 });
      await scoped.locator("button").first().click();
      const dialog = page.locator("dialog.settings-picker-panel[open]");
      await dialog.waitFor({ timeout: 10000 });
      await page.waitForTimeout(300);
      const list = await dialog.evaluate((d) =>
        [...d.querySelectorAll(".home-settings-season")].map((n) => {
          const r = n.getBoundingClientRect();
          return { text: n.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), clipped: n.scrollWidth > n.clientWidth + 1, pressed: n.getAttribute("aria-pressed") === "true", background: getComputedStyle(n).backgroundColor };
        }),
      );
      seen[name] = { ok: list.length === 0 || list.every((x) => !x.clipped && x.w > x.h * 1.5), ...brief(list) };
    } catch (error) {
      seen[name] = { ok: false, error: String(error.message).split("\n")[0] };
    }
    await context.close();
  }
  check("S4 every other season menu", "the seasons whole", seen, Object.values(seen).every((s) => s.ok));
});

const view = async (page, name) => {
  await page.locator(".match-table-view .segmented-control button", { hasText: name }).first().click();
  await page.waitForTimeout(1500);
};

await run("views on the match", async () => {
  const { context, page } = await openClassement();
  const v0 = await page.evaluate(() => {
    const track = document.querySelector(".match-table-view .edition-head .segmented-control");
    const buttons = [...(track?.querySelectorAll("button") || [])].map((n) => {
      const css = getComputedStyle(n);
      return { text: n.textContent.trim(), pressed: n.getAttribute("aria-pressed") === "true", background: css.backgroundColor, border: css.borderTopWidth, radius: css.borderTopLeftRadius };
    });
    return { radius: track && getComputedStyle(track).borderTopLeftRadius, buttons };
  });
  check("V0 the views' choice", "a 999 px track, the chosen view filled, the others without a frame", v0,
    round(v0.radius) && v0.buttons.length >= 3 && v0.buttons.some((b) => b.pressed && b.background === IVORY) &&
      v0.buttons.every((b) => b.border === "0px" && round(b.radius)) && ["Matchs", "Projection", "Joueurs"].every((t) => v0.buttons.some((b) => b.text === t)));
  await page.screenshot({ path: join(out, "classement.png"), fullPage: true });

  await view(page, "Matchs");
  await page.locator(".match-table-view .matchday-schedule .match-row").first().waitFor({ timeout: 60000 });
  const s = await page.evaluate(() => {
    const css = (n) => n && getComputedStyle(n);
    const box = (n) => n && { radius: css(n).borderTopLeftRadius, background: css(n).backgroundColor };
    const scope = document.querySelector(".match-table-view");
    const next = scope.querySelector(".matchday-next");
    const nextHeading = next?.querySelector(".matchday-next-heading");
    return {
      current: box(scope.querySelector(".matchday-current")),
      next: box(next),
      nextHeadingBorder: nextHeading && css(nextHeading).borderTopWidth,
      nextHeadingBackground: nextHeading && css(nextHeading).backgroundColor,
      summaries: [...scope.querySelectorAll(".matchday-summary")].map((n) => n.textContent.trim()),
      leaguesShown: [...scope.querySelectorAll(".matchday-schedule .match-league")].filter((n) => n.getBoundingClientRect().width > 0).length,
    };
  });
  const veil = (b) => b && b.radius === "22px" && b.background !== "rgba(0, 0, 0, 0)";
  check("V1 Matchs", "22 px cards of the veil, title without a box, days and state, no league repeated", s,
    veil(s.current) && (s.next ? veil(s.next) : true) && (!s.next || (s.nextHeadingBorder === "0px" && s.nextHeadingBackground === "rgba(0, 0, 0, 0)")) &&
      s.summaries.length >= 1 && s.leaguesShown === 0);
  await page.screenshot({ path: join(out, "matchs.png"), fullPage: true });

  await view(page, "Projection");
  await page.locator(".match-table-view .season-projection tbody tr").first().waitFor({ timeout: 60000 });
  const p = await page.evaluate(() => {
    const css = (n) => n && getComputedStyle(n);
    const scope = document.querySelector(".match-table-view");
    const wrap = scope.querySelector(".season-projection-view");
    const sticky = scope.querySelector(".season-projection tbody tr th");
    const shares = [...scope.querySelectorAll(".season-projection td.projection-share > span")];
    return {
      radius: wrap && css(wrap).borderTopLeftRadius,
      background: wrap && css(wrap).backgroundColor,
      sticky: sticky && css(sticky).backgroundColor,
      shares: shares.length,
      shareRadius: shares[0] && css(shares[0]).borderTopLeftRadius,
    };
  });
  check("V2 Projection", "22 px card, sticky columns the card's colour, shares in 999 px pills", p,
    p.radius === "22px" && p.sticky === p.background && p.shares > 0 && round(p.shareRadius));
  await page.screenshot({ path: join(out, "projection.png"), fullPage: true });

  await view(page, "Joueurs");
  await page.locator(".match-table-view .league-race-table tbody tr").first().waitFor({ timeout: 60000 });
  const j = await page.evaluate(() => {
    const css = (n) => n && getComputedStyle(n);
    const wrap = document.querySelector(".match-table-view .league-race-view");
    const pager = [...(wrap?.querySelectorAll(".pagination .button") || [])];
    const grades = [...(wrap?.querySelectorAll(".rating-pill") || [])];
    return {
      radius: wrap && css(wrap).borderTopLeftRadius,
      heading: wrap?.querySelector(".league-race-heading")?.textContent.trim(),
      pagerRadius: pager.map((n) => css(n).borderTopLeftRadius),
      gradeRadius: grades[0] && css(grades[0]).borderTopLeftRadius,
    };
  });
  check("V3 Joueurs", "22 px card, « Après la journée N », the pages and the grades pills", j,
    j.radius === "22px" && /^Après la journée \d+$/.test(j.heading || "") && j.pagerRadius.every(round) && round(j.gradeRadius));
  await page.screenshot({ path: join(out, "joueurs.png"), fullPage: true });
  await context.close();
});

await run("views on the match, phone", async () => {
  const { context, page } = await openClassement({ ...devices["iPhone 13"], colorScheme: "dark" });
  const seen = {};
  // The four views on the card's width: the last one ends inside the screen, none hidden in a sliding track.
  seen.views = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll(".match-table-view .edition-head .segmented-control button")];
    return { count: buttons.length, right: Math.round(Math.max(...buttons.map((n) => n.getBoundingClientRect().right))), screen: innerWidth };
  });
  for (const name of ["Matchs", "Projection", "Joueurs"]) {
    await view(page, name);
    await page.waitForTimeout(1000);
    seen[name] = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: join(out, `telephone-${name.toLowerCase()}.png`), fullPage: true });
  }
  check("V4 phone", "the four views in sight, no sideways scroll on the three views", seen,
    seen.views.count === 4 && seen.views.right <= seen.views.screen && !seen.Matchs && !seen.Projection && !seen.Joueurs);
  await context.close();
});

check("X1 no page error", "none", errors, errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
await writeFile(
  join(out, "evidence.json"),
  JSON.stringify({ base, replay: replay || null, rerun: `node tests/e2e/match-classement-views.e2e.mjs ${base} ${out}${replay ? " " + replay : ""}`, at: new Date().toISOString(), results }, null, 2),
);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

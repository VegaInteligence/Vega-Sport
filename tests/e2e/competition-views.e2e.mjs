// E2E — the competition page's other views, FAILURE_MODES § 83: hugo, 27 Nov 2026, 18 h 08 « section projection et
// match, joueurs, y'a encore les coins [carrés] et que 10 joueurs ». Matchs, Projection and Joueurs on the standings'
// veil (§ 82), every control and grade a pill; the whole race, not its first ten. Written before the code.
//
// Failure modes and expected outcomes (dark theme, 1440 px unless said), Ligue 1:
//  V1  Matchs: the chosen matchday and the next one each on its own 22 px card on the veil; the next one's title has
//      no box (no border, no background); a line under each title gives its days and its state (« 9 matchs joués »);
//      the competition's name is not repeated on each row; the forecast bars' ends are round.
//  V2  Projection: the table on a 22 px card; the columns that stay put wear the card's colour (no grey band);
//      the shares (Titre, 4 premiers, 3 derniers) are 999 px pills.
//  V3  Joueurs: the race on a 22 px card, its title « Après la journée N » and « N joueurs classés »; the matchday's
//      choice a 999 px pill as wide as its words (< 260 px); the pages « Précédents » / « Suivants » 999 px pills;
//      the grades 999 px pills; 20 rows a page and as many pages as N needs (more than ten players when N > 10).
//  V4  Classement: « Joueur de la saison » and « Équipe de la journée » on 22 px cards; the matchday's choice a pill;
//      every grade on the pitch readable (text on its pill at a contrast of 3 or more).
//  V5  Phone (iPhone 13): no sideways scroll on the three views; the matchday's choice on one line (≤ 36 px tall).
//  X1  No page error.
//
//   node tests/e2e/competition-views.e2e.mjs <base url> <evidence dir> [replay origin]
// Against a `next build` + `next start` of the site (NEXT_PUBLIC_API_ORIGIN at build time); with a replay origin, the
// requests the app sends to the API's own origin are answered by it too. Writes evidence.json and screenshots;
// exit code 1 when a check fails.
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const { chromium, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const [base = "http://127.0.0.1:3000", out = "/tmp/competition-views-e2e", replay] = process.argv.slice(2);
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
const view = async (page, name) => {
  await page.locator(".edition-head--page .segmented-control button", { hasText: name }).first().click();
  await page.waitForTimeout(1500);
};
const card = (n) => n && { radius: getComputedStyle(n).borderTopLeftRadius, background: getComputedStyle(n).backgroundColor };

await run("matchs", async () => {
  const { context, page } = await open("/competitions/?id=l_3FJFUl");
  await page.locator(".edition-head--page h1.edition-name").waitFor({ timeout: 90000 });
  await hideConsent(page);
  await view(page, "Matchs");
  await page.locator(".matchday-schedule .match-row").first().waitFor({ timeout: 60000 });
  const s = await page.evaluate(() => {
    const css = (n) => n && getComputedStyle(n);
    const box = (n) => n && { radius: css(n).borderTopLeftRadius, background: css(n).backgroundColor };
    const current = document.querySelector(".matchday-current");
    const next = document.querySelector(".matchday-next");
    const nextHeading = next?.querySelector(".matchday-next-heading");
    const leagues = [...document.querySelectorAll(".matchday-schedule .match-league")].filter((n) => n.getBoundingClientRect().width > 0);
    const bar = document.querySelector(".matchday-schedule .list-forecast-bar i");
    return {
      current: box(current),
      next: box(next),
      nextHeadingBorder: nextHeading && css(nextHeading).borderTopWidth,
      nextHeadingBackground: nextHeading && css(nextHeading).backgroundColor,
      summaries: [...document.querySelectorAll(".matchday-schedule .matchday-summary")].map((n) => n.textContent.trim()),
      leaguesShown: leagues.length,
      barRadius: bar && css(bar).borderTopLeftRadius,
    };
  });
  const veil = (b) => b && b.radius === "22px" && b.background !== "rgba(0, 0, 0, 0)";
  check("V1 Matchs", "two 22 px cards, title without a box, days and state under each title, no league repeated, round bars", s,
    veil(s.current) && (s.next ? veil(s.next) : true) && (!s.next || (s.nextHeadingBorder === "0px" && s.nextHeadingBackground === "rgba(0, 0, 0, 0)")) &&
      s.summaries.length >= 1 && s.summaries.every((t) => /\d+ (matchs? (joués?|à venir)|joués? sur \d+)/.test(t)) && s.leaguesShown === 0 &&
      (s.barRadius == null || round(s.barRadius)));
  await page.screenshot({ path: join(out, "matchs.png"), fullPage: true });
  await view(page, "Projection");
  await page.locator(".season-projection tbody tr").first().waitFor({ timeout: 60000 });
  const p = await page.evaluate(() => {
    const css = (n) => n && getComputedStyle(n);
    const wrap = document.querySelector(".season-projection-view");
    const sticky = document.querySelector(".season-projection tbody tr th");
    const shares = [...document.querySelectorAll(".season-projection td.projection-share > span")];
    return {
      radius: wrap && css(wrap).borderTopLeftRadius,
      background: wrap && css(wrap).backgroundColor,
      sticky: sticky && css(sticky).backgroundColor,
      shares: shares.length,
      shareRadius: shares[0] && css(shares[0]).borderTopLeftRadius,
      rows: document.querySelectorAll(".season-projection tbody tr").length,
    };
  });
  check("V2 Projection", "22 px card, sticky columns the card's colour, shares in 999 px pills", p,
    p.radius === "22px" && p.sticky === p.background && p.shares >= p.rows * 2 && round(p.shareRadius));
  await page.screenshot({ path: join(out, "projection.png"), fullPage: true });
  await view(page, "Joueurs");
  await page.locator(".league-race-table tbody tr").first().waitFor({ timeout: 60000 });
  const j = await page.evaluate(() => {
    const css = (n) => n && getComputedStyle(n);
    const wrap = document.querySelector(".league-race-view");
    const select = wrap?.querySelector(".league-round-select .filter-input-wrap");
    const pager = [...(wrap?.querySelectorAll(".pagination .button") || [])];
    const grades = [...(wrap?.querySelectorAll(".rating-pill") || [])];
    const note = wrap?.querySelector(".league-race-title .card-note")?.textContent || "";
    const count = Number((/([\d\s\u202f\u00a0]+) joueurs classés/.exec(note)?.[1] || "").replace(/\D/g, "")) || 0;
    const pages = /(\d+) \/ (\d+)/.exec(wrap?.querySelector(".pagination span")?.textContent || "");
    return {
      radius: wrap && css(wrap).borderTopLeftRadius,
      heading: wrap?.querySelector(".league-race-heading")?.textContent.trim(),
      count,
      rows: wrap?.querySelectorAll(".league-race-table tbody tr").length,
      pages: pages ? Number(pages[2]) : 1,
      selectRadius: select && css(select).borderTopLeftRadius,
      selectWidth: select && Math.round(select.getBoundingClientRect().width),
      pagerRadius: pager.map((n) => css(n).borderTopLeftRadius),
      gradeRadius: grades[0] && css(grades[0]).borderTopLeftRadius,
    };
  });
  check("V3 Joueurs", "22 px card, « Après la journée N », N classés, 20 a page and ceil(N/20) pages, pills for the choice, the pages and the grades", j,
    j.radius === "22px" && /^Après la journée \d+$/.test(j.heading || "") && j.count > 0 && j.rows === Math.min(20, j.count) &&
      j.pages === Math.max(1, Math.ceil(j.count / 20)) && (j.selectRadius == null || (round(j.selectRadius) && j.selectWidth < 260)) &&
      j.pagerRadius.every(round) && round(j.gradeRadius));
  check("V3b the whole race", "more than ten players classed", j.count, j.count > 10);
  await page.screenshot({ path: join(out, "joueurs.png"), fullPage: true });
  await view(page, "Classement");
  await page.locator(".league-round-cards .team-pitch").first().waitFor({ timeout: 60000 });
  const c = await page.evaluate(() => {
    const css = (n) => n && getComputedStyle(n);
    const cards = [...document.querySelectorAll(".league-round-cards > .card")].map((n) => css(n).borderTopLeftRadius);
    const select = document.querySelector(".league-round-cards .league-round-select .filter-input-wrap");
    // The contrast of a grade's text on its pill (WCAG ratio), both read as sRGB through a canvas.
    const ctx = document.createElement("canvas").getContext("2d");
    const lum = (colour) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const pitch = [...document.querySelectorAll(".team-pitch .rating-pill")].map((n) => {
      const [a, b] = [lum(css(n).backgroundColor), lum(css(n).color)].sort((x, y) => y - x);
      return { text: n.textContent.trim(), contrast: Math.round(((a + 0.05) / (b + 0.05)) * 10) / 10 };
    });
    return { cards, selectRadius: select && css(select).borderTopLeftRadius, pitch, unreadable: pitch.filter((g) => g.contrast < 3).length };
  });
  check("V4 Classement's cards", "22 px cards, the choice a pill, every pitch grade readable", c,
    c.cards.length === 2 && c.cards.every((r) => r === "22px") && (c.selectRadius == null || round(c.selectRadius)) && c.pitch.length > 0 && c.unreadable === 0);
  await context.close();
});

await run("phone", async () => {
  const { context, page } = await open("/competitions/?id=l_3FJFUl", { ...devices["iPhone 13"], colorScheme: "dark" });
  await page.locator(".edition-head--page h1.edition-name").waitFor({ timeout: 90000 });
  await hideConsent(page);
  const seen = {};
  for (const name of ["Matchs", "Projection", "Joueurs"]) {
    await view(page, name);
    await page.waitForTimeout(1500);
    seen[name] = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (name === "Matchs")
      seen.select = await page.evaluate(() => Math.round(document.querySelector("#matchday-choice")?.getBoundingClientRect().height || 0));
    await page.screenshot({ path: join(out, `telephone-${name.toLowerCase()}.png`), fullPage: true });
  }
  check("V5 phone", "no sideways scroll on the three views, the matchday's choice on one line", seen,
    !seen.Matchs && !seen.Projection && !seen.Joueurs && seen.select > 0 && seen.select <= 36);
  await context.close();
});

check("X1 no page error", "none", errors, errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
await writeFile(
  join(out, "evidence.json"),
  JSON.stringify({ base, replay: replay || null, rerun: `node tests/e2e/competition-views.e2e.mjs ${base} ${out}${replay ? " " + replay : ""}`, at: new Date().toISOString(), results }, null, 2),
);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

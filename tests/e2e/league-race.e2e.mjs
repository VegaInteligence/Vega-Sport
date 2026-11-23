// E2E — a league's « Tous les joueurs » and the Player of the Round's crown (VI-44), and the Euro's
// editions back to 1960. Written from the mock-up validated on 20 Nov 2026 (VI-44, desktop and iPhone 16).
//
// Failure modes and expected outcomes:
//  C1 The « Joueur de la saison » card shows at most the API's first ten (race), and a « Tous les
//     joueurs » button in its header when the API gives raceTotal.
//  C2 Its first row has the same player and grade as the whole race's first row (one rule, one grade).
//  J1 « Tous les joueurs » opens the « Joueurs » view: the tab is selected, the address carries view=joueurs.
//  J2 The view lists the whole race 20 a page, in rank order, each grade as the API's race=all.
//  J3 The last page ends at raceTotal: every eligible player of the round is reachable.
//  J4 The address view=joueurs opens the view directly (a shared link).
//  K1 Exactly one crown, named « Joueur de la journée », on the Team of the Round's best grade.
//  P1 Phone (iPhone 16, 393×852): no sideways scroll on the card, the view or inside the table (the grade
//     stays on screen); Minutes hidden; crown shown.
//  E1 The Euro's edition selector lists 2028 … 1960 (18 editions), 1960 last.
//  X1 No page error in the console during the run (failed loads of remote images excluded).
//
// Run (local front against the API it proxies, or the public site):
//   node tests/e2e/league-race.e2e.mjs <base url> <api base> <league id> <season> <evidence dir>
// e.g. node tests/e2e/league-race.e2e.mjs http://127.0.0.1:3000 http://127.0.0.1:8765 l_3FJFUl 2025/2026 /tmp/vi-44-e2e
// It writes evidence.json (setup, inputs, expected, actual, console) and screenshots, desktop and
// phone, into the evidence dir; exit code 1 when any check fails.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [base = "http://127.0.0.1:3000", api = base, league = "l_3FJFUl", season = "2025/2026", out = path.join(os.tmpdir(), "vi-44-e2e")] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_CORE || "playwright");

const results = [], consoleLog = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(ok ? "PASS" : "FAIL", id, "—", JSON.stringify(actual));
};
const read = async (query) => (await fetch(`${api}/api/rankings/round?${new URLSearchParams({ competition: league, season, ...query })}`)).json();
const card = await read({});
const whole = await read({ race: "all" });
const browser = await chromium.launch();

async function open(context, query) {
  const page = await context.newPage();
  const tag = context === desktop ? "desktop" : "phone";
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && consoleLog.push(`[${tag}] ${m.text()}`));
  page.on("pageerror", (e) => consoleLog.push(`[${tag}] pageerror ${e.message}`));
  await page.goto(`${base}/competitions/?${new URLSearchParams({ id: league, edition: season, ...query })}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const tableRows = (page) =>
  page.locator(".league-race-table tbody tr").evaluateAll((rows) =>
    rows.map((r) => ({ rank: Number(r.querySelector("td").textContent), name: r.querySelector("strong").textContent, grade: Number(r.querySelector(".rating-pill, [class*=grade]")?.textContent) })),
  );

const desktop = await browser.newContext({ locale: "fr-FR", viewport: { width: 1440, height: 900 } });
const phone = await browser.newContext({ locale: "fr-FR", ...devices["iPhone 15"], viewport: { width: 393, height: 852 } });

// The card and the crown.
let page = await open(desktop, {});
const raceCard = page.locator(".league-race");
await raceCard.locator(".league-race-list li").first().waitFor({ timeout: 60000 });
const cardRows = await raceCard.locator(".league-race-list li").evaluateAll((rows) => rows.map((r) => ({ name: r.querySelector("strong").textContent, grade: Number(r.querySelector(".rating-pill, [class*=grade]")?.textContent) })));
check("C1 card ≤ 10 and the button", `≤ ${Math.min(10, whole.raceTotal)} rows, API card ${card.race.length}/${card.raceTotal}, button`, { rows: cardRows.length, button: await raceCard.getByRole("button", { name: "Tous les joueurs" }).count() },
  cardRows.length >= 1 && cardRows.length <= 10 && card.race.length === Math.min(10, card.raceTotal) && (await raceCard.getByRole("button", { name: "Tous les joueurs" }).count()) === 1);
check("C2 card's first = race's first", [whole.race[0].name, Math.round(whole.race[0].grade)], [cardRows[0].name, cardRows[0].grade],
  cardRows[0].name === whole.race[0].name && cardRows[0].grade === Math.round(whole.race[0].grade));
const crowns = page.getByRole("img", { name: "Joueur de la journée" });
const best = [...card.team.players].sort((a, b) => b.grade - a.grade || a.slot - b.slot)[0];
const crowned = await crowns.evaluateAll((els) => els.map((el) => el.closest(".team-pitch-player")?.getAttribute("title")));
check("K1 one crown on the best grade", `${best.name} (${best.grade})`, crowned, crowned.length === 1 && crowned[0]?.startsWith(best.name + " ·"));
await shot(page, "desktop-card");

// The whole race.
await raceCard.getByRole("button", { name: "Tous les joueurs" }).click();
await page.locator(".league-race-table tbody tr").first().waitFor({ timeout: 60000 });
const tab = page.getByRole("tab", { name: "Joueurs" }).or(page.getByRole("radio", { name: "Joueurs" })).or(page.getByRole("button", { name: "Joueurs", exact: true }));
const selected = await tab.first().evaluate((el) => el.getAttribute("aria-selected") || el.getAttribute("aria-checked") || el.getAttribute("aria-pressed"));
check("J1 the Joueurs view, in the address", "selected, view=joueurs", { selected, url: page.url() }, selected === "true" && new URL(page.url()).searchParams.get("view") === "joueurs");
const first = await tableRows(page);
const expectFirst = whole.race.slice(0, 20).map((r) => [r.rank, r.name, Math.round(r.grade)]);
check("J2 20 a page, the API's order and grades", expectFirst.slice(0, 3), first.slice(0, 3).map((r) => [r.rank, r.name, r.grade]),
  JSON.stringify(first.map((r) => [r.rank, r.name, r.grade])) === JSON.stringify(expectFirst));
await shot(page, "desktop-joueurs-p1");
let last = first;
for (let guard = 0; guard < 50; guard++) {
  const next = page.getByRole("navigation", { name: "Pages de la course" }).getByRole("button", { name: "Suivants" });
  if (!(await next.count()) || (await next.isDisabled())) break;
  await next.click();
  await page.waitForTimeout(150);
  last = await tableRows(page);
}
check("J3 the last page ends at raceTotal", whole.raceTotal, last.at(-1)?.rank, last.at(-1)?.rank === whole.raceTotal && whole.race.length === whole.raceTotal);
await shot(page, "desktop-joueurs-last");
await page.close();
page = await open(desktop, { view: "joueurs" });
await page.locator(".league-race-table tbody tr").first().waitFor({ timeout: 60000 });
check("J4 view=joueurs opens the view", "table shown", await page.locator(".league-race-table tbody tr").count(), (await page.locator(".league-race-table tbody tr").count()) > 0);
await page.close();

// Phone.
page = await open(phone, {});
await page.locator(".league-race-list li").first().waitFor({ timeout: 60000 });
await page.waitForTimeout(500);
const cardOverflow = await overflow(page);
const crownShown = await page.getByRole("img", { name: "Joueur de la journée" }).isVisible();
await shot(page, "phone-card");
await page.locator(".league-race").getByRole("button", { name: "Tous les joueurs" }).click();
await page.locator(".league-race-table tbody tr").first().waitFor({ timeout: 60000 });
const minutes = await page.locator(".league-race-table thead .league-race-minutes").isVisible();
const viewOverflow = await overflow(page);
// The table never scrolls inside its frame: the grade column stays on screen.
const tableOverflow = await page.locator(".league-race-view .table-scroll").evaluate((el) => el.scrollWidth - el.clientWidth);
const gradeShown = await page.locator(".league-race-table tbody tr").first().locator(".rating-pill").evaluate((el) => { const r = el.getBoundingClientRect(); return r.right <= window.innerWidth && r.width > 0; });
await shot(page, "phone-joueurs");
check("P1 phone: no sideways scroll, Minutes hidden, crown shown", { cardOverflow: 0, viewOverflow: 0, tableOverflow: 0, gradeShown: true, minutes: false, crownShown: true }, { cardOverflow, viewOverflow, tableOverflow, gradeShown, minutes, crownShown },
  cardOverflow <= 0 && viewOverflow <= 0 && tableOverflow <= 0 && gradeShown && !minutes && crownShown);
await page.close();

// The Euro's editions.
page = await desktop.newPage();
page.on("pageerror", (e) => consoleLog.push(`[desktop] pageerror ${e.message}`));
await page.goto(`${base}/competitions/?id=open-cup:euro`, { waitUntil: "domcontentloaded", timeout: 120000 });
const editionSelect = page.locator("select").filter({ has: page.locator('option[value="1960"]') });
await editionSelect.first().waitFor({ state: "attached", timeout: 60000 }).catch(() => {});
const editions = await editionSelect.first().locator("option").evaluateAll((o) => o.map((x) => x.value)).catch(() => []);
const expectedEditions = ["2028", "2024", "2020", "2016", "2012", "2008", "2004", "2000", "1996", "1992", "1988", "1984", "1980", "1976", "1972", "1968", "1964", "1960"];
check("E1 the Euro's editions, 2028 … 1960", expectedEditions.length, editions, JSON.stringify(editions) === JSON.stringify(expectedEditions));
await shot(page, "desktop-euro");
await page.close();

check("X1 no page error", [], consoleLog, consoleLog.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
await writeFile(path.join(out, "evidence.json"), JSON.stringify({
  ranAt: new Date().toISOString(), base, api, league, season,
  rerun: `node tests/e2e/league-race.e2e.mjs ${base} ${api} ${league} ${season} ${out}`,
  api: { cardRows: card.race.length, raceTotal: whole.raceTotal, round: whole.round?.key },
  results, console: consoleLog, passed: results.length - failed.length, total: results.length,
}, null, 2));
console.log(`${results.length - failed.length}/${results.length} passed · evidence in ${out}`);
process.exit(failed.length ? 1 : 0);

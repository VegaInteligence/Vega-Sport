// E2E — a read pinned to a publication the API no longer serves (409 PUBLICATION_CHANGED), PR #216. The site showed
// « Les données ont été actualisées. Rechargez la première page. » when the worker published between two page loads
// or clicks: the API refuses a fixtures cursor or a `generation` of an older publication. The site now reads such a
// page again at the current publication without a word (services/compact-reads.js, match-pages.js,
// components/PaginatedMatches.jsx, hooks/useCompactRead.js) and the player's performance names no publication
// (FootballContext.jsx). The unit checks are tests/publication-changed.test.mjs (F1–F11); this runs the pages.
//
// The API is the test double tests/e2e/support/publication-api.mjs, started here: its answers are made up, its one
// rule the API's refusal (a cursor or a `generation` of another publication → 409). The served publication moves
// from G1 to G2 between the page load and the click, as the worker's does; every row names the publication that
// served it (« Club 61 G2 », « Joueur 21 G2 »), so the page shows which one answered.
//
// Failure modes and expected outcomes:
//  The calendar (§ 88) reads one week at a time, its pages of 50 chained by their cursors (120 matches: 3 pages).
//  M0 /matchs: the week read at G1 (« Club 1 G1 » on its first day's first row), the strip counting 120 matches.
//  M1 The served publication moves to G2 after the first page of a week (state.moveAfter = 1); the next week's arrow:
//     its second page's cursor (G1) is refused (409) → the whole week shows at G2 (every row « … G2 », the strip
//     counting 120), never a mix of the two.
//  M2 Same page after the site's manifest re-read has landed (its new publication is G2): still that week and day,
//     G2 rows only — the calendar does not jump back to today.
//  M3 Nowhere on the page « Rechargez la première page », « La publication a changé », « … ont été actualisées »,
//     nor an error notice (role=alert, « Réessayer », « Données momentanément indisponibles »).
//  M4 The requests: page 1 at G1, the G1 cursor answered 409, then pages 1 to 3 read at G2 (no read mixing two).
//  U1 Variant, the publication does not settle: every fixtures read refused (409) after the move; the next week's
//     arrow → the strip stays, a neutral « Actualiser » button, no forbidden text, no alert.
//  U2 The API answers again; « Actualiser » → that week shows at G2 (« Club 1 G2 »), and stays so after the
//     manifest re-read.
//  J1 /joueurs (Performances, offset pages of 20 through useCompactRead), page 1 at G1, the API moves to G2,
//     « Suivants »: page 2 shows (« 2 / 3 », first row « Joueur 21 G2 »), no forbidden text, no alert; the page=2
//     read pinned to G1 answered 409 and the same page was read again without the pin (200).
//  J2 After the manifest re-read: still « 2 / 3 », G2 rows.
//  H1 Home (its manifest at G1, rendered by the server), the API moves to G2, « Joueur de la semaine » → the
//     « Performance du joueur » dialog shows the player (« Kylian Exemple », his club « Club 1 G2 »), no forbidden
//     text, no alert; every /api/read/performance request names no `generation` and answered 200.
//  P  M1–M3 and H1 on a phone too (390 × 844, touch); captures at 1440 and 390, deviceScaleFactor 1.
//  X1 No page error (uncaught exception) in any run. Console errors are recorded (the double answers 404 to the
//     match's events, shots and heat maps the dialog asks for: not checked here).
//
// Setup: the site built against the double's origin, then started (NEXT_PUBLIC_API_ORIGIN is frozen in the build):
//   cd dashboard && NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:8790 NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build frontend
//   node node_modules/next/dist/bin/next start frontend -p 3290 -H 127.0.0.1 &
// Run (the double is started by this script on the port given, default 8790; nothing else may listen there):
//   node tests/e2e/publication-changed.e2e.mjs http://127.0.0.1:3290 <evidence dir> [8790]
// It writes evidence.json (setup, expected, actual, requests, console) and the captures into the evidence dir; exit 1
// when a check fails.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startPublicationApi } from "./support/publication-api.mjs";

const [base = "http://127.0.0.1:3290", out = path.join(os.tmpdir(), "publication-changed-e2e"), port = "8790"] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const api = await startPublicationApi({ port: Number(port) });

const results = [], consoleLog = [], pageErrors = [], requests = {};
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(ok ? "PASS" : "FAIL", id, "—", String(JSON.stringify(actual ?? null)).slice(0, 300));
};
const reset = () => {
  api.state.moveAfter = 0;
  api.state.generation = "G1";
  api.state.manifestGeneration = null;
  api.state.refuse = new Set();
  api.log.length = 0;
};
const since = (mark, route) => api.log.slice(mark).filter((r) => !route || r.path === route);

const browser = await chromium.launch();
async function open(device, url) {
  const phone = device === "phone";
  const context = await browser.newContext({
    locale: "fr-FR", timezoneId: "Europe/Paris", colorScheme: "dark", deviceScaleFactor: 1,
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    isMobile: phone, hasTouch: phone,
  });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && consoleLog.push({ device, url, text: m.text().slice(0, 300) }));
  page.on("pageerror", (e) => pageErrors.push({ device, url, message: e.message.slice(0, 300) }));
  await page.goto(base + url, { waitUntil: "domcontentloaded" });
  // The consent banner covers the bottom of a phone's screen: declined, as a visitor would.
  await page.getByRole("button", { name: "Refuser" }).click({ timeout: 5000 }).catch(() => {});
  return { context, page };
}
// What the page says that it must not (M3, U1, J1, H1).
const complaints = (page, scope = "body") =>
  page.locator(scope).first().evaluate((root) => {
    const visible = (el) => el.getClientRects().length > 0;
    return {
      forbidden: (root.innerText.match(/Rechargez la première page|La publication a changé|ont été actualisées|Actualisez les données/gi) || []),
      alerts: [...root.querySelectorAll('[role="alert"], .notice-warning')].filter(visible).map((el) => el.innerText.slice(0, 160)),
      retry: [...root.querySelectorAll("button")].filter((b) => visible(b) && /^Réessayer$/.test(b.innerText.trim())).length,
      unavailable: /Données momentanément indisponibles/.test(root.innerText),
    };
  });
const clean = (c) => !c.forbidden.length && !c.alerts.length && !c.retry && !c.unavailable;
// The calendar: the chosen day, the strip's total and the teams of the day's rows (in order).
const matchesState = (page) =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll(".calendar-card .calendar-row")].map((row) => row.innerText.match(/Club \d+ G\d/g)?.join(" – ") || row.innerText.slice(0, 60));
    const total = [...document.querySelectorAll(".calendar-strip .calendar-day-count")].reduce((sum, n) => sum + (parseInt(n.textContent, 10) || 0), 0);
    return {
      day: document.querySelector('.calendar-strip .calendar-day[aria-current="date"]')?.getAttribute("href")?.match(/day=([\d-]+)/)?.[1] || null,
      week: document.querySelector(".calendar-week")?.textContent.trim() || null,
      total,
      rows: rows.length,
      first: rows[0] || null,
      g1: rows.filter((r) => /G1/.test(r)).length,
      g2: rows.filter((r) => /G2/.test(r)).length,
      actualiser: [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Actualiser"),
    };
  });
const waitFor = async (page, fn, timeout = 15000) => {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn().catch((e) => ({ error: e.message }));
    if (last && last.ok) return last;
    await page.waitForTimeout(150);
  }
  return last;
};
// The manifest re-read the recovery asks for, answered after `mark`; then a moment for React to apply it.
const manifestReread = async (page, mark) => {
  await waitFor(page, async () => ({ ok: since(mark, "/api/dashboard/manifest").some((r) => r.status === 200) }), 15000);
  await page.waitForTimeout(2500);
  return since(mark, "/api/dashboard/manifest").map((r) => ({ status: r.status, served: r.served }));
};

// ---------- M: the calendar's week, read by pages ----------
const nextWeek = (page) => page.locator('.calendar-strip .calendar-arrow[aria-label="Semaine suivante"]').click({ timeout: 10000 }).catch(() => {});
for (const device of ["desktop", "phone"]) {
  reset();
  const { context, page } = await open(device, "/matchs/");
  const first = await waitFor(page, async () => {
    const s = await matchesState(page);
    return { ...s, ok: s.total === 120 && s.rows > 0 && s.g1 === s.rows };
  });
  check(`M0 ${device}`, "the week at G1: the strip counts 120, the day's rows all « … G1 »", first, first?.ok);
  api.state.moveAfter = 1;
  api.state.moveTo = "G2";
  const mark = api.log.length;
  await nextWeek(page);
  const second = await waitFor(page, async () => {
    const s = await matchesState(page);
    return { ...s, ok: s.week !== first?.week && s.total === 120 && s.rows > 0 && s.g2 === s.rows };
  });
  check(`M1 ${device}`, "the next week at G2: the strip counts 120, every row « … G2 », none of G1", second, second?.ok);
  const manifests = await manifestReread(page, mark);
  const after = await matchesState(page);
  check(
    `M2 ${device}`,
    "after the manifest re-read (G2): the same week and day, G2 rows only",
    { ...after, manifests },
    after.week === second?.week && after.day === second?.day && after.rows > 0 && after.g1 === 0 && after.g2 === after.rows && manifests.some((m) => m.served === "G2"),
  );
  const said = await complaints(page);
  check(`M3 ${device}`, "no forbidden text, no alert, no « Réessayer », no « Données momentanément indisponibles »", said, clean(said));
  const fixtures = since(mark, "/api/fixtures").map((r) => ({ status: r.status, served: r.served, cursor: Boolean(r.query.cursor) }));
  requests[`M ${device}`] = since(mark);
  const refused = fixtures.findIndex((r) => r.status === 409);
  const afterRefusal = fixtures.slice(refused + 1).filter((r) => r.status === 200);
  check(
    `M4 ${device}`,
    "page 1 at G1, the G1 cursor refused (409), then pages 1 to 3 at G2",
    fixtures,
    fixtures[0]?.status === 200 && !fixtures[0].cursor && refused === 1 && fixtures[1].cursor &&
      afterRefusal.length >= 3 && !afterRefusal[0].cursor && afterRefusal.slice(0, 3).every((r) => r.served === "G2"),
  );
  await page.screenshot({ path: path.join(out, `calendar-g2-${device}.png`), fullPage: false });
  await context.close();
}

// ---------- U: the publication does not settle, then does ----------
{
  reset();
  const { context, page } = await open("desktop", "/matchs/");
  const shown = await waitFor(page, async () => {
    const s = await matchesState(page);
    return { ...s, ok: s.total === 120 && s.g1 === s.rows && s.rows > 0 };
  });
  api.state.generation = "G2";
  api.state.refuse = new Set(["fixtures"]);
  const mark = api.log.length;
  await nextWeek(page);
  const kept = await waitFor(page, async () => {
    const s = await matchesState(page);
    return { ...s, ok: s.actualiser };
  });
  await page.waitForTimeout(2500); // the manifest re-read lands; the notice must survive it
  const keptAfter = await matchesState(page);
  const said = await complaints(page);
  const strip = await page.locator(".calendar-strip .calendar-day").count();
  check(
    "U1 desktop",
    "the strip stays with a neutral « Actualiser »; no forbidden text, no alert",
    { shown: shown?.ok, kept, keptAfter, said, strip },
    kept?.ok && keptAfter.actualiser && strip === 7 && !said.forbidden.length && !said.alerts.length && !said.retry,
  );
  await page.screenshot({ path: path.join(out, "calendar-unsettled-desktop.png") });
  api.state.refuse = new Set();
  const mark2 = api.log.length;
  await page.getByRole("button", { name: "Actualiser" }).click();
  const recovered = await waitFor(page, async () => {
    const s = await matchesState(page);
    return { ...s, ok: s.total === 120 && s.rows > 0 && s.g2 === s.rows && s.first === "Club 1 G2 – Club 2 G2" && !s.actualiser };
  });
  await page.waitForTimeout(2500);
  const recoveredAfter = await matchesState(page);
  const said2 = await complaints(page);
  check(
    "U2 desktop",
    "« Actualiser » → the week at G2 (« Club 1 G2 – Club 2 G2 »), no « Actualiser », still so 2.5 s later; no forbidden text, no alert",
    { recovered, recoveredAfter, said: said2 },
    recovered?.ok && recoveredAfter.g2 === recoveredAfter.rows && recoveredAfter.rows > 0 && !recoveredAfter.actualiser && clean(said2),
  );
  requests["U desktop"] = { unsettled: since(mark, null).slice(0, mark2 - mark), recovery: since(mark2) };
  await page.screenshot({ path: path.join(out, "calendar-recovered-desktop.png") });
  await context.close();
}

// ---------- J: the players' list (useCompactRead, offset pages) ----------
{
  reset();
  const { context, page } = await open("desktop", "/joueurs/");
  const playersState = () =>
    page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Pagination des joueurs"]');
      const names = [...document.querySelectorAll("table tbody tr")].map((tr) => tr.innerText.match(/Joueur \d+ G\d/)?.[0]).filter(Boolean);
      return { label: nav?.querySelector("span")?.innerText || null, rows: names.length, first: names[0] || null, g1: names.filter((n) => /G1$/.test(n)).length };
    });
  const one = await waitFor(page, async () => {
    const s = await playersState();
    return { ...s, ok: s.label === "1 / 3" && s.first === "Joueur 01 G1" };
  });
  check("J0 desktop", "« 1 / 3 », first row « Joueur 01 G1 »", one, one?.ok);
  api.state.generation = "G2";
  const mark = api.log.length;
  await page.locator('nav[aria-label="Pagination des joueurs"]').getByRole("button", { name: "Suivants" }).click();
  const two = await waitFor(page, async () => {
    const s = await playersState();
    return { ...s, ok: s.label === "2 / 3" && s.first === "Joueur 21 G2" && s.g1 === 0 };
  });
  const said = await complaints(page);
  const reads = since(mark, "/api/read/players").map((r) => ({ status: r.status, page: r.query.page, generation: r.query.generation ?? null }));
  check(
    "J1 desktop",
    "« 2 / 3 », first row « Joueur 21 G2 », no G1 row; page=2 pinned to G1 → 409, then page=2 without the pin → 200; no forbidden text, no alert",
    { two, said, reads },
    two?.ok && clean(said) &&
      reads[0]?.status === 409 && reads[0].page === "2" && reads[0].generation === "G1" &&
      reads.some((r) => r.status === 200 && r.page === "2" && r.generation === null),
  );
  await page.screenshot({ path: path.join(out, "players-page2-desktop.png") });
  const manifests = await manifestReread(page, mark);
  const after = await playersState();
  requests["J desktop"] = since(mark);
  check("J2 desktop", "after the manifest re-read: still « 2 / 3 », « Joueur 21 G2 »", { ...after, manifests }, after.label === "2 / 3" && after.first === "Joueur 21 G2" && after.g1 === 0);
  await context.close();
}

// ---------- H: the home's « Performance du joueur » ----------
for (const device of ["desktop", "phone"]) {
  reset();
  const { context, page } = await open(device, "/");
  const potw = page.locator(".home-potw-id");
  await potw.waitFor({ timeout: 20000 });
  api.state.generation = "G2"; // the page's manifest (server-rendered) stays at G1
  const mark = api.log.length;
  await potw.click();
  const dialog = page.locator("dialog.modal[open]");
  const shown = await waitFor(page, async () => {
    const text = await dialog.innerText({ timeout: 1000 });
    return { text: text.slice(0, 300), ok: /Kylian Exemple/.test(text) && /Club 1 G2/.test(text) };
  });
  const said = await complaints(page, "dialog.modal[open]").catch((e) => ({ error: e.message }));
  const reads = since(mark, "/api/read/performance").map((r) => ({ status: r.status, generation: r.query.generation ?? null, query: r.query }));
  requests[`H ${device}`] = since(mark);
  check(
    `H1 ${device}`,
    "the dialog shows « Kylian Exemple », « Club 1 G2 »; no forbidden text, no alert; every performance read names no generation and answered 200",
    { shown, said, reads },
    shown?.ok && clean(said) && reads.length > 0 && reads.every((r) => r.generation === null && r.status === 200),
  );
  await page.screenshot({ path: path.join(out, `home-performance-${device}.png`) });
  await context.close();
}

check("X1", "no page error (uncaught exception) in any run", pageErrors, pageErrors.length === 0);

await browser.close();
await api.close();
const failed = results.filter((r) => !r.ok);
await writeFile(
  path.join(out, "evidence.json"),
  JSON.stringify(
    {
      script: "tests/e2e/publication-changed.e2e.mjs",
      setup: { base, api: api.origin, double: "tests/e2e/support/publication-api.mjs", ranAt: new Date().toISOString() },
      rerun: `node tests/e2e/publication-changed.e2e.mjs ${base} ${out} ${port}`,
      summary: { passed: results.length - failed.length, failed: failed.length },
      results,
      requests,
      pageErrors,
      console: consoleLog,
    },
    null,
    2,
  ),
);
console.log(`${results.length - failed.length}/${results.length} passed; evidence in ${out}`);
process.exit(failed.length ? 1 : 0);

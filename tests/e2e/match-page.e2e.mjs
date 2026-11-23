// E2E — the match page of issue #68: the previous / round / next bar and its picker, the line-ups,
// the player-on-this-match dialog, the shot tooltips, the pass network and the « Direct » view.
// Written from the design validated on 23 Nov 2026 (desktop and iPhone 15).
//
// Every expectation is read from the API for the match given (its league's and season's fixtures,
// its line-ups, shots and pass networks), so the file runs against another match or the public site.
// When the data cannot carry a check (the match alone in its list, no shots, no network, too few
// players to script a feed), the check is recorded as skipped with the reason, never passed.
// The live feed is off in production and locally: the Direct view runs on Playwright route mocks
// (the live config, the feed's state, a kick-off-only forecast, and the match's summary moved into
// its live window), the feed scripted here from the match's real team ids and line-up players.
//
// Failure modes and expected outcomes:
//  N1 The bar shows the previous and the next match of the API's fixture order (by round, then kick-off).
//  N2 Clicking « Match précédent » lands on that match and keeps the address's view.
//  N3 The picker opens on the current round, the current match marked aria-current.
//  N4 Searching the away team's name lists only that team's matches (all of them, in round order).
//  N5 A search that matches nothing says « Aucune équipe trouvée. ».
//  N6 Escape clears the search (the picker stays open); a second Escape closes the picker.
//  L1 At 1440 px the pitch is at most 900 px wide and the benches start to its right.
//  L2 At 393 px the benches are below the pitch and the page has no sideways scroll.
//  L3 Clicking a starter opens the dialog with that player's name; the address does not change.
//  D1 On the match's own page the dialog has « Fiche joueur » and no « Voir le match ».
//  D2 A player with shots (per the API) gets a « Tirs » block with the API's shot count.
//  D3 A player without shots gets no « Tirs » block.
//  D4 A row click in the Joueurs tab opens the dialog with that row's player.
//  D5 Enter on a pass-network node opens the dialog with that node's player.
//  T1 Hovering a shot on the shot map shows a role=tooltip with the shooter and an xG with a comma.
//  T2 Escape hides that tooltip.
//  T3 Same hover on « xG cumulés ».
//  T4 Escape hides that tooltip.
//  T5 Clicking a shot still opens the dialog of its shooter.
//  A1 The pass network is the second block of the Analyses tab (the first when there is no momentum).
//  A2 Focusing a network link shows a bubble whose two direction counts add up to its total.
//  V1 In play: « Direct » is the first tab, selected, with no view in the address.
//  V2 In play: the status reads « En direct · <minute>′ », the score is the feed's.
//  V3 The feed lists the events newest first, the half-time moment between the halves.
//  V4 A cancelled goal is struck and does not count in the score.
//  V5 The half-time moment carries the half-time score.
//  V6 The statistics card shows the feed's five values; the header KPI strip is gone.
//  V7 The win-probability chart is there ([data-chart="win-probability"]; its content is not checked).
//  V8 Half-time feed: the status reads « Mi-temps ».
//  V9 Finished feed: « Résultat provisoire » and a « Fin du match » moment with the final score.
//  V10 Shoot-out: « Tirs au but h–a » under the score and one mark per kick.
//  V13 Shoot-out: the win-probability chart runs to the 120th minute (a « 120′ » tick, the extra-time
//      lines) and its read-out ends on « Tirs au but 100 % », the kicks not being counted as goals.
//  V11 Feed disabled (enabled:false): no « Direct » tab, the usual default view (overview).
//  V12 Score family core: no « Direct » tab.
//  F1 A finished match that went to extra time, on its usual page (feed off, the read API's answer
//     mocked: a goal at the 98th): the overview's chart runs to the 120th (« 120′ » tick, the two
//     extra-time lines, « Prolongation »), its read-out ends on the winner at 100 % with « a.p. », and
//     « Après prolongation » stands under the score.
//  F2 The same after a shoot-out (0–0, 4–3 on penalties): « Tirs au but 4–3 » under the score, the
//     read-out ends on « Tirs au but 100 % » with « t.a.b. 4–3 ».
//  P1 Phone (iPhone 15, 393×852): no sideways scroll on Direct, line-ups, shots and the picker.
//  X1 No page error in the console during the run (failed loads of remote images and of the fake
//     live host excluded).
//
// Run (local front against the API it proxies, or the public site):
//   node tests/e2e/match-page.e2e.mjs <base url> <api base> <match id> <evidence dir>
// e.g. node tests/e2e/match-page.e2e.mjs http://127.0.0.1:3000 http://127.0.0.1:8765 m_08LEIz /tmp/match-page-e2e
// ONLY=N,L,D,T,A,V,F,P runs some sections (by the ids' letter). It writes evidence.json (setup,
// inputs, expected, actual, console) and screenshots, desktop and phone, into the evidence dir;
// exit code 1 when any check fails.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [base = "http://127.0.0.1:3000", api = base, id = "m_08LEIz", out = path.join(os.tmpdir(), "match-page-e2e")] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_CORE || "playwright");
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const want = (section) => !ONLY.length || ONLY.includes(section);

const results = [], consoleLog = [];
const check = (cid, expected, actual, ok) => {
  results.push({ id: cid, expected, actual, ok: Boolean(ok) });
  console.log(ok ? "PASS" : "FAIL", cid, "—", JSON.stringify(actual));
};
const skip = (cid, expected, reason) => {
  results.push({ id: cid, expected, actual: null, ok: null, skipped: reason });
  console.log("SKIP", cid, "—", reason);
};

// ---------------------------------------------------------------- the API's answers
const read = async (p) => {
  const response = await fetch(`${api}${p}`);
  if (!response.ok) return null;
  return response.json();
};
const summary = await read(`/api/matches/${encodeURIComponent(id)}/summary`);
const match = summary?.data?.match;
if (!match) throw new Error(`No summary for ${id} at ${api}`);
const family = async (name) => (await read(`/api/matches/${encodeURIComponent(id)}/${name}`))?.data ?? null;
const [lineups, shotsFamily, networkFamily, momentum] = await Promise.all(["lineups", "shots", "advanced/network", "momentum"].map(family));
const fixtures = [];
for (let cursor = null, guard = 0; guard < 40; guard++) {
  const q = new URLSearchParams({ league: match.leagueId, season: match.season, limit: "50" });
  if (cursor) q.set("cursor", cursor);
  const page = await read(`/api/fixtures?${q}`);
  fixtures.push(...(page?.data?.matches || page?.matches || []));
  cursor = page?.pagination?.nextCursor;
  if (!cursor) break;
}

// The season's order: rounds (numbered ones by number), each by kick-off.
const instant = (r) => { const t = Date.parse(r.time_utc || r.date || ""); return Number.isFinite(t) ? t : Infinity; };
const groups = new Map();
for (const r of fixtures) {
  const name = r.round_name != null ? String(r.round_name).trim() : "";
  if (!r.id || !name) continue;
  const key = `${r.has_playoff ? "playoff" : "regular"}:${name}`;
  if (!groups.has(key)) groups.set(key, { key, name, playoff: Boolean(r.has_playoff), matches: [] });
  groups.get(key).matches.push(r);
}
const rounds = [...groups.values()];
for (const g of rounds) { g.matches.sort((a, b) => instant(a) - instant(b)); g.first = instant(g.matches[0]); }
rounds.sort((a, b) => (a.playoff === b.playoff && /^\d+$/.test(a.name) && /^\d+$/.test(b.name) ? Number(a.name) - Number(b.name) : a.first - b.first));
const order = rounds.flatMap((g) => g.matches.map((m) => ({ m, g })));
const at = order.findIndex((x) => x.m.id === id);
const previous = at > 0 ? order[at - 1].m : null, next = at >= 0 ? order[at + 1]?.m || null : null;
const currentRound = at >= 0 ? order[at].g.key : null;
const awayId = match.away.id, awayName = match.away.name;
const awayMatches = order.filter((x) => x.m.home_team?.id === awayId || x.m.away_team?.id === awayId).map((x) => x.m.id);

// Shots by player (the dialog leaves out own goals and shots without a place).
const apiShots = (shotsFamily?.periods || []).flatMap((p) => p.shots || []);
const shotsOf = new Map();
for (const s of apiShots) if (s.player?.id && !s.is_own_goal && Number.isFinite(s.x) && Number.isFinite(s.y)) shotsOf.set(s.player.id, (shotsOf.get(s.player.id) || 0) + 1);
const starters = ["home", "away"].flatMap((side) => (lineups?.[side]?.starters || []).filter((p) => p.player_id && p.name && Number.isFinite(p.pitch_x) && Number.isFinite(p.pitch_y)).map((p) => ({ ...p, side })));
const shooter = [...starters].sort((a, b) => (shotsOf.get(b.player_id) || 0) - (shotsOf.get(a.player_id) || 0))[0];
const withShots = shooter && shotsOf.get(shooter.player_id) ? shooter : null;
const withoutShots = starters.find((p) => !shotsOf.get(p.player_id)) || null;
const networks = networkFamily?.networks || [];
const networkNames = new Set(networks.flatMap((n) => (n.nodes || []).map((x) => x.player?.name)).filter(Boolean));
const xgText = (v) => Number(v).toFixed(2).replace(".", ",");

// ---------------------------------------------------------------- the scripted feed
const H = match.home.id, A = match.away.id;
const hs = (lineups?.home?.starters || []).filter((p) => p.player_id).slice(1);
const as = (lineups?.away?.starters || []).filter((p) => p.player_id).slice(1);
const asub = (lineups?.away?.subs || []).find((p) => p.player_id);
const scriptable = hs.length >= 6 && as.length >= 4 && Boolean(asub);
const ev = (seq, type, minute, team, p, extra = {}) => ({
  seq, revision: seq, type, minute, minuteAdded: null, period: minute <= 45 ? "first_half" : "second_half", teamId: team,
  player: p?.player_id || null, relatedPlayer: null, playerName: p?.name || null, cancelled: false, ...extra,
});
const EVENTS = scriptable ? [
  ev(1, "yellow_card", 12, H, hs[0]),
  ev(2, "goal", 23, A, as[0], { relatedPlayer: as[1].player_id }),
  ev(3, "goal", 31, H, hs[1], { cancelled: true }),
  ev(4, "penalty_goal", 45, H, hs[2], { minuteAdded: 2 }),
  ev(5, "substitution", 56, A, asub, { relatedPlayer: as[0].player_id }),
  ev(6, "goal", 67, H, hs[3], { relatedPlayer: hs[4].player_id }),
  ev(7, "red_card", 80, A, as[2]),
] : [];
const teamStats = (h, a) => [
  { teamId: H, revision: 1, possessionPct: h[0], totalShots: h[1], shotsOnTarget: h[2], corners: h[3], fouls: h[4] },
  { teamId: A, revision: 1, possessionPct: a[0], totalShots: a[1], shotsOnTarget: a[2], corners: a[3], fouls: a[4] },
];
// [scorer, team, scored]: home 3, away 2.
const KICKS = scriptable ? [[hs[0], H, 1], [as[0], A, 1], [hs[1], H, 1], [as[1], A, 0], [hs[2], H, 0], [as[2], A, 1], [hs[3], H, 1]] : [];
const SCENES = {
  inplay: { status: "in_play", minute: 71, period: "second_half", score: [2, 1], seqs: [1, 2, 3, 4, 5, 6], elapsed: 90, stats: teamStats([46, 11, 5, 4, 9], [54, 9, 3, 5, 12]) },
  ht: { status: "half_time", minute: 45, period: "first_half", score: [1, 1], seqs: [1, 2, 3, 4], elapsed: 52, stats: teamStats([43, 7, 3, 3, 7], [57, 7, 2, 4, 8]) },
  ft: { status: "finished", minute: 90, minuteAdded: 5, period: "second_half", score: [2, 1], seqs: [1, 2, 3, 4, 5, 6, 7], elapsed: 118, stats: teamStats([48, 14, 6, 5, 12], [52, 10, 3, 6, 15]) },
  pens: { status: "in_play", minute: 120, period: "penalties", score: [1, 1], seqs: [2, 4], elapsed: 158, stats: teamStats([49, 17, 6, 7, 16], [51, 15, 5, 6, 18]),
    more: KICKS.map(([p, team, ok], i) => ev(20 + i, ok ? "penalty_goal" : "missed_penalty", 120, team, p, { period: "penalties" })) },
};
const liveState = (scene, families = { score: "live", events: "live", stats: "live" }) => {
  const f = SCENES[scene];
  const kickoff = new Date(Date.now() - f.elapsed * 60000).toISOString();
  return {
    kickoff,
    state: {
      match: id, revision: 40, provider: "e2e", status: f.status, provisional: f.status === "finished", minute: f.minute, minuteAdded: f.minuteAdded ?? null, period: f.period,
      score: { home: f.score[0], away: f.score[1] }, kickoffAt: kickoff, homeTeam: H, awayTeam: A, finishedAt: f.status === "finished" ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(), families, events: [...EVENTS.filter((e) => f.seqs.includes(e.seq)), ...(f.more || [])], stats: f.stats,
      expiresAt: new Date(Date.now() + 864e5).toISOString(),
    },
  };
};
let forecastPoints = [], timeline = null;
try {
  ({ timeline } = await import(new URL("../../dashboard/shared/inplay.js", import.meta.url)));
  forecastPoints = timeline(1.18, 1.42, [], { profile: [0.13, 0.14, 0.18, 0.16, 0.16, 0.16, 0.07], down: 0.6, up: 1.7, ahead: 0.9, behind: 1.1 }, -0.03, 0);
} catch { /* the chart's content is not checked */ }
// The read API's answer for a finished match that went to the 120th (rankings.mjs, liveProbability): the last point is the result.
const pastForecast = (goals, score, penalties) => {
  const points = timeline(1.18, 1.42, goals, forecast.inplay, forecast.rho, 120, true).map((q) => ({ ...q, home: +q.home.toFixed(4), draw: +q.draw.toFixed(4), away: +q.away.toFixed(4) }));
  Object.assign(points.at(-1), { home: score[0] > score[1] ? 1 : 0, draw: score[0] === score[1] ? 1 : 0, away: score[0] < score[1] ? 1 : 0 });
  return { ...forecast, status: "finished", extraTime: true, penalties, points, events: goals };
};
const forecast = { match: id, status: "not_started", rates: { home: 1.18, away: 1.42 }, inplay: { profile: [0.13, 0.14, 0.18, 0.16, 0.16, 0.16, 0.07], down: 0.6, up: 1.7, ahead: 0.9, behind: 1.1 }, rho: -0.03, model: { version: 2, fittedAt: "2026-11-01T03:00:00Z", matches: 1 }, points: forecastPoints, events: [] };

// ---------------------------------------------------------------- the browser
const browser = await chromium.launch();
const desktop = await browser.newContext({ locale: "fr-FR", viewport: { width: 1440, height: 900 } });
const phone = await browser.newContext({ locale: "fr-FR", ...devices["iPhone 15"], viewport: { width: 393, height: 852 } });
const phoneOverflow = {};
const IGNORED = /Failed to load resource|WebSocket|live\.invalid|ERR_NAME_NOT_RESOLVED/;
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function open(context, query = {}, live = null) {
  const page = await context.newPage();
  const tag = context === desktop ? "desktop" : "phone";
  page.on("console", (m) => m.type() === "error" && !IGNORED.test(m.text()) && consoleLog.push(`[${tag}] ${m.text().slice(0, 400)}`));
  page.on("pageerror", (e) => consoleLog.push(`[${tag}] pageerror ${e.message}`));
  if (live?.past) {
    await page.route("**/live/config", (r) => json(r, { enabled: false }));
    await page.route("**/api/forecasts/live?*", (r) => json(r, live.past));
    if (live.score) await page.route(`**/api/matches/${id}/summary*`, async (route) => {
      const body = await (await route.fetch()).json();
      body.data.match.home.score = live.score[0];
      body.data.match.away.score = live.score[1];
      await json(route, body);
    });
  } else if (live) {
    const { kickoff, state } = liveState(live.scene, live.families);
    await page.route("**/live/config", (r) => json(r, { enabled: live.enabled !== false, http: "live.invalid", realtime: "live.invalid", key: "e2e" }));
    await page.route(`**/live/matches/${id}`, (r) => json(r, state));
    await page.route("**/api/forecasts/live?*", (r) => json(r, forecast));
    await page.route(`**/api/matches/${id}/summary*`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const m = body.data.match;
      Object.assign(m, { status: "in_play", timeUtc: kickoff, date: kickoff.slice(0, 10), shots: [], stats: [], leadingPlayers: [], detailCollected: false });
      for (const side of ["home", "away"]) Object.assign(m[side], { score: null, xg: null, shots: null, shotsOnTarget: null, possession: null });
      await json(route, body);
    });
  }
  await page.goto(`${base}/matchs?${new URLSearchParams({ id, ...query })}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true }).catch(() => {});
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const idOf = (href) => { try { return new URL(href, base).searchParams.get("id"); } catch { return null; } };
const dialog = (page) => page.locator("dialog[open]");
const tabs = (page) => page.locator('[role="tablist"][aria-label="Analyse du match"] [role="tab"]');
const prime = (t) => String(t || "").replace(/\s+/g, " ").replace(/[’'′]/g, "′").trim();
async function section(name, fn) {
  if (!want(name)) return;
  try { await fn(); } catch (error) {
    check(`${name} aborted`, "the section runs to its end", error.message.split("\n")[0], false);
  }
}
async function playerDialog(page) {
  const d = dialog(page);
  await d.waitFor({ timeout: 60000 });
  await page.waitForFunction(() => { const x = document.querySelector("dialog[open]"); return x && x.getAttribute("aria-label") !== "Performance du joueur"; }, null, { timeout: 60000 }).catch(() => {});
  return d.getAttribute("aria-label");
}
async function closeDialog(page) {
  await page.keyboard.press("Escape");
  await dialog(page).waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
}
/** A shot mark nothing covers at its centre, so a hover reaches it and no other. */
async function topmostShot(scope) {
  const points = scope.locator('circle.shot-point[role="button"]');
  const n = await points.count();
  for (let i = 0; i < n; i++) {
    const p = points.nth(i);
    await p.scrollIntoViewIfNeeded();
    if (await p.evaluate((el) => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el; })) return p;
  }
  return null;
}
async function shotTooltip(page, scope, idT, idEsc, name) {
  const point = await topmostShot(scope);
  if (!point) { check(idT, "a shot mark to hover", "no uncovered shot mark", false); skip(idEsc, "Escape hides it", "no tooltip to hide"); return null; }
  const label = await point.getAttribute("aria-label");
  const shooterName = label.split(" · ")[0];
  await page.mouse.move(0, 0);
  await point.hover();
  const tip = page.locator('[role="tooltip"]');
  await tip.first().waitFor({ timeout: 5000 }).catch(() => {});
  const text = (await tip.first().textContent().catch(() => "")) || "";
  const xg = text.match(/xG\s*(\d+,\d{2})/)?.[1] || null;
  const apiXg = apiShots.filter((s) => s.player?.name === shooterName).map((s) => xgText(s.expected_goals));
  check(idT, { tooltip: true, name: shooterName, xgWithComma: true, xgOfApi: apiXg }, { tooltips: await tip.count(), text: text.slice(0, 120), xg },
    (await tip.count()) === 1 && text.includes(shooterName) && xg != null && apiXg.includes(xg));
  await shot(page, name);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const left = await tip.count();
  check(idEsc, "no tooltip after Escape (pointer still on the mark)", { tooltips: left, focused: await page.evaluate(() => document.activeElement?.tagName) }, left === 0);
  return point;
}

// ---------------------------------------------------------------- N: the bar and the picker
await section("N", async () => {
  const page = await open(desktop, { view: "stats" });
  const bar = page.locator('nav[aria-label="Matchs de la compétition"]');
  if (at < 0 || order.length < 2) {
    for (const n of ["N1", "N2", "N3", "N4", "N5", "N6"]) skip(n, "a season list with this match and another", at < 0 ? "the match is not in its season's named rounds" : "the match is alone in its list");
    await page.close();
    return;
  }
  await bar.waitFor({ timeout: 90000 });
  const prevLink = bar.locator('a[aria-label^="Match précédent"]'), nextLink = bar.locator('a[aria-label^="Match suivant"]');
  const shown = { previous: (await prevLink.count()) ? idOf(await prevLink.getAttribute("href")) : null, next: (await nextLink.count()) ? idOf(await nextLink.getAttribute("href")) : null };
  check("N1 previous and next of the fixture order", { previous: previous?.id || null, next: next?.id || null }, shown, shown.previous === (previous?.id || null) && shown.next === (next?.id || null));
  await shot(page, "desktop-nav");

  // The picker.
  await bar.locator('button[aria-haspopup="dialog"]').click();
  const picker = dialog(page);
  await picker.waitFor({ timeout: 10000 });
  const pressed = await picker.locator('[role="group"][aria-label="Journées"] button[aria-pressed="true"]').getAttribute("data-round").catch(() => null);
  const currentRows = await picker.locator('a[aria-current="page"]').evaluateAll((a) => a.map((x) => x.getAttribute("href")));
  check("N3 picker on the current round, current match marked", { round: currentRound, current: id }, { round: pressed, current: currentRows.map(idOf) },
    pressed === currentRound && currentRows.length === 1 && idOf(currentRows[0]) === id);
  await shot(page, "desktop-picker");
  const search = picker.getByRole("searchbox", { name: "Rechercher une équipe" });
  await search.fill(awayName);
  await page.waitForTimeout(300);
  const listed = (await picker.locator("ul a[href]").evaluateAll((a) => a.map((x) => x.getAttribute("href")))).map(idOf);
  check("N4 the away team's search lists its matches only", awayMatches, listed, JSON.stringify(listed) === JSON.stringify(awayMatches));
  await shot(page, "desktop-picker-search");
  await search.fill("zzqx wvvk");
  await page.waitForTimeout(300);
  const none = await picker.getByText("Aucune équipe trouvée.", { exact: true }).count();
  check("N5 nothing found", "« Aucune équipe trouvée. »", { message: none, rows: await picker.locator("ul a[href]").count() }, none === 1 && (await picker.locator("ul a[href]").count()) === 0);
  await search.focus();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const afterFirst = { value: await search.inputValue().catch(() => null), open: await dialog(page).count() };
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const afterSecond = { open: await dialog(page).count() };
  check("N6 Escape clears, a second Escape closes", { first: { value: "", open: 1 }, second: { open: 0 } }, { first: afterFirst, second: afterSecond },
    afterFirst.value === "" && afterFirst.open === 1 && afterSecond.open === 0);

  // Previous, keeping the view.
  if (!previous) skip("N2 previous keeps the view", "lands on the previous match with view=stats", "the match is the first of its list");
  else {
    await prevLink.click();
    await page.waitForURL((u) => new URL(u).searchParams.get("id") === previous.id, { timeout: 60000 }).catch(() => {});
    const url = new URL(page.url());
    const heading = page.locator(".match-scoreboard h1");
    await page.waitForFunction((name) => document.querySelector(".match-scoreboard h1")?.textContent.includes(name), previous.home_team?.name, { timeout: 60000 }).catch(() => {});
    const h1 = (await heading.textContent().catch(() => "")) || "";
    check("N2 previous keeps the view", { id: previous.id, view: "stats", heading: previous.home_team?.name }, { id: url.searchParams.get("id"), view: url.searchParams.get("view"), heading: h1.trim() },
      url.searchParams.get("id") === previous.id && url.searchParams.get("view") === "stats" && h1.includes(previous.home_team?.name || "\u0000"));
    await shot(page, "desktop-previous");
  }
  await page.close();
});

// ---------------------------------------------------------------- L and D: line-ups and the dialog
await section("L", async () => {
  if (!starters.length) {
    for (const n of ["L1", "L2", "L3", "D1", "D2", "D3"]) skip(n, "a line-up with placed starters", "the API has no line-up for this match");
    return;
  }
  const page = await open(desktop, { view: "lineups" });
  const bench = page.locator('section[aria-label^="Banc de"]').first();
  await bench.waitFor({ timeout: 90000 });
  const box = await bench.evaluate((el) => {
    const benches = el.parentElement, pitch = benches.previousElementSibling?.firstElementChild;
    const p = pitch.getBoundingClientRect(), b = benches.getBoundingClientRect();
    return { pitchWidth: Math.round(p.width), pitchRight: Math.round(p.right), benchLeft: Math.round(b.left), benchTop: Math.round(b.top), pitchBottom: Math.round(p.bottom) };
  });
  check("L1 1440 px: pitch ≤ 900 px, benches to its right", "pitchWidth ≤ 900, benchLeft ≥ pitchRight", box, box.pitchWidth > 0 && box.pitchWidth <= 900 && box.benchLeft >= box.pitchRight);
  await shot(page, "desktop-lineups");

  const pitch = page.locator('[class*="pitchCol"]').first();
  const marker = (p) => pitch.locator(`button[aria-label^="${p.name.replace(/"/g, '\\"')}"]`).first();
  const target = withShots || starters[0];
  const before = page.url();
  await marker(target).click();
  const name = await playerDialog(page);
  check("L3 a starter opens his dialog, the address unchanged", { name: target.name, url: before }, { name, url: page.url() }, name === target.name && page.url() === before);
  const d = dialog(page);
  await d.getByRole("link", { name: "Fiche joueur" }).waitFor({ timeout: 30000 }).catch(() => {});
  const links = { fiche: await d.getByRole("link", { name: "Fiche joueur" }).count(), voir: await d.getByRole("link", { name: /Voir le match/ }).count() };
  check("D1 on its own match: « Fiche joueur », no « Voir le match »", { fiche: 1, voir: 0 }, links, links.fiche === 1 && links.voir === 0);
  if (!withShots) skip("D2 the « Tirs » block, the API's count", "a starter with shots", "no starter has a placed shot in the API");
  else {
    const tirs = d.locator("section").filter({ has: page.locator("h4", { hasText: /^Tirs$/ }) });
    await tirs.first().waitFor({ timeout: 30000 }).catch(() => {});
    const text = (await tirs.first().textContent().catch(() => "")) || "";
    const count = Number(text.match(/(\d+)\s*tirs?(?![a-zé])/)?.[1] ?? NaN);
    check("D2 the « Tirs » block, the API's count", { player: target.name, shots: shotsOf.get(target.player_id) }, { blocks: await tirs.count(), shots: count }, (await tirs.count()) === 1 && count === shotsOf.get(target.player_id));
  }
  await shot(page, "desktop-dialog-shots");
  await closeDialog(page);
  if (!withoutShots) skip("D3 no « Tirs » block without shots", "a starter without shots", "every starter has shots");
  else {
    await marker(withoutShots).click();
    const other = await playerDialog(page);
    await d.locator('section[aria-label="Son match minute par minute"]').waitFor({ timeout: 30000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    const blocks = await d.locator("h4", { hasText: /^Tirs$/ }).count();
    check("D3 no « Tirs » block without shots", { player: withoutShots.name, blocks: 0 }, { player: other, blocks }, other === withoutShots.name && blocks === 0);
    await shot(page, "desktop-dialog-noshots");
    await closeDialog(page);
  }
  await page.close();

  const mobile = await open(phone, { view: "lineups" });
  const mBench = mobile.locator('section[aria-label^="Banc de"]').first();
  await mBench.waitFor({ timeout: 90000 });
  await mobile.waitForTimeout(500);
  const mBox = await mBench.evaluate((el) => {
    const benches = el.parentElement, pitch = benches.previousElementSibling?.firstElementChild;
    const p = pitch.getBoundingClientRect(), b = benches.getBoundingClientRect();
    return { pitchBottom: Math.round(p.bottom), benchTop: Math.round(b.top), pitchWidth: Math.round(p.width) };
  });
  const mOver = await overflow(mobile);
  check("L2 393 px: benches below the pitch, no sideways scroll", "benchTop ≥ pitchBottom, overflow 0", { ...mBox, overflow: mOver }, mBox.benchTop >= mBox.pitchBottom && mOver <= 0);
  phoneOverflow.lineups = mOver;
  await shot(mobile, "phone-lineups");
  await mobile.close();
});

await section("D", async () => {
  // From the Joueurs tab.
  let page = await open(desktop, { view: "players" });
  const row = page.locator(".match-view-panel table tbody tr").first();
  await row.waitFor({ timeout: 90000 }).catch(() => {});
  if (!(await row.count())) skip("D4 a Joueurs row opens its player", "a player row", "the Joueurs tab has no table for this match");
  else {
    const name = ((await row.locator("th").textContent()) || "").trim();
    await row.locator("td").last().click();
    const shown = await playerDialog(page);
    check("D4 a Joueurs row opens its player", name, shown, Boolean(shown) && name.includes(shown));
    await shot(page, "desktop-dialog-players");
  }
  await page.close();
  // From a pass-network node.
  if (!networks.length) { skip("D5 Enter on a network node opens its player", "a pass network", "the API has no pass network for this match"); return; }
  page = await open(desktop, { view: "analyses" });
  const node = page.locator('g[role="button"][aria-label*="passes données"]').first();
  await node.waitFor({ timeout: 90000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  const nodeName = ((await node.getAttribute("aria-label")) || "").split(" : ")[0];
  await node.scrollIntoViewIfNeeded();
  await node.focus();
  await page.keyboard.press("Enter");
  const shown = await playerDialog(page);
  check("D5 Enter on a network node opens its player", { name: nodeName, inApi: true }, { name: shown, inApi: networkNames.has(nodeName) }, shown === nodeName && networkNames.has(nodeName));
  await shot(page, "desktop-dialog-network");
  await page.close();
});

// ---------------------------------------------------------------- T: the shot tooltips
await section("T", async () => {
  if (!apiShots.length) {
    for (const n of ["T1", "T2", "T3", "T4", "T5"]) skip(n, "shots", "the API has no shot for this match");
    return;
  }
  const page = await open(desktop, { view: "shots" });
  const map = page.locator('svg[aria-label^="Carte des tirs"]');
  await map.locator("circle.shot-point").first().waitFor({ timeout: 90000 });
  await shotTooltip(page, map, "T1 shot map: tooltip with shooter and xG", "T2 shot map: Escape hides it", "desktop-shotmap-tooltip");
  await page.getByRole("button", { name: "xG cumulés", exact: true }).click();
  const timeline = page.locator("svg.xg-timeline");
  await timeline.locator("circle.shot-point").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(300);
  await shotTooltip(page, timeline, "T3 xG cumulés: tooltip with shooter and xG", "T4 xG cumulés: Escape hides it", "desktop-xg-tooltip");
  await page.getByRole("button", { name: "Carte des tirs", exact: true }).click();
  await map.locator("circle.shot-point").first().waitFor({ timeout: 30000 });
  const point = await topmostShot(map);
  const shooterName = ((await point?.getAttribute("aria-label")) || "").split(" · ")[0];
  const before = page.url();
  await point.click();
  const shown = await playerDialog(page);
  check("T5 clicking a shot opens its shooter", { name: shooterName, url: before }, { name: shown, url: page.url() }, shown === shooterName && page.url() === before);
  await shot(page, "desktop-shot-dialog");
  await closeDialog(page);
  await page.close();

  const mobile = await open(phone, { view: "shots" });
  await mobile.locator("circle.shot-point").first().waitFor({ timeout: 90000 });
  await mobile.waitForTimeout(500);
  phoneOverflow.shots = await overflow(mobile);
  await shot(mobile, "phone-shots");
  await mobile.close();
});

// ---------------------------------------------------------------- A: the Analyses tab
await section("A", async () => {
  if (!networks.length) {
    skip("A1 the pass network is the second block", "a pass network", "the API has no pass network for this match");
    skip("A2 a link's two directions add up to its total", "a pass network", "the API has no pass network for this match");
    return;
  }
  const page = await open(desktop, { view: "analyses" });
  const net = page.locator('svg[aria-label^="Réseau de passes"]').first();
  await net.waitFor({ timeout: 90000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  const expectedIndex = momentum?.points?.length ? 1 : 0;
  const blocks = await page.locator(".match-view-panel > div").first().evaluate((stack) =>
    [...stack.children].map((c) => (c.querySelector(".card-title")?.textContent || c.className || "").trim().slice(0, 40)));
  const index = blocks.findIndex((t) => /Réseaux de passes/.test(t));
  check("A1 the pass network is the second block", { index: expectedIndex, momentumInApi: Boolean(momentum?.points?.length) }, { index, blocks }, index === expectedIndex);
  const link = page.locator('line[tabindex="0"][aria-label*=" vers "]').first();
  const tip = page.locator('[role="tooltip"]');
  // Observed, not checked: a focus that has to scroll the page to reach the link.
  await page.evaluate(() => window.scrollTo(0, 0));
  await link.focus();
  await page.waitForTimeout(500);
  const bubbleAfterScrollingFocus = await tip.count();
  await page.locator("body").focus().catch(() => {});
  await page.evaluate(() => document.activeElement?.blur());
  await link.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await link.focus();
  await tip.first().waitFor({ timeout: 5000 }).catch(() => {});
  const bubble = await tip.first().evaluate((el) => ({ text: el.textContent, counts: [...el.querySelectorAll("b")].map((b) => b.textContent) })).catch(() => null);
  const total = Number(bubble?.text.match(/·\s*([\d\s  ]+)\s*passes/)?.[1].replace(/\D/g, "") ?? NaN);
  const counts = (bubble?.counts || []).map((c) => Number(c.replace(/\D/g, "")));
  check("A2 a link's two directions add up to its total", "two counts, a + b = total", { total, counts, text: bubble?.text?.slice(0, 120), bubbleAfterScrollingFocus },
    counts.length === 2 && Number.isFinite(total) && counts[0] + counts[1] === total);
  await shot(page, "desktop-analyses-link");
  await page.close();
});

// ---------------------------------------------------------------- V: the Direct view (mocked feed)
await section("V", async () => {
  if (!scriptable) {
    for (const n of ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11", "V12", "V13"]) skip(n, "a scripted feed", "the line-ups have too few players to script a feed (6 home and 4 away starters, 1 away substitute)");
    return;
  }
  // In play.
  let page = await open(desktop, {}, { scene: "inplay" });
  const liveView = page.locator("[data-live-view]");
  await liveView.waitFor({ timeout: 90000 });
  await liveView.locator("li[data-event]").first().waitFor({ timeout: 30000 });
  const first = { text: ((await tabs(page).first().textContent()) || "").trim(), selected: await tabs(page).first().getAttribute("aria-selected"), view: new URL(page.url()).searchParams.get("view") };
  check("V1 « Direct » first, selected, no view in the address", { text: "Direct", selected: "true", view: null }, first, first.text === "Direct" && first.selected === "true" && first.view === null);
  const scene = SCENES.inplay;
  const status = ((await page.locator(".match-status").textContent()) || "").trim();
  const live = await page.locator(".match-status.is-live").count();
  const score = ((await page.locator(".scoreboard-score").textContent()) || "").replace(/\s+/g, "");
  check("V2 status « En direct · 71′ », the feed's score", { status: `En direct · ${scene.minute}′`, isLive: 1, score: `${scene.score[0]}–${scene.score[1]}` }, { status, isLive: live, score },
    prime(status) === prime(`En direct · ${scene.minute}′`) && live === 1 && score === `${scene.score[0]}–${scene.score[1]}`);
  const feed = await liveView.locator('ol[aria-label^="Fil du match"] > li').evaluateAll((lis) => lis.map((li) => li.dataset.marker ? `marker:${li.dataset.marker}` : `${li.dataset.event}@${li.firstElementChild?.textContent.trim()}`));
  const evs = EVENTS.filter((e) => scene.seqs.includes(e.seq)).sort((a, b) => b.minute - a.minute || (b.minuteAdded ?? 0) - (a.minuteAdded ?? 0));
  const token = (e) => `${e.type}@${e.minute}${e.minuteAdded ? `+${e.minuteAdded}` : ""}′`;
  const expectedFeed = [...evs.filter((e) => e.period !== "first_half").map(token), "marker:half_time", ...evs.filter((e) => e.period === "first_half").map(token), "marker:kickoff"];
  check("V3 newest first, half-time between the halves", expectedFeed, feed, JSON.stringify(feed.map(prime)) === JSON.stringify(expectedFeed.map(prime)));
  const cancelled = EVENTS.find((e) => e.cancelled);
  const struckRow = liveView.locator('li[data-event="goal"]').filter({ hasText: cancelled.playerName });
  const struck = await struckRow.first().evaluate((li) => [li, ...li.querySelectorAll("*")].some((el) => getComputedStyle(el).textDecorationLine.includes("line-through"))).catch(() => null);
  check("V4 the cancelled goal is struck and not counted", { struck: true, score: `${scene.score[0]}–${scene.score[1]}`, ifCounted: `${scene.score[0] + 1}–${scene.score[1]}` }, { struck, score, rows: await struckRow.count() },
    struck === true && score === `${scene.score[0]}–${scene.score[1]}`);
  const ht = ((await liveView.locator('li[data-marker="half_time"]').textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  check("V5 the half-time moment carries 1–1", "Mi-temps 1–1", ht, /Mi-temps/.test(ht) && ht.includes("1–1"));
  const statsCard = liveView.locator("section.card").filter({ has: page.locator("h2.card-title", { hasText: /^Statistiques$/ }) });
  const values = await statsCard.locator("dd[aria-label]").evaluateAll((dds) => dds.map((dd) => parseFloat((dd.getAttribute("aria-label") || "").split(" : ").pop().replace(",", "."))));
  const expectStats = scene.stats[0] && ["possessionPct", "totalShots", "shotsOnTarget", "corners", "fouls"].flatMap((k) => [scene.stats[0][k], scene.stats[1][k]]);
  const kpis = await page.locator(".match-scoreboard .match-kpis").count();
  check("V6 the feed's five statistics, no KPI strip", { values: expectStats, kpis: 0 }, { values, kpis }, JSON.stringify(values) === JSON.stringify(expectStats) && kpis === 0);
  await liveView.locator('[data-chart="win-probability"]').first().waitFor({ timeout: 30000 }).catch(() => {});
  const chart = await liveView.locator('[data-chart="win-probability"]').count();
  check("V7 the win-probability chart is there", "≥ 1 [data-chart=win-probability]", chart, chart >= 1);
  await shot(page, "desktop-live-inplay");
  await page.close();

  // Half-time.
  page = await open(desktop, {}, { scene: "ht" });
  await page.locator("[data-live-view] li[data-event]").first().waitFor({ timeout: 90000 });
  const htStatus = ((await page.locator(".match-status").textContent()) || "").trim();
  check("V8 half-time: « Mi-temps »", "Mi-temps", htStatus, htStatus === "Mi-temps");
  await shot(page, "desktop-live-halftime");
  await page.close();

  // Finished.
  page = await open(desktop, {}, { scene: "ft" });
  await page.locator("[data-live-view] li[data-event]").first().waitFor({ timeout: 90000 });
  const ftStatus = ((await page.locator(".match-status").textContent()) || "").trim();
  const end = ((await page.locator('[data-live-view] li[data-marker="full_time"]').textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  const ftScore = `${SCENES.ft.score[0]}–${SCENES.ft.score[1]}`;
  check("V9 finished: « Résultat provisoire », « Fin du match »", { status: "Résultat provisoire", moment: `Fin du match ${ftScore}` }, { status: ftStatus, moment: end },
    ftStatus === "Résultat provisoire" && end.includes("Fin du match") && end.includes(ftScore));
  await shot(page, "desktop-live-finished");
  await page.close();

  // Shoot-out.
  page = await open(desktop, {}, { scene: "pens" });
  await page.locator("[data-live-view]").waitFor({ timeout: 90000 });
  await page.locator(".scoreboard-shootout").waitFor({ timeout: 30000 }).catch(() => {});
  const kicks = SCENES.pens.more;
  const made = (team) => kicks.filter((k) => k.teamId === team && k.type === "penalty_goal").length;
  const shootText = ((await page.locator(".scoreboard-shootout").textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  const marks = await page.locator("[data-live-view] section.card").filter({ has: page.locator("h2.card-title", { hasText: /^Tirs au but$/ }) }).locator("ol > li").count();
  check("V10 shoot-out: « Tirs au but h–a », one mark per kick", { text: `Tirs au but ${made(H)}–${made(A)}`, marks: kicks.length }, { text: shootText, marks },
    shootText === `Tirs au but ${made(H)}–${made(A)}` && marks === kicks.length);
  const chartBox = page.locator('[data-live-view] [data-chart="win-probability"]');
  await chartBox.locator("[data-extra-time]").waitFor({ timeout: 30000 }).catch(() => {});
  const extraLines = await chartBox.locator("[data-extra-time] line").count();
  const lastTick = prime(await chartBox.locator("text").filter({ hasText: /^120/ }).first().textContent().catch(() => ""));
  const readout = ((await page.locator("[data-live-view] [data-readout]").textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  check("V13 shoot-out: the chart runs to the 120th and ends on « Tirs au but 100 % »", { extraLines: 2, lastTick: "120′", readout: "… Tirs au but 100 % …" }, { extraLines, lastTick, readout },
    extraLines === 2 && lastTick === "120′" && /Tirs au but\s*100 %/.test(readout));
  await shot(page, "desktop-live-shootout");
  await page.close();

  // Feed disabled, then the score family taken over by the base.
  for (const [cid, live, name] of [["V11 feed disabled: no « Direct », the default view", { scene: "inplay", enabled: false }, "desktop-live-disabled"],
    ["V12 score family core: no « Direct »", { scene: "inplay", families: { score: "core", events: "live", stats: "live" } }, "desktop-live-core"]]) {
    const p = await open(desktop, {}, live);
    const served = p.waitForResponse((r) => r.url().includes(live.enabled === false ? "/live/config" : `/live/matches/${id}`), { timeout: 90000 }).catch(() => null);
    await tabs(p).first().waitFor({ timeout: 90000 });
    await served;
    await p.waitForTimeout(2500);
    const names = (await tabs(p).allTextContents()).map((t) => t.trim());
    const selected = ((await p.locator('[role="tab"][aria-selected="true"]').textContent()) || "").trim();
    check(cid, { direct: false, selected: "Vue d’ensemble", liveView: 0 }, { tabs: names, selected, liveView: await p.locator("[data-live-view]").count() },
      !names.includes("Direct") && selected === "Vue d’ensemble" && (await p.locator("[data-live-view]").count()) === 0);
    await shot(p, name);
    await p.close();
  }
});

// ---------------------------------------------------------------- F: a finished match that went to the 120th
await section("F", async () => {
  if (!timeline) {
    for (const n of ["F1", "F2"]) skip(n, "the shared in-play model", "dashboard/shared/inplay.js could not be loaded");
    return;
  }
  const chartOf = async (page) => {
    const chartBox = page.locator('[data-chart="win-probability"]').first();
    await chartBox.locator("[data-extra-time]").waitFor({ timeout: 90000 }).catch(() => {});
    return {
      liveView: await page.locator("[data-live-view]").count(),
      extraLines: await chartBox.locator("[data-extra-time] line").count(),
      lastTick: prime(await chartBox.locator("text").filter({ hasText: /^120/ }).first().textContent().catch(() => "")),
      period: ((await chartBox.locator("text").filter({ hasText: /^Prol/ }).first().textContent().catch(() => "")) || "").trim(),
      readout: ((await page.locator("[data-readout]").first().textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim(),
      note: ((await page.locator(".scoreboard-shootout").textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim(),
    };
  };
  const homeName = summary?.data?.match?.home?.name || "";
  // After extra time: 1–0, the goal at the 98th.
  let page = await open(desktop, {}, { past: pastForecast([{ minute: 98, added: 0, kind: "goal", side: "home" }], [1, 0], null), score: [1, 0] });
  let got = await chartOf(page);
  check("F1 finished after extra time: the usual page's chart runs to the 120th, « a.p. », « Après prolongation »",
    { liveView: 0, extraLines: 2, lastTick: "120′", period: "Prolongation", readout: `Fin · 1–0 a.p. … ${homeName} 100 % …`, note: "Après prolongation" }, got,
    got.liveView === 0 && got.extraLines === 2 && got.lastTick === "120′" && got.period === "Prolongation" && /^Fin · 1–0 a\.p\./.test(got.readout)
      && got.readout.includes(`${homeName}100 %`) && got.note === "Après prolongation");
  await page.locator('[data-chart="win-probability"]').first().scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, "desktop-finished-extra-time");
  await page.close();
  // After a shoot-out: 0–0, 4–3 on penalties.
  page = await open(desktop, {}, { past: pastForecast([], [0, 0], [4, 3]), score: [0, 0] });
  got = await chartOf(page);
  check("F2 finished after a shoot-out: « Tirs au but 4–3 », the chart ends on « Tirs au but 100 % »",
    { liveView: 0, extraLines: 2, lastTick: "120′", readout: "Fin · 0–0 · t.a.b. 4–3 … Tirs au but 100 % …", note: "Tirs au but 4–3" }, got,
    got.liveView === 0 && got.extraLines === 2 && got.lastTick === "120′" && /^Fin · 0–0 · t\.a\.b\. 4–3/.test(got.readout) && /Tirs au but\s*100 %/.test(got.readout) && got.note === "Tirs au but 4–3");
  await shot(page, "desktop-finished-shootout");
  await page.close();
});

// ---------------------------------------------------------------- P: phone
await section("P", async () => {
  if (scriptable) {
    const page = await open(phone, {}, { scene: "inplay" });
    await page.locator("[data-live-view] li[data-event]").first().waitFor({ timeout: 90000 });
    await page.waitForTimeout(500);
    phoneOverflow.live = await overflow(page);
    await shot(page, "phone-live");
    await page.close();
  }
  if (at >= 0 && order.length >= 2) {
    const page = await open(phone, {});
    const bar = page.locator('nav[aria-label="Matchs de la compétition"]');
    await bar.waitFor({ timeout: 90000 });
    await bar.locator('button[aria-haspopup="dialog"]').click();
    await dialog(page).waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    phoneOverflow.picker = await overflow(page);
    phoneOverflow.pickerInside = await dialog(page).evaluate((d) => Math.max(d.scrollWidth - d.clientWidth, Math.round(d.getBoundingClientRect().right - window.innerWidth)));
    await shot(page, "phone-picker");
    await page.close();
  }
  if (!want("L") && starters.length) {
    const page = await open(phone, { view: "lineups" });
    await page.locator('section[aria-label^="Banc de"]').first().waitFor({ timeout: 90000 });
    await page.waitForTimeout(500);
    phoneOverflow.lineups = await overflow(page);
    await shot(page, "phone-lineups");
    await page.close();
  }
  if (!want("T") && apiShots.length) {
    const page = await open(phone, { view: "shots" });
    await page.locator("circle.shot-point").first().waitFor({ timeout: 90000 });
    await page.waitForTimeout(500);
    phoneOverflow.shots = await overflow(page);
    await shot(page, "phone-shots");
    await page.close();
  }
  const views = ["live", "lineups", "shots", "picker"].filter((k) => k in phoneOverflow);
  const missing = ["live", "lineups", "shots", "picker"].filter((k) => !(k in phoneOverflow));
  check("P1 phone: no sideways scroll", { live: 0, lineups: 0, shots: 0, picker: 0, pickerInside: 0, notMeasured: [] }, { ...phoneOverflow, notMeasured: missing },
    views.length > 0 && missing.length === 0 && Object.values(phoneOverflow).every((v) => v <= 0));
});

check("X1 no page error", [], consoleLog, consoleLog.length === 0);
await browser.close();
const failed = results.filter((r) => r.ok === false);
const skipped = results.filter((r) => r.ok === null);
await writeFile(path.join(out, "evidence.json"), JSON.stringify({
  ranAt: new Date().toISOString(), base, api, match: id, only: ONLY,
  rerun: `${ONLY.length ? `ONLY=${ONLY.join(",")} ` : ""}node tests/e2e/match-page.e2e.mjs ${base} ${api} ${id} ${out}`,
  setup: "Live feed mocked with Playwright routes (live/config, live/matches/<id>, api/forecasts/live, the match summary moved to in_play inside its live window); everything else from the site and its API.",
  inputs: {
    match: { id, league: match.leagueId, season: match.season, round: match.roundName, home: match.home.name, away: match.away.name },
    order: { previous: previous?.id || null, next: next?.id || null, round: currentRound, awayMatches, fixtures: fixtures.length },
    lineups: { starters: starters.length, withShots: withShots && { name: withShots.name, shots: shotsOf.get(withShots.player_id) }, withoutShots: withoutShots?.name || null },
    shots: apiShots.length, networks: networks.length, momentum: momentum?.points?.length || 0,
    feed: { events: EVENTS, kicks: SCENES.pens.more, scenes: Object.fromEntries(Object.entries(SCENES).map(([k, v]) => [k, { ...v, more: undefined }])) },
  },
  results, console: consoleLog, passed: results.filter((r) => r.ok === true).length, failed: failed.length, skipped: skipped.length, total: results.length,
}, null, 2));
console.log(`${results.filter((r) => r.ok === true).length} passed, ${failed.length} failed, ${skipped.length} skipped of ${results.length} · evidence in ${out}`);
process.exit(failed.length ? 1 : 0);

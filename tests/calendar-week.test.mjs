// The calendar's week (FAILURE_MODES § 86): which day an address opens, how a week is read by pages, how a day is laid out.
import test from "node:test";
import assert from "node:assert/strict";
import {
  byDay,
  calendarPlace,
  coveredDay,
  dayTitle,
  fixtureState,
  groupByCompetition,
  readWeek,
  seasonBounds,
  sharedRound,
  weekFilters,
  weekTitle,
} from "../dashboard/frontend/src/services/calendar-week.js";

const manifest = {
  competitions: [],
  seasons: [
    {
      id: "2026/2027",
      chunks: [
        { leagueId: "l_3FJFUl", meta: { startDate: "2026-08-14", endDate: "2027-05-22" } },
        { leagueId: "l_0bfbkO", meta: { startDate: "2026-09-15", endDate: "2027-05-29" } },
      ],
    },
  ],
};

test("an address opens a week and a day, today kept within the season", () => {
  const bounds = seasonBounds(manifest, "2026/2027");
  assert.deepEqual(bounds, { start: "2026-08-14", end: "2027-05-29" });
  assert.deepEqual(calendarPlace({ day: "2026-11-24", today: "2026-11-27", bounds }), { week: { start: "2026-11-23", end: "2026-11-29" }, day: "2026-11-24", pick: false });
  // The former `week=`: today when in it, else its first day with matches (pick).
  assert.equal(calendarPlace({ week: "2026-11-23", today: "2026-11-27", bounds }).day, "2026-11-27");
  assert.deepEqual(calendarPlace({ week: "2026-11-30", today: "2026-11-27", bounds }), { week: { start: "2026-11-30", end: "2026-12-06" }, day: null, pick: true });
  assert.deepEqual(calendarPlace({ today: "2026-11-27", bounds }).day, "2026-11-27");
  // A season over: its last day's week, its first day with matches.
  const past = calendarPlace({ today: "2026-11-27", bounds: { start: "2025-08-15", end: "2026-05-24" } });
  assert.deepEqual(past, { week: { start: "2026-05-18", end: "2026-05-24" }, day: "2026-05-24", pick: true });
  assert.equal(calendarPlace({ day: "2026-02-30", today: "2026-11-27", bounds }).day, "2026-11-27");
});

test("a week is read from the Sunday before its Monday, by pages of 50, in the page's scope", () => {
  const filters = weekFilters({ manifest, season: "2026/2027", focus: "europe", range: { start: "2026-11-23", end: "2026-11-29" }, query: " PSG " });
  assert.equal(filters.status, "all");
  assert.equal(filters.from, "2026-11-22");
  assert.equal(filters.to, "2026-11-29");
  assert.equal(filters.limit, "50");
  assert.equal(filters.q, "PSG");
  assert.equal(filters.leagues.split(",").length, 10);
  assert.equal(weekFilters({ manifest, season: "2026/2027", focus: "all", league: "l_3FJFUl", range: { start: "2026-11-23", end: "2026-11-29" } }).league, "l_3FJFUl");
  // A league outside the Top 7 Europe + UEFA under that scope: nothing to read.
  assert.equal(weekFilters({ manifest, season: "2026/2027", focus: "europe", league: "l_0275VP", range: { start: "2026-11-23", end: "2026-11-29" } }), null);
});

// A fixtures API of `total` matches answering pages of 50 for `generation()`, refusing a cursor of another one.
function api(total, generation) {
  const calls = [];
  const fetcher = async (url) => {
    const q = new URL(url, "http://api.local").searchParams,
      g = generation(calls.length);
    calls.push({ cursor: q.get("cursor"), g });
    let offset = 0;
    if (q.get("cursor")) {
      const [cg, co] = q.get("cursor").split(":");
      if (cg !== g) return new Response(JSON.stringify({ error: { code: "PUBLICATION_CHANGED" } }), { status: 409 });
      offset = Number(co);
    }
    const matches = Array.from({ length: Math.min(50, total - offset) }, (_, i) => ({ id: `m_${offset + i}`, date: "2026-11-25", g }));
    const nextCursor = offset + 50 < total ? `${g}:${offset + 50}` : null;
    return new Response(JSON.stringify({ data: { matches }, pagination: { nextCursor, generation: g } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, fetcher };
}
const filters = { status: "all", from: "2026-11-22", to: "2026-11-29", limit: "50" };

test("a week follows its cursors to its end, within its pages", async () => {
  const { calls, fetcher } = api(120, () => "G1");
  const week = await readWeek(filters, { fetcher });
  assert.equal(week.matches.length, 120);
  assert.equal(week.complete, true);
  assert.equal(calls.length, 3);
  const cut = await readWeek(filters, { fetcher: api(500, () => "G1").fetcher, pages: 8 });
  assert.equal(cut.matches.length, 400);
  assert.equal(cut.complete, false);
  assert.equal(cut.last, "2026-11-25");
});

test("a publication changing during a week's pages reads the whole week again at the new one, once", async () => {
  // Page 1 at G1, then G2: the G1 cursor is refused, the week comes whole from G2.
  const { calls, fetcher } = api(120, (n) => (n === 0 ? "G1" : "G2"));
  const week = await readWeek(filters, { fetcher });
  assert.equal(week.generation, "G2");
  assert.equal(week.matches.length, 120);
  assert.ok(week.matches.every((m) => m.g === "G2"));
  assert.deepEqual(calls.map((c) => [Boolean(c.cursor), c.g]), [[false, "G1"], [true, "G2"], [false, "G2"], [true, "G2"], [true, "G2"]]);
  // Moving at every page: unsettled, never a mix.
  const restless = await readWeek(filters, { fetcher: api(120, (n) => `G${n}`).fetcher });
  assert.deepEqual(restless, { publicationUnsettled: true });
});

test("a match belongs to its Paris day; a cut read counts only the days it covered whole", () => {
  const week = { start: "2026-11-23", end: "2026-11-29" };
  const days = byDay(
    [
      { id: "a", time_utc: "2026-11-22T23:30:00Z", date: "2026-11-22" }, // Monday 00:30 in Paris
      { id: "b", time_utc: "2026-11-22T20:00:00Z", date: "2026-11-22" }, // Sunday before: another week
      { id: "c", time_utc: "2026-11-29T20:00:00Z", date: "2026-11-29" },
      { id: "c", time_utc: "2026-11-29T20:00:00Z", date: "2026-11-29" },
    ],
    week,
  );
  assert.deepEqual([...days.keys()], ["2026-11-23", "2026-11-29"]);
  assert.equal(days.get("2026-11-29").length, 1);
  assert.equal(coveredDay("2026-11-26", { complete: false, last: "2026-11-27" }), true);
  assert.equal(coveredDay("2026-11-27", { complete: false, last: "2026-11-27" }), false);
  assert.equal(coveredDay("2026-11-29", { complete: true }), true);
});

test("a row is over, in play, off or to come", () => {
  const now = Date.parse("2026-11-27T19:40:00Z");
  assert.equal(fixtureState({ status: "finished" }, now - 3e6, now), "over");
  assert.equal(fixtureState({ status: "not_started" }, now - 60e3 * 40, now), "live");
  assert.equal(fixtureState({ status: "in_play" }, now - 60e3 * 40, now), "live");
  assert.equal(fixtureState({ status: "not_started" }, now + 60e3, now), "upcoming");
  assert.equal(fixtureState({ status: "postponed" }, now + 60e3, now), "off");
  assert.equal(fixtureState({ status: "not_started" }, now - 5 * 3600e3, now), "stale");
});

test("a day's competitions: followed first, then the UEFA cups, the seven leagues and the others by name", () => {
  const entry = (id, league, round = "13") => ({ fixture: { id, league: { id: league }, round_name: round } });
  const groups = groupByCompetition(
    [entry("1", "l_3FJFUl"), entry("2", "l_0275VP"), entry("3", "l_4WFCIZ"), entry("4", "l_0bfbkO", "5"), entry("5", "l_zzzzzz"), entry("6", "l_4WFCIZ")],
    { name: (id) => ({ l_0275VP: "Ligue 2", l_zzzzzz: "Coupe de France" })[id] || id },
  );
  assert.deepEqual(groups.map((g) => g.id), ["l_0bfbkO", "l_4WFCIZ", "l_3FJFUl", "l_zzzzzz", "l_0275VP"]);
  assert.deepEqual(groupByCompetition([entry("1", "l_3FJFUl"), entry("3", "l_4WFCIZ")], { followed: new Set(["l_3FJFUl"]) }).map((g) => g.id), ["l_3FJFUl", "l_4WFCIZ"]);
  assert.equal(sharedRound(groups[1].entries), "13");
  assert.equal(sharedRound([entry("1", "x", "13"), entry("2", "x", "14")]), null);
});

test("the day's and the week's titles", () => {
  assert.equal(dayTitle("2026-11-27", "2026-11-27"), "Aujourd’hui 27 novembre");
  assert.equal(dayTitle("2026-11-24", "2026-11-27"), "Mardi 24 novembre");
  assert.equal(weekTitle({ start: "2026-11-23", end: "2026-11-29" }), "23 – 29 nov. 2026");
  assert.equal(weekTitle({ start: "2026-11-30", end: "2026-12-06" }), "30 nov. – 6 déc. 2026");
});

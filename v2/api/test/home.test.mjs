// Contract tests of /api/read/home (relational-home.js on main) on the seed of
// test/seed.py, with "now" pinned to Saturday 2025-09-06 12:00 UTC (context.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { context, get, skip } from "./context.mjs";
import { HOME_FEATURED_CLUBS, HOME_SIMPLE_LEAGUES, LATEST_WEEK_DAYS } from "../src/routes/home.mjs";
import { readFileSync } from "node:fs";

const home = "/api/read/home?season=2025/2026&leagues=all";
const KEYS = [
  "bestOfFeatured", "competitions", "defences", "featured", "hasSeasonPlayers", "highlights", "leaders", "others",
  "otherMatches", "period", "potw", "potwMatch", "potwRecent", "potwSeason", "raceOpen", "ranks", "resultCount", "results",
  "seasonProgress", "streak", "streakNext", "tables", "win", "yourPlayers",
].sort();

test("editorial lists are main's", () => {
  // Read as text: importing main's route would load its database client.
  const source = readFileSync(new URL("../../../dashboard/backend/services/relational-home.js", import.meta.url), "utf8");
  const list = (name) => JSON.parse(source.match(new RegExp(`export const ${name} = (\\[[^\\]]*\\])`))[1].replace(/,\s*\]/, "]"));
  assert.deepEqual(HOME_SIMPLE_LEAGUES, list("HOME_SIMPLE_LEAGUES"));
  assert.deepEqual(HOME_FEATURED_CLUBS, list("HOME_FEATURED_CLUBS"));
  assert.equal(LATEST_WEEK_DAYS, Number(source.match(/export const LATEST_WEEK_DAYS = (\d+);/)[1]));
});

test("home: the week, its featured match and player", { skip }, async () => {
  const { response, body } = await get(home);
  assert.equal(response.status, 200);
  const d = body.data;
  assert.deepEqual(Object.keys(d).sort(), KEYS);
  assert.deepEqual(d.period, { start: "2025-09-01", end: "2025-09-07", current: true, latest: false, asOf: context.now, asOfDay: "2025-09-06" });
  assert.equal(d.resultCount, 5);
  // Four most recent days of the week, latest first.
  assert.deepEqual(d.results.map((m) => m.id), ["m_aaaaa5", "m_aaaaa4", "m_aaaaa3", "m_aaaaa2"]);
  assert.deepEqual([d.results[0].stats, d.results[0].shots, d.results[0].coverage, d.results[0].players], [[], [], {}, []]);
  // The only match with shots, two top-three sides: the showcase.
  assert.equal(d.featured.id, "m_aaaaa1");
  assert.equal(d.featured.shots.length, 3);
  assert.ok(d.featured.stats.length > 0);
  assert.equal(d.bestOfFeatured.id, "m_aaaaa1:p_aaaab1");
  assert.equal(d.potw.id, "m_aaaaa4:p_aaaab4");
  assert.equal(d.potwMatch.id, "m_aaaaa4");
  assert.deepEqual(d.potwRecent.map((a) => a.id), ["m_aaaaa1:p_aaaab4", "m_aaaaa4:p_aaaab4"]);
  assert.deepEqual(d.others.map((a) => a.id), ["m_aaaaa1:p_aaaab1", "m_aaaaa2:p_aaaab3", "m_aaaaa1:p_aaaab2"]);
  assert.deepEqual(d.otherMatches.map((m) => m.id), ["m_aaaaa1", "m_aaaaa2"]);
  const s = d.potwSeason;
  assert.deepEqual([s.playerId, s.teamId, s.apps, s.minutes, s.goals, s.xa, s.lastId], ["p_aaaab4", "t_aaaaa2", 2, 160, 3, null, "m_aaaaa4:p_aaaab4"]);
  assert.ok(Math.abs(s.rating - 1212 / 160) < 1e-9 && Math.abs(s.xg - 2.3) < 1e-9);
  assert.equal(d.win, null); // no win by three goals or more
});

test("home: tables, ranks, leaders, highlights and markers", { skip }, async () => {
  const d = (await get(home)).body.data;
  assert.equal(d.tables.length, 1);
  const table = d.tables[0];
  assert.deepEqual([table.leagueId, table.played, table.games, table.teamCount], ["l_3FJFUl", 3, 6, 4]);
  assert.deepEqual(table.rows.map((r) => [r.id, r.rank, r.points]), [["t_aaaaa1", 1, 4], ["t_aaaaa3", 2, 4], ["t_aaaaa2", 3, 3], ["t_aaaaa4", 4, 2]]);
  assert.deepEqual(table.rows[0].results, ["W", "L", "D"]);
  assert.deepEqual(table.rows[0].cumulative, [3, 3, 4]);
  assert.deepEqual(d.ranks[0], ["t_aaaaa1", { id: "t_aaaaa1", rank: 1, leagueId: "l_3FJFUl", form: ["W", "L", "D"] }]);
  assert.deepEqual(d.leaders.goals.map((p) => [p.playerId, p.goals]), [["p_aaaab4", 3], ["p_aaaab1", 2]]);
  assert.deepEqual([d.leaders.rating, d.leaders.ratedMin], [[], 450]);
  assert.deepEqual(d.highlights.map((h) => [h.fixture.id, h.personal]), [["m_aaaaa6", 0]]);
  assert.equal(d.highlights[0].time, Date.parse("2025-09-06T19:00:00Z"));
  assert.equal(d.seasonProgress, 0.5);
  assert.deepEqual([d.streak, d.streakNext, d.defences, d.hasSeasonPlayers, d.raceOpen], [null, null, [], true, false]);
  assert.deepEqual(d.competitions, [{ id: "l_3FJFUl", name: "Ligue 1", country: "FRA", providerCountry: "FRA", imageUrl: "https://img.example/l1.png", seasons: [] }]);
});

test("home: your players this week (v2 doc, retained)", { skip }, async () => {
  assert.deepEqual((await get(home)).body.data.yourPlayers, []);
  const [mine] = (await get(home + "&personalPlayers=p_aaaab4")).body.data.yourPlayers;
  assert.deepEqual([mine.playerId, mine.name, mine.teamId, mine.team], ["p_aaaab4", "Cristiano Test", "t_aaaaa2", "Racing Club"]);
  assert.deepEqual(mine.matches.map((m) => [m.matchId, m.date, m.minutes, m.rating, m.goals, m.opponentId, m.score]), [
    ["m_aaaaa1", "2025-09-01", 70, 6.9, 0, "t_aaaaa1", [0, 2]],
    ["m_aaaaa4", "2025-09-04", 90, 8.1, 3, "t_aaaaa4", [3, 2]],
  ]);
  assert.deepEqual([mine.next.id, mine.next.time, mine.next.home.id, mine.next.away.id], ["m_aaaaa6", Date.parse("2025-09-06T19:00:00Z"), "t_aaaaa2", "t_aaaaa3"]);
});

test("home: favourites first, archive week, media representation", { skip }, async () => {
  assert.equal((await get(home + "&personalTeams=t_aaaaa3")).body.data.highlights[0].personal, 1);
  // A favourite player's club (his latest club match of the season).
  assert.equal((await get(home + "&personalPlayers=p_aaaab4")).body.data.highlights[0].personal, 1);
  assert.equal((await get(home + "&personalTeams=t_aaaaa1")).body.data.highlights[0].personal, 0);
  const archive = (await get(home + "&archive=1")).body.data.period;
  assert.deepEqual([archive.start, archive.current], ["2025-09-01", false]);
  const media = await get(home + "&media=1");
  assert.equal(media.response.status, 200);
  assert.match(media.response.headers.get("etag"), /^W\/"media-home-v2-/);
  assert.deepEqual(media.body.media, { "https://img.example/t1.png": "https://media.test/data/sources/v2/images/" + "ab".repeat(32) + ".png" });
  assert.equal(media.body.data.leaders.rating, undefined); // the compact cards drop the rating leaders
  for (const bad of ["&archive=2", "&personalTeams=bad", "&x=1"]) assert.equal((await get(home + bad)).response.status, 400, bad);
});

test("home: the latest played week stays while the new week has no result", { skip }, async () => {
  const saved = context.now;
  try {
    // Tuesday of the next week: no finished match yet, the last one is four days old.
    context.now = Date.parse("2025-09-09T12:00:00Z");
    const d = (await get(home)).body.data;
    assert.deepEqual([d.period.start, d.period.end, d.period.latest, d.period.asOfDay], ["2025-09-01", "2025-09-07", true, "2025-09-09"]);
    assert.equal(d.resultCount, 5);
    // Over LATEST_WEEK_DAYS later, the current (empty) week is shown.
    context.now = Date.parse("2025-09-24T12:00:00Z");
    const later = (await get(home)).body.data;
    assert.deepEqual([later.period.start, later.period.latest, later.resultCount], ["2025-09-22", false, 0]);
  } finally {
    context.now = saved;
  }
});

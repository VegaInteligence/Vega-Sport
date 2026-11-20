// GET /api/player-form?season=[&leagues=][&limit=] — the « En forme » tab of /joueurs (VI-39).
// Written before the route; expected behaviour:
//
// - Up and down: a player's last ten graded matches (20 minutes or more) of the scope, in two
//   windows of five. Each window's grade is the season grade's definition on its matches: the
//   grade of the minutes-weighted mean z, 100 / (1 + 10^(−z/4)). delta = last − before.
// - Eligible: ten such matches, at least 225 minutes in each window, the last within 30 days of
//   the scope's latest finished match (`as_of`). `up` holds the rises (delta > 0), the largest
//   first; `down` the falls (delta < 0), the largest first; a player at 0 is in neither.
//   `grades` are the ten match grades, oldest first.
// - Playing time: the last ten finished matches of the scope played by the player's latest club,
//   an absence counting 0 minutes; minutes of the last five against the five before. Kept when
//   the last five hold 180 minutes or more and the gap is 90 or more; never a player who played
//   for another club in those ten matches' span (a transfer is not a rise). `minutes` are the ten
//   matches' minutes, oldest first.
// - The scope is the page's: the season and its competitions (`leagues`); only finished matches.
// - limit: 1–50, 20 by default, for each list. A malformed season, leagues or limit: 400. A season
//   without matches: three empty lists.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";

const grade = (z) => Math.round(1000 / (1 + 10 ** (-z / 4))) / 10;

before(async () => {
  if (skip) return;
  const db = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await db.connect();
  try { await setup((sql, values) => db.query(sql, values)); } finally { await db.end(); }
});

async function setup(x) {
  // A second league (Ligue 2) for the scope; the seed's run for the grades.
  await x("INSERT INTO core.competitions(id,name,country_code,kind) VALUES (9201,'Ligue 2','FRA','league')");
  await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('competition','pitchapi','l_9ligu2',9201)");
  await x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,is_current) VALUES (9201,9201,2025,'2025/2026',true)");
  const [{ run }] = (await x("SELECT max(id) AS run FROM agg.power_runs")).rows;
  const players = [[201, "p_aaab21", "Monte Vite"], [202, "p_aaab22", "Baisse Fort"], [203, "p_aaab23", "Zéro Écart"],
    [204, "p_aaab24", "Trop Peu"], [205, "p_aaab25", "Petites Minutes"], [206, "p_aaab26", "Ancien Temps"],
    [207, "p_aaab27", "Ligue Deux"], [208, "p_aaab28", "Revient Fort"], [209, "p_aaab29", "Plus De Temps"],
    [210, "p_aaab30", "Transféré"], [211, "p_aaab31", "Court Retour"]];
  for (const [id, key, name] of players) {
    await x("INSERT INTO core.players(id,name) VALUES ($1,$2)", [id, name]);
    await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','pitchapi',$1,$2)", [key, id]);
  }
  // Ligue 1: twelve finished matches between clubs 1 and 2 (1–12 October 2025), match 313 not
  // played yet; Ligue 2: ten finished matches between clubs 3 and 4 (1–10 October). Three old
  // matches of clubs 3 and 4 in Ligue 1 (July).
  const match = (id, edition, home, away, date, status = "finished") =>
    x(`INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date,kickoff_at)
       VALUES ($1,$2,2025,'pitchapi',$3,$4,$5,$6,$7,$8,$9)`,
      [id, edition, status, home, away, status === "finished" ? 1 : null, status === "finished" ? 0 : null, date, `${date}T19:00:00Z`]);
  const day = (d) => `2025-10-${String(d).padStart(2, "0")}`;
  for (let i = 1; i <= 12; i++) await match(9300 + i, 1, 1, 2, day(i));
  await match(9313, 1, 1, 2, day(14), "not_started");
  for (let i = 1; i <= 10; i++) await match(9400 + i, 9201, 3, 4, day(i));
  for (let i = 1; i <= 10; i++) await match(9500 + i, 1, 3, 1, `2025-07-${String(i).padStart(2, "0")}`);
  const graded = (player, team, matchId, minutes, z) =>
    x(`INSERT INTO agg.player_match_grades(season_id,match_id,player_id,award_season,team_id,role,minutes,z,first_z,run_id)
       VALUES (2025,$1,$2,2025,$3,'central_midfielder',$4,$5,$5,$6)`, [matchId, player, team, minutes, z, run]);
  const played = (player, team, matchId, minutes) =>
    x(`INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played) VALUES (2025,$1,$2,$3,$4)`,
      [matchId, team, player, minutes]);
  for (let i = 3; i <= 12; i++) {
    const m = 9300 + i, late = i >= 8;
    // 201 rises (z 0 then 1), 202 falls (1 then −1), 203 stays at 0.
    await graded(201, 1, m, 90, late ? 1 : 0); await played(201, 1, m, 90);
    await graded(202, 1, m, 90, late ? -1 : 1); await played(202, 1, m, 90);
    await graded(203, 2, m, 90, 0); await played(203, 2, m, 90);
    // 205: ten matches of 30 minutes, 150 per window: too few.
    await graded(205, 2, m, 30, late ? 2 : 0); await played(205, 2, m, 30);
  }
  // 204: eight graded matches only.
  for (let i = 5; i <= 12; i++) await graded(204, 2, 9300 + i, 90, i >= 8 ? 2 : 0);
  // 208: eleven matches, one of ten minutes among the last five: it does not count, so his
  // windows are matches 302–306 and 307–312 without 310.
  for (let i = 2; i <= 12; i++) await graded(208, 1, 9300 + i, i === 10 ? 10 : 90, i >= 7 ? 2 : 0);
  // 206: ten graded matches, all in July: too long ago.
  for (let i = 1; i <= 10; i++) await graded(206, 3, 9500 + i, 90, i > 5 ? 3 : 0);
  // 207: Ligue 2 only, rising.
  for (let i = 1; i <= 10; i++) await graded(207, 3, 9400 + i, 90, i > 5 ? 0.5 : 0);
  // Playing time at club 1 (its last ten: 303–312): 209 absent then 90 (+450), 211 absent then
  // two 45s (90 in the last five: below 180), 210 played for club 2 in 303 then club 1.
  for (let i = 8; i <= 12; i++) await played(209, 1, 9300 + i, 90);
  await played(209, 1, 9307, 0);
  for (let i = 11; i <= 12; i++) await played(211, 1, 9300 + i, 45);
  await played(210, 2, 9303, 90);
  for (let i = 8; i <= 12; i++) await played(210, 1, 9300 + i, 90);
  // 201 played 90 throughout: no gap, not in the playing-time list.
}

const form = async (query = "") => get(`/api/player-form?season=2025/2026${query}`);
const ids = (list) => list.map((p) => p.id);

test("up and down: last five graded matches against the five before, on the grade scale", { skip }, async () => {
  const { response, body } = await form("&leagues=l_3FJFUl");
  assert.equal(response.status, 200);
  const { data } = body;
  assert.equal(data.as_of, "2025-10-12");
  assert.deepEqual(ids(data.up), ["p_aaab28", "p_aaab21"]);
  const up = Object.fromEntries(data.up.map((p) => [p.id, p]));
  assert.equal(up.p_aaab21.grade_before, grade(0));
  assert.equal(up.p_aaab21.grade_last, grade(1));
  assert.equal(up.p_aaab21.delta, Math.round((grade(1) - grade(0)) * 10) / 10);
  assert.equal(up.p_aaab21.name, "Monte Vite");
  assert.deepEqual(up.p_aaab21.team, { id: "t_aaaaa1", name: "Olympique Été" });
  assert.deepEqual(up.p_aaab21.grades, [0, 0, 0, 0, 0, 1, 1, 1, 1, 1].map(grade));
  // 208: the ten-minute match is left out of his ten.
  assert.equal(up.p_aaab28.grades.length, 10);
  assert.equal(up.p_aaab28.grade_before, grade(0));
  assert.deepEqual(ids(data.down), ["p_aaab22"]);
  assert.equal(data.down[0].delta, Math.round((grade(-1) - grade(1)) * 10) / 10);
});

test("a player at 0, on too few matches or minutes, or not seen for a month is in neither list", { skip }, async () => {
  const { data } = (await form("&leagues=l_3FJFUl")).body;
  const all = [...ids(data.up), ...ids(data.down)];
  for (const id of ["p_aaab23", "p_aaab24", "p_aaab25", "p_aaab26"]) assert.ok(!all.includes(id), id);
});

test("the competitions of the page bound every list", { skip }, async () => {
  assert.ok(!ids((await form("&leagues=l_3FJFUl")).body.data.up).includes("p_aaab27"));
  assert.ok(ids((await form("&leagues=l_9ligu2")).body.data.up).includes("p_aaab27"));
  const both = ids((await form("&leagues=l_3FJFUl,l_9ligu2")).body.data.up);
  assert.ok(both.includes("p_aaab27") && both.includes("p_aaab21"), both.join());
  // Every competition: the seed's cup final (May 2026) is the scope's latest match, so nobody
  // of October is recent enough.
  assert.deepEqual((await form()).body.data.up, []);
  const none = (await form("&leagues=none")).body.data;
  assert.deepEqual([none.up, none.down, none.minutes], [[], [], []]);
});

test("playing time: the club's last ten matches, an absence at 0, no transfer", { skip }, async () => {
  const { data } = (await form("&leagues=l_3FJFUl")).body;
  assert.deepEqual(ids(data.minutes), ["p_aaab29"]);
  const [row] = data.minutes;
  assert.equal(row.minutes_before, 0);
  assert.equal(row.minutes_last, 450);
  assert.equal(row.delta, 450);
  assert.deepEqual(row.minutes, [0, 0, 0, 0, 0, 90, 90, 90, 90, 90]);
  assert.deepEqual(row.team, { id: "t_aaaaa1", name: "Olympique Été" });
});

test("the limit cuts each list", { skip }, async () => {
  const { data } = (await form("&leagues=l_3FJFUl&limit=1")).body;
  assert.deepEqual(ids(data.up), ["p_aaab28"]);
});

test("malformed parameters are refused", { skip }, async () => {
  for (const path of ["/api/player-form", "/api/player-form?season=25", "/api/player-form?season=2025/2026&leagues=x",
    "/api/player-form?season=2025/2026&limit=0", "/api/player-form?season=2025/2026&limit=51", "/api/player-form?season=2025/2026&kind=up"])
    assert.equal((await get(path)).response.status, 400, path);
  const { response, body } = await get("/api/player-form?season=2030/2031");
  assert.equal(response.status, 200);
  assert.deepEqual([body.data.up, body.data.down, body.data.minutes], [[], [], []]);
});

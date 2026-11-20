// The national teams' results of the week on the home (/api/read/home, routes/home.mjs, sql/154): during the
// international break the strip shows them first (the user, 19 Nov 2026). A1–A5 of the expected behaviour, written
// before the code. The editions are written after the seed and before the tests; the next test file seeds again.
//
// The seed's week: Monday 1 to Sunday 7 September 2025, today Saturday 6 (context.mjs).
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";

const home = "/api/read/home?season=2025/2026&leagues=all";
// The three national editions: every international of the season, OpenLigaDB's Nations League, International
// Results' Nations League.
const EDITIONS = [
  [9301, "internationals", "nations-results:internationals:2025/2026"],
  [9302, "nations-league-a", "openligadb:nations-league:2025/2026"],
  [9303, "nations-league", "nations-results:nations-league:2025/2026"],
];
// (team, name, merged into, latest Elo, national: Burundi not yet marked)
const NATIONS = [
  [9301, "Germany", null, 1700], [9302, "Netherlands", null, 1650], [9303, "Argentina", null, 1750], [9304, "Costa Rica", null, 1450],
  [9305, "Burundi", null, null, false], [9306, "Chad", null, null],
  // OpenLigaDB's spelling of Germany, merged by the identity pass.
  [9307, "Deutschland", 9301, null],
];
// Eighteen sides for one crowded day (the cap of 8 a day).
const CROWD = Array.from({ length: 18 }, (_, i) => [9320 + i, `Nation ${String(i).padStart(2, "0")}`, null, 1400 + i]);
// (match, edition, round, home, away, home score, away score, day, status)
const MATCHES = [
  // A3: one match, two editions: OpenLigaDB's kept, with its teams as merged.
  [9301, 9302, null, 9307, 9302, 5, 0, "2025-09-05"],
  [9302, 9303, null, 9301, 9302, 5, 0, "2025-09-05"],
  [9303, 9301, "Friendly", 9303, 9304, 7, 0, "2025-09-05"],
  [9304, 9301, "African Cup of Nations qualification", 9305, 9306, 1, 0, "2025-09-05"],
  // A2: a side without an Elo counts as the week's weakest rated side (1400): (1650 + 1400) / 2 = 1525.
  [9311, 9301, "Friendly", 9302, 9306, 2, 0, "2025-09-05"],
  // …so above two weak rated sides: (1400 + 1401) / 2 = 1400.5.
  [9312, 9301, "Friendly", 9320, 9321, 0, 0, "2025-09-05"],
  // A1: not finished, after today, before the week: left out.
  [9305, 9301, "Friendly", 9306, 9305, null, null, "2025-09-06", "not_started"],
  [9306, 9301, "Friendly", 9304, 9303, 0, 2, "2025-09-07"],
  [9307, 9301, "Friendly", 9302, 9304, 3, 1, "2025-08-31"],
  // A2: the four latest days only (Monday 1 drops out).
  [9308, 9301, "Friendly", 9303, 9302, 1, 1, "2025-09-01"],
  [9309, 9301, "Friendly", 9302, 9303, 2, 2, "2025-09-02"],
  [9310, 9301, "Friendly", 9304, 9301, 0, 1, "2025-09-03"],
  // A2: nine on Thursday 4, eight kept, by the two sides' mean Elo.
  ...Array.from({ length: 9 }, (_, i) => [9320 + i, 9301, "Friendly", 9320 + 2 * i, 9321 + 2 * i, 1, 0, "2025-09-04"]),
];

let owner;
const ids = {};
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  const x = (sql, values) => owner.query(sql, values);
  for (const [id, name, key] of EDITIONS) {
    await x("INSERT INTO core.competitions(id,name,kind) VALUES ($1,$2,'international')", [id, name]);
    await x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,cup_key,cup_name) VALUES ($1,$1,2025,'2025/2026',$2,$3)", [id, key, name]);
  }
  const run = (await x("INSERT INTO agg.power_runs(kind,method_version,status) VALUES ('elo','seed-intl','published') RETURNING id")).rows[0].id;
  for (const [id, name, merged, elo, national = true] of [...NATIONS, ...CROWD]) {
    await x("INSERT INTO core.teams(id,name,is_national) VALUES ($1,$2,$3)", [id, name, national]);
    if (elo !== null)
      await x(
        `INSERT INTO agg.team_elo(match_id,team_id,season_id,kickoff_at,elo_before,elo_after,expected,result,run_id)
         VALUES (99999,$1,2025,'2025-08-20T19:00:00Z',1500,$2,0.5,1,$3)`,
        [id, elo, run],
      );
  }
  for (const [id, , merged] of NATIONS) if (merged) await x("UPDATE core.teams SET merged_into=$2 WHERE id=$1", [id, merged]);
  const rounds = new Map();
  for (const [id, edition, round, home, away, hs, as, day, status] of MATCHES) {
    let roundId = null;
    if (round) {
      const key = `${edition}:${round}`;
      if (!rounds.has(key))
        rounds.set(key, (await x("INSERT INTO core.rounds(competition_season_id,name) VALUES ($1,$2) RETURNING id", [edition, round])).rows[0].id);
      roundId = rounds.get(key);
    }
    await x(
      `INSERT INTO core.matches(id,competition_season_id,season_id,source,status,round_id,home_team_id,away_team_id,home_score,away_score,match_date)
       VALUES ($1,$2,2025,$3,$4,$5,$6,$7,$8,$9,$10::date)`,
      [id, edition, edition === 9302 ? "openligadb" : "international_results", status || (hs === null ? "not_started" : "finished"), roundId, home, away, hs, as, day],
    );
  }
  for (const { kind, id, key } of (await x(
    "SELECT 'match' kind,id,api.public_id('match',id) key FROM core.matches WHERE id BETWEEN 9301 AND 9399 UNION ALL SELECT 'team',id,api.public_id('team',id) FROM core.teams WHERE id BETWEEN 9301 AND 9399",
  )).rows)
    ids[`${kind}${id}`] = key;
});
after(() => owner?.end());

test("home: the week's national results, the latest day first, the strongest sides first", { skip }, async () => {
  const d = (await get(home)).body.data;
  // A5: the clubs' week is the seed's.
  assert.deepEqual(d.period.start, "2025-09-01");
  assert.deepEqual(d.results.map((m) => m.id), ["m_aaaaa5", "m_aaaaa4", "m_aaaaa3", "m_aaaaa2"]);
  const days = d.internationals.map((m) => m.date);
  // A1, A2: Friday 5, Thursday 4 (eight of nine), Wednesday 3, Tuesday 2; not Monday 1, not Saturday's unplayed
  // match, not Sunday's, not the previous week's.
  assert.deepEqual([...new Set(days)], ["2025-09-05", "2025-09-04", "2025-09-03", "2025-09-02"]);
  assert.equal(days.filter((day) => day === "2025-09-04").length, 8);
  // A2, A3: Friday: Germany–Netherlands (1675, OpenLigaDB's copy), Argentina–Costa Rica (1600), Netherlands–Chad
  // (1525: Chad unrated, as the weakest rated side), Nation 00–01 (1400.5), then Burundi–Chad (neither rated: 1400).
  const friday = d.internationals.filter((m) => m.date === "2025-09-05");
  assert.deepEqual(friday.map((m) => m.id), [ids.match9301, ids.match9303, ids.match9311, ids.match9312, ids.match9304]);
  // A4: the match as merged, its tournament.
  assert.deepEqual(friday[0], {
    id: ids.match9301, date: "2025-09-05", tournament: "UEFA Nations League",
    home: { id: ids.team9301, name: "Germany", score: 5, page: true }, away: { id: ids.team9302, name: "Netherlands", score: 0, page: true },
  });
  assert.deepEqual([friday[1].tournament, friday[4].tournament], ["Friendly", "African Cup of Nations qualification"]);
  // A side the identity pass has not marked national yet has no nation page to link to.
  assert.deepEqual([friday[4].home.page, friday[4].away.page], [false, true]);
  // Thursday: the eight strongest pairs, strongest first (the weakest pair, Nation 00–01, drops out).
  const thursday = d.internationals.filter((m) => m.date === "2025-09-04");
  assert.deepEqual(thursday.map((m) => m.home.name), [16, 14, 12, 10, 8, 6, 4, 2].map((i) => `Nation ${String(i).padStart(2, "0")}`));
});

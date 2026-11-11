// The home's title race (/api/read/home, routes/home.mjs) with a European cup: the
// Champions League's league phase has its table next to the leagues', before the other
// leagues of the race; its play-offs and knock-out ties never count, and the cup never
// gives the ranks, the streak or the season's progress, which stay the leagues'.
//
// The cup and a second league are written after the seed and before the tests; the next
// test file seeds again.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";

const home = "/api/read/home?season=2025/2026&leagues=all";
// A league of the title race outside the Top 7, whose name sorts before the cup's.
const SECOND = [9202, "Alpha Ligue", "l_0275VP"];
// (round, name, stage, has a play-off)
const ROUNDS = [
  [9101, "1", "regular"],
  [9102, "2", "regular"],
  [9103, "League Stage - Round 3", "regular"],
  [9104, "4", "regular"],
  [9105, "9", "playoff"],
  [9106, "1/8", "knockout"],
];
// (match, round, home, away, home score, away score, date, play-off); the seed's four clubs.
const CUP_MATCHES = [
  [9101, 9101, 3, 1, 2, 0, "2025-08-12"],
  [9102, 9101, 2, 4, 1, 1, "2025-08-12"],
  [9103, 9102, 4, 3, 0, 1, "2025-08-19"],
  [9104, 9102, 1, 2, 2, 1, "2025-08-19"],
  [9105, 9103, 3, 2, 3, 0, "2025-08-26"],
  [9106, 9103, 4, 1, 2, 2, "2025-08-26"],
  // The fourth round is ahead: on the calendar, not played.
  [9107, 9104, 1, 3, null, null, "2025-09-30"],
  [9108, 9104, 2, 4, null, null, "2025-09-30"],
  // A play-off and a knock-out tie: never in the table.
  [9109, 9105, 4, 3, 4, 0, "2025-08-28", true],
  [9110, 9106, 1, 2, 5, 0, "2025-08-29"],
];
// The second league's own clubs, one finished match each.
const SECOND_TEAMS = [9201, 9202, 9203, 9204];
const SECOND_MATCHES = [
  [9201, 9201, 9202, 1, 0, "2025-08-10"],
  [9202, 9203, 9204, 0, 0, "2025-08-10"],
];

let owner;
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  const x = (sql, values) => owner.query(sql, values);
  for (const [id, name, key] of [[9201, "Champions League", "l_0bfbkO"], SECOND]) {
    await x("INSERT INTO core.competitions(id,name,kind) VALUES ($1,$2,$3)", [id, name, id === 9201 ? "cup" : "league"]);
    await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('competition','pitchapi',$1,$2)", [key, id]);
    await x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,is_current) VALUES ($1,$1,2025,'2025/2026',true)", [id]);
  }
  // The curated list resolves its leagues when it is written: the seed's holds Ligue 1 only.
  await x("INSERT INTO core.editorial_lists(list_kind,entity_type,entity_id,seq) VALUES ('title_race_leagues','competition',$1,99)", [SECOND[0]]);
  for (const [id, name, stage] of ROUNDS)
    await x("INSERT INTO core.rounds(id,competition_season_id,name,stage) VALUES ($1,9201,$2,$3)", [id, name, stage]);
  const match = (id, edition, round, home, away, hs, as, date, playoff = false) =>
    x(
      `INSERT INTO core.matches(id,competition_season_id,season_id,source,status,round_id,has_playoff,home_team_id,away_team_id,home_score,away_score,match_date,kickoff_at)
       VALUES ($1,$2,2025,'pitchapi',$3,$4,$5,$6,$7,$8,$9,$10::date,$10::date + time '19:00')`,
      [id, edition, hs === null ? "not_started" : "finished", round, playoff, home, away, hs, as, date],
    );
  for (const [id, round, home, away, hs, as, date, playoff] of CUP_MATCHES) await match(id, 9201, round, home, away, hs, as, date, playoff);
  for (const id of SECOND_TEAMS) await x("INSERT INTO core.teams(id,name) VALUES ($1,$2)", [id, `Club ${id}`]);
  for (const [id, home, away, hs, as, date] of SECOND_MATCHES) await match(id, 9202, null, home, away, hs, as, date);
});
after(() => owner?.end());

test("home: the Champions League's league phase joins the title race", { skip }, async () => {
  const d = (await get(home)).body.data;
  // The Top 7, the European cups, then the other leagues of the race.
  assert.deepEqual(d.tables.map((t) => t.leagueId), ["l_3FJFUl", "l_0bfbkO", "l_0275VP"]);
  const cup = d.tables[1];
  // Its three played rounds (numbered or named), the fourth on the calendar.
  assert.deepEqual([cup.played, cup.games, cup.teamCount], [3, 4, 4]);
  assert.deepEqual(
    cup.rows.map((r) => [r.id, r.rank, r.points, r.difference, r.played]),
    [["t_aaaaa3", 1, 9, 6, 3], ["t_aaaaa1", 2, 4, -1, 3], ["t_aaaaa4", 3, 2, -1, 3], ["t_aaaaa2", 4, 1, -4, 3]],
  );
  assert.deepEqual([cup.rows[0].results, cup.rows[0].cumulative, cup.rows[0].streak], [["W", "W", "W"], [3, 6, 9], 3]);
  assert.deepEqual(cup.rows[1].cumulative, [0, 3, 4]);
});

test("home: the cup gives no rank, streak nor season progress", { skip }, async () => {
  const d = (await get(home)).body.data;
  const ranks = new Map(d.ranks);
  // The seed's clubs keep their Ligue 1 ranks, though the cup's id sorts first.
  assert.deepEqual(
    ["t_aaaaa1", "t_aaaaa2", "t_aaaaa3", "t_aaaaa4"].map((id) => [ranks.get(id).leagueId, ranks.get(id).rank]),
    [["l_3FJFUl", 1], ["l_3FJFUl", 3], ["l_3FJFUl", 2], ["l_3FJFUl", 4]],
  );
  // Three cup wins in a row are no streak of the home; half of Ligue 1 is played.
  assert.deepEqual([d.streak, d.seasonProgress], [null, 0.5]);
});

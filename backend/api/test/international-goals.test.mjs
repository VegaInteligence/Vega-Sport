// The scorers of the national matches from International Results (goalscorers.csv, sql/172, FAILURE_MODES.md §57),
// written before the code: 57o–57q. The edition, its matches and their goals are written after the seed and before the
// tests; the next test file seeds again.
//
// 57o: the nation page gives each match with goals `scorers: {complete, goals}`, the goals in minute order (a minute
//      unknown last); complete when each side's goals equal its score; a match without goals has no `scorers`.
// 57p: a goal linked to a player carries his public id (`player`), else no `player`.
// 57q: an International Results tournament's edition body carries the same `scorers` on its matches.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";

const SEASON = "2025/2026";
// (edition id, competition, cup key)
const EDITIONS = [
  [9401, "Matchs internationaux 2025/2026", "nations-results:internationals:2025/2026"],
  [9402, "Gold Cup 2025", "nations-results:gold-cup:2025"],
];
const NATIONS = [[9401, "France"], [9402, "Italy"], [9403, "Mexico"], [9404, "Dominican Republic"]];
// (match, edition, round, home, away, home score, away score, day)
const MATCHES = [
  [9401, 9401, "Friendly", 9401, 9402, 2, 1, "2025-09-05"], // complete
  [9402, 9401, "Friendly", 9402, 9401, 2, 0, "2025-10-10"], // partial: one goal of two
  [9403, 9401, "Friendly", 9401, 9402, 1, 1, "2025-11-13"], // no goal in the file
  [9404, 9402, null, 9403, 9404, 3, 2, "2025-06-15"], // complete, an own goal for the Dominican Republic
];
// (match, position, side, scorer, minute, own goal, penalty, assist, linked player)
const GOALS = [
  [9401, 1, "away", "Federico Chiesa", 70, false, false, null, null],
  [9401, 2, "home", "Kylian Mbappé", 12, false, true, null, 9401],
  [9401, 3, "home", "Ousmane Dembélé", null, false, false, "Kylian Mbappé", null],
  [9402, 1, "home", "Mateo Retegui", 33, false, false, null, null],
  [9404, 1, "home", "Raúl Jiménez", 12, false, true, null, null],
  [9404, 2, "away", "Johan Vásquez", 30, true, false, null, null],
  [9404, 3, "home", "Raúl Jiménez", 55, false, false, null, null],
  [9404, 4, "away", "Edarlyn Reyes", 70, false, false, null, null],
  [9404, 5, "home", "Alexis Vega", 90, false, false, null, null],
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
    await x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,cup_key,cup_name) VALUES ($1,$1,2025,$3,$2,$4)",
      [id, key, key.split(":").at(-1), name]);
  }
  for (const [id, name] of NATIONS) await x("INSERT INTO core.teams(id,name,is_national) VALUES ($1,$2,true)", [id, name]);
  await x("INSERT INTO core.players(id,name) VALUES (9401,'Kylian Mbappé')");
  const round = (await x("INSERT INTO core.rounds(competition_season_id,name) VALUES (9401,'Friendly') RETURNING id")).rows[0].id;
  for (const [id, edition, r, home, away, hs, as, day] of MATCHES) {
    await x(
      `INSERT INTO core.matches(id,competition_season_id,season_id,source,status,round_id,home_team_id,away_team_id,home_team_name,
         away_team_name,home_score,away_score,match_date)
       VALUES ($1,$2,2025,'international_results','finished',$3,$4,$5,$6,$7,$8,$9,$10::date)`,
      [id, edition, r ? round : null, home, away, NATIONS.find((n) => n[0] === home)[1], NATIONS.find((n) => n[0] === away)[1], hs, as, day],
    );
    const names = [home, away].map((t) => NATIONS.find((n) => n[0] === t)[1]);
    await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('match','international_results',$1,$2)",
      [`${day}|${names[0]}|${names[1]}`, id]);
  }
  for (const g of GOALS)
    await x(
      `INSERT INTO core.international_goals(match_id,position,side,scorer,minute,own_goal,penalty,assist,player_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, g,
    );
  for (const { kind, id, key } of (await x(
    `SELECT 'match' kind,id,api.public_id('match',id) key FROM core.matches WHERE id BETWEEN 9401 AND 9499
     UNION ALL SELECT 'team',id,api.public_id('team',id) FROM core.teams WHERE id BETWEEN 9401 AND 9499
     UNION ALL SELECT 'player',id,api.public_id('player',id) FROM core.players WHERE id = 9401
     UNION ALL SELECT 'competition',id,api.public_id('competition',id) FROM core.competitions WHERE id BETWEEN 9401 AND 9499`,
  )).rows)
    ids[`${kind}${id}`] = key;
});
after(() => owner?.end());

test("57o, 57p. the nation page gives a match's scorers and whether the list is complete", { skip }, async () => {
  const { response, body } = await get(`/api/nations/${ids.team9401}?season=${encodeURIComponent(SEASON)}`);
  assert.equal(response.status, 200);
  const byDate = new Map(body.data.matches.map((m) => [m.date, m]));
  const complete = byDate.get("2025-09-05").scorers;
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.goals, [
    { side: "home", name: "Kylian Mbappé", minute: 12, penalty: true, ownGoal: false, player: ids.player9401 },
    { side: "away", name: "Federico Chiesa", minute: 70, penalty: false, ownGoal: false },
    { side: "home", name: "Ousmane Dembélé", minute: null, penalty: false, ownGoal: false, assist: "Kylian Mbappé" },
  ]);
  assert.deepEqual(byDate.get("2025-10-10").scorers, {
    complete: false, goals: [{ side: "home", name: "Mateo Retegui", minute: 33, penalty: false, ownGoal: false }],
  });
  assert.equal("scorers" in byDate.get("2025-11-13"), false);
});

test("57q. an International Results tournament's edition carries its matches' scorers", { skip }, async () => {
  const { response, body } = await get(`/api/cups/edition?competition=${ids.competition9402}&season=2025`);
  assert.equal(response.status, 200);
  const [match] = body.matches;
  assert.equal(match.scorers.complete, true);
  assert.deepEqual(match.scorers.goals.map((g) => [g.side, g.name, g.minute, g.ownGoal, g.penalty]), [
    ["home", "Raúl Jiménez", 12, false, true], ["away", "Johan Vásquez", 30, true, false], ["home", "Raúl Jiménez", 55, false, false],
    ["away", "Edarlyn Reyes", 70, false, false], ["home", "Alexis Vega", 90, false, false],
  ]);
});

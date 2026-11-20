// GET /api/players/{id}/similar?season=&limit=[&maxAge=][&maxValue=] — the « Remplaçant » tab of
// /joueurs (VI-39). Written before the route; expected behaviour:
//
// - Without limit, maxAge or maxValue the answer is unchanged (players.test.mjs): the nearest
//   eight, 0 % included.
// - With any of them (the replacement read): the whole season's cohort is searched, the filters
//   are applied before the limit (1–50), and only the players closer than the median distance
//   are kept (a strict filter gives a short list, never players at 0 %). The similarity and
//   `compared` are still measured on the unfiltered cohort, so a filter never moves a score;
//   `matched` counts the players the filters keep, before the limit.
// - Each player, the reference included, carries `age` (on the season's last day, 30 June, or
//   today when sooner), `value_eur` and `value_date` (his latest valuation on that day, a
//   valuation the source no longer lists ignored), `grade` (the season grade over every
//   edition, from five graded matches) and `axes` (construction, création, percussion,
//   défense, finition: the mean of his stored league centiles in each family, read in the
//   league cohort where he played the most minutes; none for a goalkeeper or without a cohort).
// - A birth date of ours first, else the one of his linked profile (not when the link is in
//   quarantine).
// - maxAge keeps the players of that age or younger, never one without an age; maxValue
//   (euros) the players valued that much or less, never one without a value.
// - A malformed limit (0, 51, text), maxAge (outside 15–45) or maxValue: 400.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";

// (id, key, name, e1, e2, birth date): 101 is the reference at (0, 0).
const PEOPLE = [
  [105, "p_aaaab5", "Jeune Proche", 1, 0, "2004-01-01"],
  [113, "p_aaab13", "Sans Âge", 1.2, 0, null],
  [108, "p_aaaab8", "Sans Valeur", 0, 1.5, "2001-01-01"],
  [109, "p_aaaab9", "Valeur Absente", 2, 0, "2002-01-01"],
  [107, "p_aaaab7", "Date Liée", 0, 2.5, null],
  [106, "p_aaaab6", "Gardien Cher", 2.7, 0, "1999-01-01"],
  [110, "p_aaab10", "Loin Un", 20, 0, null],
  [111, "p_aaab11", "Loin Deux", 0, 30, null],
  [112, "p_aaab12", "Loin Trois", 40, 0, null],
  [114, "p_aaab14", "Loin Quatre", 50, 0, null],
];

before(async () => {
  if (skip) return;
  const db = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await db.connect();
  try { await setup((sql, values) => db.query(sql, values)); } finally { await db.end(); }
});

async function setup(x) {
  const zeros = Array(8).fill(0).join(",");
  for (const [id, key, name, e1, e2, birth] of PEOPLE) {
    await x("INSERT INTO core.players(id,name,birth_date) VALUES ($1,$2,$3)", [id, name, birth]);
    await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','pitchapi',$1,$2)", [key, id]);
    await x(`INSERT INTO agg.player_embeddings(season_id,player_id,minutes,women,e1,e2,e3,e4,e5,e6,e7,e8,e9,e10) VALUES (2025,$1,900,false,$2,$3,${zeros})`, [id, e1, e2]);
  }
  await x("UPDATE core.players SET birth_date='1996-01-01' WHERE id=101");
  // 107's birth date is his linked profile's; 113's link is in quarantine, so he has none.
  await x(`INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','transfermarkt','70007',107),('player','transfermarkt','70013',113)`);
  await x(`INSERT INTO core.provider_players(provider,provider_key,birth_date,read_on) VALUES ('transfermarkt','70007','2003-03-03','2026-06-01'),('transfermarkt','70013','2005-05-05','2026-06-01')`);
  await x(`INSERT INTO ops.provider_links(entity_type,provider,provider_key,entity_id,rule,quarantined_at,quarantine_reason)
           VALUES ('player','transfermarkt','70013',113,'test',now(),'test')`);
  // Values: 105's after the season's end is not his value of the season; 109's latest is no
  // longer listed (absent_since); 108 has none; 113's is hidden by his quarantined link.
  await x(`INSERT INTO core.player_market_values(player_id,valued_at,value_eur,source,as_of,absent_since) VALUES
           (105,'2026-01-10',20000000,'transfermarkt','2026-06-01',NULL),
           (105,'2026-09-01',99000000,'transfermarkt','2026-09-02',NULL),
           (109,'2025-05-01',12000000,'transfermarkt','2026-06-01',NULL),
           (109,'2026-05-01',30000000,'transfermarkt','2026-06-01','2026-06-15'),
           (107,'2026-02-01',10000000,'transfermarkt','2026-06-01',NULL),
           (106,'2026-03-01',80000000,'transfermarkt','2026-06-01',NULL),
           (113,'2026-02-01',5000000,'transfermarkt','2026-06-01',NULL)`);
  // Season grade: 105 on six matches at z = 1 (64.0); 108 on four (too few: none).
  await x(`INSERT INTO agg.player_grade_editions(season_id,competition_season_id,player_id,grade_count,grade_minutes,zm_sum) VALUES
           (2025,1,105,6,540,540),(2025,1,108,4,360,360)`);
  // Centiles: 101 and 105 in a midfielders' league cohort; 105 also in a smaller one (300
  // minutes there) that must not be read; 106 a goalkeeper.
  const cohort = async (id, group) =>
    x(`INSERT INTO agg.cohorts(id,key,entity_type,label,season_id,universe,stat_scope,position_group,min_minutes,size)
       VALUES ($1,$2,'player','t',2025,'league','league',$3,450,30)`, [id, `test-${id}`, group]);
  await cohort(9001, "M"); await cohort(9002, "M"); await cohort(9003, "G");
  const CENTILES = { accurate_passes: 80, pass_completion: 70, touches: 60, assists: 50, chances_created: 40, big_chances_created: 30,
    dribbles_succeeded: 90, passes_into_final_third: 70, tackles: 20, interceptions: 40, goals: 10, xg: 30 };
  for (const [cohortId, player, minutes, shift] of [[9001, 101, 900, 0], [9001, 105, 900, 5], [9002, 105, 300, -50], [9003, 106, 900, 0]])
    for (const [metric, centile] of Object.entries(CENTILES))
      await x(`INSERT INTO agg.player_percentiles(cohort_id,player_id,metric_key,value_p90,covered_minutes,percentile)
               VALUES ($1,$2,$3,1,$4,$5)`, [cohortId, player, metric, minutes, Math.max(0, centile + shift)]);
}

const read = async (query) => get(`/api/players/p_aaaab1/similar?season=2025/2026&${query}`);
const ids = (body) => body.data.similar.map((p) => p.id);

test("the replacement read searches the whole cohort, closest first, closer than the median", { skip }, async () => {
  const { response, body } = await read("limit=40");
  assert.equal(response.status, 200);
  const { data } = body;
  // 12 players compared (104 is in a women's competition); median distance (2.7 + 5) / 2.
  assert.equal(data.compared, 12);
  assert.equal(data.matched, 6);
  assert.deepEqual(ids(body), ["p_aaaab5", "p_aaab13", "p_aaaab8", "p_aaaab9", "p_aaaab7", "p_aaaab6"]);
  assert.deepEqual(data.similar.map((p) => p.similarity), [74, 69, 61, 48, 35, 30]);
});

test("each player carries his age, his value of the season, his grade and his axes", { skip }, async () => {
  const { data } = (await read("limit=40")).body;
  const by = Object.fromEntries(data.similar.map((p) => [p.id, p]));
  // Ages on 30 June 2026.
  assert.equal(data.reference.id, "p_aaaab1");
  assert.equal(data.reference.age, 30);
  assert.equal(by.p_aaaab5.age, 22);
  assert.equal(by.p_aaaab7.age, 23, "the linked profile's birth date");
  assert.equal(by.p_aaab13.age, undefined, "a quarantined link gives no birth date");
  assert.equal(by.p_aaaab5.value_eur, 20000000, "the valuation after the season is not his");
  assert.equal(by.p_aaaab5.value_date, "2026-01-10");
  assert.equal(by.p_aaaab9.value_eur, 12000000, "a valuation no longer listed is ignored");
  assert.equal(by.p_aaaab8.value_eur, undefined);
  assert.equal(by.p_aaaab5.grade, 64);
  assert.equal(by.p_aaaab8.grade, undefined, "four graded matches are too few");
  assert.deepEqual(data.reference.axes, { construction: 70, creation: 40, percussion: 80, defense: 30, finishing: 20 });
  assert.deepEqual(by.p_aaaab5.axes, { construction: 75, creation: 45, percussion: 85, defense: 35, finishing: 25 }, "the cohort of most minutes");
  assert.equal(by.p_aaaab6.axes, undefined, "a goalkeeper has no axes");
  assert.equal(by.p_aaaab9.axes, undefined, "no cohort, no axes");
});

test("maxAge keeps the players of that age or younger, never one without an age", { skip }, async () => {
  const { body } = await read("limit=40&maxAge=25");
  assert.deepEqual(ids(body), ["p_aaaab5", "p_aaaab8", "p_aaaab9", "p_aaaab7"]);
  assert.equal(body.data.matched, 4);
  // The scores do not move with the filter.
  assert.deepEqual(body.data.similar.map((p) => p.similarity), [74, 61, 48, 35]);
  assert.equal(body.data.compared, 12);
});

test("maxValue keeps the players valued that much or less, never one without a value", { skip }, async () => {
  const { body } = await read("limit=40&maxValue=25000000");
  // 113 (hidden value) and 108 (none) are left out, 106 (80 M€) is above.
  assert.deepEqual(ids(body), ["p_aaaab5", "p_aaaab9", "p_aaaab7"]);
  const both = (await read("limit=40&maxValue=25000000&maxAge=22")).body;
  assert.deepEqual(ids(both), ["p_aaaab5"]);
});

test("the limit cuts after the filters; matched counts before it", { skip }, async () => {
  const { body } = await read("limit=2");
  assert.deepEqual(ids(body), ["p_aaaab5", "p_aaab13"]);
  assert.equal(body.data.matched, 6);
});

test("the read without replacement parameters is unchanged", { skip }, async () => {
  const { data } = (await get("/api/players/p_aaaab1/similar?season=2025/2026")).body;
  assert.equal(data.similar.length, 8);
  assert.equal(data.reference, undefined);
  assert.equal(data.matched, undefined);
});

test("malformed replacement parameters are refused", { skip }, async () => {
  for (const query of ["limit=0", "limit=51", "limit=ten", "limit=40&maxAge=14", "limit=40&maxAge=46", "limit=40&maxAge=2x",
    "limit=40&maxValue=0", "limit=40&maxValue=-5", "limit=40&maxValue=1e6", "limit=40&other=1"])
    assert.equal((await read(query)).response.status, 400, query);
});

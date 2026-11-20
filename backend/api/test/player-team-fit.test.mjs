// « Remplaçant » ranks by compatibility with the replaced player's team (VI-40). Written before the
// read; method and edge cases: docs/calculs/05-joueurs/13-remplacant-compatibilite-equipe.md.
//
// Expected behaviour of /api/players/{id}/similar in replacement mode (limit, maxAge or maxValue):
// - The 300 closest in profile (closer than the median, after the filters), less the players whose
//   main club is the replaced player's (agg.player_team_fit), are ranked by `fit.score`:
//   Σ weight × component ÷ Σ weights of the known components, weights profile 40, role 20, style 15,
//   defense 10, effort 10, discipline 5; then less 0.15 per point of league gap beyond 50, when the
//   candidate's league is weaker (`levelGap`, returned only then: a gap of 50 or less costs nothing). Ties: the closer profile first.
// - profile = the similarity; role = 100 − mean |Δ role centile| on the shares both have (4 or
//   more); style = 100 − mean |Δ centile| of the two clubs on the style axes both have (5 or more),
//   each club in the league edition where it has the most matches; defense, effort, discipline =
//   100 − max(0, replaced − candidate). An unknown component is null and leaves the score.
// - `reference` and each candidate carry `context`: his club, his shares, defensive work, effort,
//   discipline figures and his club's style, for the comparison panel.
// - The read without the replacement parameters is unchanged (players.test.mjs).
import { before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";

const AXES = ["possession_pct", "field_tilt_pct", "directness_pct", "ppda_approx", "crosses_pm", "set_share_pct", "def_actions_adj", "xg_pm", "xga_pm", "pass_accuracy_pct"];
// (id, key, name, e1, e2): 101 (0, 0) is the replaced player, as in player-replacements.test.mjs.
const PEOPLE = [
  [105, "p_aaaab5", "Jeune Proche", 1, 0], [113, "p_aaab13", "Ligue Faible", 1.2, 0], [108, "p_aaaab8", "Coéquipier", 0, 1.5],
  [109, "p_aaaab9", "Peu De Parts", 2, 0], [107, "p_aaaab7", "Sans Ligne", 0, 2.5], [106, "p_aaaab6", "Gardien", 2.7, 0],
  [110, "p_aaab10", "Loin Un", 20, 0], [111, "p_aaab11", "Loin Deux", 0, 30], [112, "p_aaab12", "Loin Trois", 40, 0], [114, "p_aaab14", "Loin Quatre", 50, 0],
];
// Team-fit rows: (player, club, role centiles ×6, defensive, effort, discipline).
const FIT = [
  [101, 1, [50, 50, 50, 50, 50, 50], 70, null, 80],
  [105, 2, [60, 60, 60, 60, 60, 60], 60, null, 90],
  [108, 1, [50, 50, 50, 50, 50, 50], 70, null, 80],
  [109, 3, [50, 50, 50, null, null, null], 80, null, 50],
  [113, 4, [50, 50, 50, 50, 50, 50], 70, null, 80],
];

before(async () => {
  if (skip) return;
  const db = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await db.connect();
  try { await setup((sql, values) => db.query(sql, values)); } finally { await db.end(); }
});

async function setup(x) {
  const zeros = Array(8).fill(0).join(",");
  for (const [id, key, name, e1, e2] of PEOPLE) {
    await x("INSERT INTO core.players(id,name) VALUES ($1,$2)", [id, name]);
    await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','pitchapi',$1,$2)", [key, id]);
    await x(`INSERT INTO agg.player_embeddings(season_id,player_id,minutes,women,e1,e2,e3,e4,e5,e6,e7,e8,e9,e10) VALUES (2025,$1,900,false,$2,$3,${zeros})`, [id, e1, e2]);
  }
  // Leagues: Ligue 1 (clubs 1, 2, 3) at 1600, a second league (club 4) at 1400.
  const levels = (await x("INSERT INTO agg.power_runs(kind,method_version,status) VALUES ('elo','test','published') RETURNING id")).rows[0].id;
  await x("INSERT INTO core.competitions(id,name,country_code,kind) VALUES (9301,'Ligue Basse','FRA','league')");
  await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('competition','pitchapi','l_9basse',9301)");
  await x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,is_current) VALUES (9301,9301,2025,'2025/2026',true)");
  for (const [competition, level] of [[1, 1600], [9301, 1400]])
    await x(
      `INSERT INTO agg.league_levels(competition_id,entry_level,level,teams,links,linked,run_id,universe) VALUES ($1,$2,$2,10,5,true,$3,'men')
       ON CONFLICT (competition_id) DO UPDATE SET level=EXCLUDED.level, entry_level=EXCLUDED.entry_level`, [competition, level, levels]);
  // Style: club 1 at 50 on every axis, club 2 at 60 (Ligue 1), club 4 at 50 (second league); club 3 has none.
  const run = (await x("INSERT INTO agg.calc_runs(kind, model_version, status) VALUES ('percentiles', 'test', 'published') RETURNING id")).rows[0].id;
  for (const [edition, competition, clubs] of [[1, 1, [[1, 50], [2, 60]]], [9301, 9301, [[4, 50]]]]) {
    const cohort = (await x(
      `INSERT INTO agg.cohorts(key,entity_type,label,season_id,universe,stat_scope,per_match,size,calc_run_id)
       VALUES ($1,'team','t',2025,'league','league',false,10,$2) RETURNING id`, [`team:2025:cs:${edition}`, run])).rows[0].id;
    await x("INSERT INTO agg.cohort_competitions(cohort_id,competition_id) VALUES ($1,$2)", [cohort, competition]);
    for (const [club, centile] of clubs)
      for (const axis of AXES)
        await x("INSERT INTO agg.team_percentiles(cohort_id,team_id,metric_key,value,covered_matches,percentile,rank) VALUES ($1,$2,$3,$4,20,$5,1)", [cohort, club, axis, centile, centile]);
  }
  for (const [player, club, roles, defensive, effort, discipline] of FIT)
    await x(
      `INSERT INTO agg.player_team_fit(season_id,player_id,team_id,role,minutes,share_touches,share_passes,share_final_third,share_chances,share_shots,share_defensive,
         role_touches,role_passes,role_final_third,role_chances,role_shots,role_defensive,defensive_p90,defensive,effort,fouls_p90,card_points_p90,discipline,version)
       VALUES (2025,$1,$2,'central_midfielder',900,0.12,0.14,0.11,0.09,0.06,0.08,$3,$4,$5,$6,$7,$8,9.5,$9,$10,1.1,0.12,$11,'test')`,
      [player, club, ...roles, defensive, effort, discipline],
    );
}

const read = async (query = "limit=40") => (await get(`/api/players/p_aaaab1/similar?season=2025/2026&${query}`)).body.data;

test("candidates are ranked by compatibility with the replaced player's team", { skip }, async () => {
  const data = await read();
  assert.deepEqual(data.similar.map((p) => [p.id, p.fit.score]), [
    ["p_aaaab5", 83], // (40×74 + 20×90 + 15×90 + 10×90 + 5×100) / 90
    ["p_aaab13", 64], // (40×69 + 20×100 + 15×100 + 10×100 + 5×100) / 90 − (200 − 50) × 0.15
    ["p_aaaab9", 59], // (40×48 + 10×100 + 5×70) / 55: no role (3 shares), no style
    ["p_aaaab7", 35], // no row: the profile alone
    ["p_aaaab6", 30],
  ]);
});

test("a team-mate of the replaced player is never proposed", { skip }, async () => {
  const data = await read();
  assert.ok(!data.similar.some((p) => p.id === "p_aaaab8"));
  assert.equal(data.matched, 5);
});

test("each component, null when unknown, and the league gap", { skip }, async () => {
  const by = Object.fromEntries((await read()).similar.map((p) => [p.id, p]));
  assert.deepEqual(by.p_aaaab5.fit, { score: 83, profile: 74, role: 90, style: 90, defense: 90, effort: null, discipline: 100 });
  assert.deepEqual(by.p_aaaab9.fit, { score: 59, profile: 48, role: null, style: null, defense: 100, effort: null, discipline: 70 });
  assert.equal(by.p_aaab13.levelGap, 200);
  assert.equal(by.p_aaaab5.levelGap, undefined);
  assert.deepEqual(by.p_aaaab7.fit, { score: 35, profile: 35, role: null, style: null, defense: null, effort: null, discipline: null });
});

test("the replaced player and each candidate carry their team context", { skip }, async () => {
  const data = await read();
  const ref = data.reference.context;
  assert.deepEqual(ref.team, { id: "t_aaaaa1", name: "Olympique Été" });
  assert.deepEqual(ref.shares, { touches: 0.12, passes: 0.14, finalThird: 0.11, chances: 0.09, shots: 0.06, defensive: 0.08 });
  assert.equal(ref.defensive, 70);
  assert.equal(ref.defensiveP90, 9.5);
  assert.equal(ref.discipline, 80);
  assert.equal(ref.effort, undefined);
  assert.equal(ref.style.possession, 50);
  const cand = data.similar.find((p) => p.id === "p_aaaab5").context;
  assert.equal(cand.style.possession, 60);
  assert.equal(data.similar.find((p) => p.id === "p_aaaab7").context, undefined);
});

test("the filters still apply before the ranking", { skip }, async () => {
  const data = await read("limit=40&maxValue=1");
  assert.deepEqual(data.similar, []);
  assert.equal(data.matched, 0);
});

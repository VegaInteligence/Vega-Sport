// GET /api/teams/{id}/similar?season=[&league=] — the clubs whose style of play is the closest,
// across every league of the base (VI-22). Written before the route; expected behaviour:
//
// - Style: 100 − the mean distance between the two clubs' centiles on the ten style axes
//   (possession, territory, directness, pressing, crosses, set pieces, defensive actions, xG
//   for, xG against, pass accuracy). Each club is placed in its own league: only the league
//   cohorts count (no Europe pool, no cup), and only the leagues of ten clubs or more.
// - A centile says how a club plays against its own league's opponents: a club dominating a
//   much weaker league is not the same club. The similarity loses LEAGUE_GAP_COST points per
//   point of the two leagues' gap on the league strength scale (api.league_levels) beyond
//   LEAGUE_GAP_FREE, above or below; no threshold. A league without a level is left out,
//   unless the club's own league has none (then nobody pays). The clubs' own level never counts.
// - An axis counts when its centile is known on five matches or more; a pair needs
//   max(5, ⌈0.75 × the club's axes⌉) axes in common.
// - A club held by two leagues in the season is placed in the one with the most matches.
// - Women's leagues are compared among themselves.
// - Ten clubs at most, the closest first (unrounded), each with its league, its place there,
//   its record and the three axes where it is the closest. `compared` counts the pool.
// - `league` narrows the pool to one league, whatever its level, with the same numbers (a league
//   without a level pays nothing); a league without
//   comparable clubs gives an empty list, a malformed id 400.
// - A club with no league centiles (no league, or a league under ten clubs): 404.
//
// The leagues are written after the seed and before the tests; the next test file seeds again.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";
import { LEAGUE_GAP_COST, LEAGUE_GAP_FREE } from "../src/routes/profiles.mjs";

const AXES = ["possession_pct", "field_tilt_pct", "directness_pct", "ppda_approx", "crosses_pm", "set_share_pct", "def_actions_adj", "xg_pm", "xga_pm", "pass_accuracy_pct"];
const SITE = ["possession", "fieldTilt", "directness", "ppda", "crosses", "setShare", "defActions", "xg", "xga", "passAccuracy"];
// (competition id, public id, name, country, kind, level): X and Y are leagues of ten or more,
// 100 apart (Y's clubs lose 7.5 points from X's), Z is 200 below X (22.5), N has no level, S
// has six clubs, W is a women's league, C a cup.
const LEAGUES = [
  [9101, "l_9aaaaa", "Liga Alfa", "ESP", "league", 1600],
  [9102, "l_9bbbbb", "Liga Beta", "POR", "league", 1700],
  [9103, "l_9wwwww", "Liga Alfa Women", "ESP", "league", 1300],
  [9104, "l_9sssss", "Liga Pequena", "POR", "league", 1600],
  [9105, "l_9ccccc", "Copa Alfa", "ESP", "cup", null],
  [9106, "l_9zzzzz", "Liga Zeta", "ITA", "league", 1400],
  [9107, "l_9nnnnn", "Liga Nula", "ITA", "league", null],
];
const team = (id) => `t_9a${id}`; // 9101 -> t_9a9101
// Every club's centile on every axis: 50 + its distance to the club compared (9101), unless
// `deltas` gives one per axis (null: no centile); `covered` the matches behind them.
const X = [
  [9101, 0],
  [9102, null, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
  [9103, 10], [9104, 14], [9105, 18], [9106, 22], [9107, 26], [9108, 30], [9109, 34], [9110, 38],
  // Also in Y on more matches: placed in Y.
  [9115, 2, null, 8],
];
const Y = [
  [9111, 0],
  // Its cup copy is the same club as 9101; its league says 40 apart.
  [9112, 40],
  // The same style, but on three matches for four axes: six axes in common, not enough.
  [9113, null, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 20, [3, 3, 3, 3]],
  // Eight axes known, one apart each.
  [9114, null, [1, 1, 1, 1, 1, 1, 1, 1, null, null]],
  [9115, 30, null, 20],
  [9116, 11], [9117, 13], [9118, 15], [9119, 17], [9120, 19],
];
const W = Array.from({ length: 10 }, (_, i) => [9121 + i, i]);
const S = Array.from({ length: 6 }, (_, i) => [9131 + i, 0]);
// 9101's style, in leagues the default pool leaves out.
const Z = Array.from({ length: 10 }, (_, i) => [9141 + i, i]);
const N = Array.from({ length: 10 }, (_, i) => [9151 + i, i]);
const C = [[9112, 0], [9101, 0], [9103, 0], [9104, 0], [9105, 0], [9106, 0], [9107, 0], [9108, 0], [9109, 0], [9110, 0]];
const NAMES = { 9101: "Alfa Un", 9102: "Alfa Deux", 9111: "Beta Un", 9114: "Beta Quatre", 9121: "Alfa Femmes Un", 9122: "Alfa Femmes Deux" };
// League records (won, drawn, lost, goals for, goals against) of X: the places follow points,
// then goal difference, then goals.
const RECORDS = { 9101: [6, 2, 2, 20, 10], 9102: [7, 1, 2, 18, 9], 9103: [6, 2, 2, 20, 12], 9104: [2, 2, 6, 8, 15] };

let owner;
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  const x = (sql, values) => owner.query(sql, values);
  const run = (await x("INSERT INTO agg.calc_runs(kind, model_version, status) VALUES ('percentiles', 'test', 'published') RETURNING id")).rows[0].id;
  await x("INSERT INTO core.countries(code) VALUES ('ESP'),('POR'),('ITA') ON CONFLICT DO NOTHING");
  const levels = (await x("INSERT INTO agg.power_runs(kind,method_version,status) VALUES ('elo','test','published') RETURNING id")).rows[0].id;
  for (const [id, key, name, country, kind, level] of LEAGUES) {
    await x("INSERT INTO core.competitions(id,name,country_code,kind) VALUES ($1,$2,$3,$4)", [id, name, country, kind]);
    await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('competition','pitchapi',$1,$2)", [key, id]);
    await x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,is_current) VALUES ($1,$1,2025,'2025/2026',true)", [id]);
    if (level !== null)
      await x("INSERT INTO agg.league_levels(competition_id,entry_level,level,teams,links,linked,run_id,universe) VALUES ($1,$2,$2,10,5,true,$3,$4)", [
        id, level, levels, name.endsWith("Women") ? "women" : "men",
      ]);
  }
  const clubs = new Set([...X, ...Y, ...W, ...S, ...Z, ...N].map(([id]) => id));
  for (const id of clubs) {
    await x("INSERT INTO core.teams(id,name,country_code) VALUES ($1,$2,'ESP')", [id, NAMES[id] || `Club ${id}`]);
    await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('team','pitchapi',$1,$2)", [team(id), id]);
  }
  const cohort = async (edition, universe, rows) => {
    const key = universe === "europe" ? "team:2025:europe" : `team:2025:cs:${edition}`;
    const id = (
      await x(
        `INSERT INTO agg.cohorts(key,entity_type,label,season_id,universe,stat_scope,per_match,size,calc_run_id)
         VALUES ($1,'team',$2,2025,$3,$4,$5,$6,$7) RETURNING id`,
        [key, LEAGUES.find((l) => l[0] === edition)[2], universe, universe === "europe" ? "league_and_uefa" : "league", universe === "europe", rows.length, run],
      )
    ).rows[0].id;
    await x("INSERT INTO agg.cohort_competitions(cohort_id,competition_id) VALUES ($1,$2)", [id, edition]);
    for (const [club, delta, deltas, covered = 20, short = []] of rows)
      for (const [i, axis] of AXES.entries()) {
        const d = deltas ? deltas[i] : delta;
        await x(
          "INSERT INTO agg.team_percentiles(cohort_id,team_id,metric_key,value,covered_matches,percentile,rank) VALUES ($1,$2,$3,$4,$5,$6,1)",
          [id, club, axis, d == null ? null : 50 + d, i < short.length ? short[i] : covered, d == null ? null : 50 + d],
        );
      }
    // A ranked metric outside the style axes changes nothing.
    for (const [club] of rows)
      await x("INSERT INTO agg.team_percentiles(cohort_id,team_id,metric_key,value,covered_matches,percentile,rank) VALUES ($1,$2,'points_pm',1,20,$3,1)", [id, club, club === 9111 ? 0 : 99]);
  };
  await cohort(9101, "league", X);
  await cohort(9102, "league", Y);
  await cohort(9103, "league", W);
  await cohort(9104, "league", S);
  await cohort(9106, "league", Z);
  await cohort(9107, "league", N);
  await cohort(9105, "competition", C);
  // The Europe pool, where 9112 has 9101's style: never read.
  await cohort(9101, "europe", [[9112, 0], ...X.slice(0, 10)]);
  for (const [club, [w, d, l, gf, ga]] of Object.entries(RECORDS))
    await x(
      `INSERT INTO agg.team_season_stats(team_id,competition_season_id,season_id,matches,won,drawn,lost,goals_for,goals_against,points,clean_sheets)
       VALUES ($1,9101,2025,$2,$3,$4,$5,$6,$7,$8,0)`,
      [club, w + d + l, w, d, l, gf, ga, 3 * w + d],
    );
});
after(() => owner?.end());

const similar = async (query) => (await get(`/api/teams/${query}`)).body?.data;

test("the closest styles across every league, ten at most, the closest first", { skip }, async () => {
  const { response, body } = await get("/api/teams/t_9a9101/similar?season=2025/2026");
  assert.equal(response.status, 200);
  const data = body.data;
  assert.equal(data.id, "t_9a9101");
  assert.equal(data.season, "2025/2026");
  assert.equal(data.league, undefined);
  // X's nine other clubs, Y's nine eligible ones (9113 has too few axes; 9115 is counted once)
  // and Z's ten; not N's, which has no level.
  assert.equal(data.compared, 28);
  assert.deepEqual([LEAGUE_GAP_FREE, LEAGUE_GAP_COST], [50, 0.15]);
  // 9111 has 9101's style in a league 100 above: 100 − 7.5. Z's twin pays 22.5 (77.5, after
  // 9118's 77.5 on the key); the ties of .5 round up.
  assert.deepEqual(
    data.similar.map((c) => [c.id, c.similarity]),
    [["t_9a9102", 96], ["t_9a9111", 93], ["t_9a9114", 92], ["t_9a9103", 90], ["t_9a9104", 86], ["t_9a9105", 82], ["t_9a9116", 82], ["t_9a9117", 80], ["t_9a9106", 78], ["t_9a9118", 78]],
  );
  // Never the club itself, a women's club, a club of a league under ten, the cup's or the Europe
  // pool's twin, a league without a level.
  for (const id of ["t_9a9101", "t_9a9121", "t_9a9131", "t_9a9113", "t_9a9151"]) assert.ok(!data.similar.some((c) => c.id === id), id);
});

test("each club with its league, place, record and closest axes", { skip }, async () => {
  const data = await similar("t_9a9101/similar?season=2025/2026");
  const two = data.similar.find((c) => c.id === "t_9a9102");
  assert.equal(two.name, "Alfa Deux");
  assert.deepEqual(two.league, { id: "l_9aaaaa", name: "Liga Alfa", country: "ESP" });
  // 22 points: first of Liga Alfa ahead of 9101 and 9103 (20 points each, 9101 on goal difference).
  assert.equal(two.position, 1);
  assert.deepEqual(two.record, { matches: 10, won: 7, drawn: 1, lost: 2 });
  assert.deepEqual(two.closest, SITE.slice(0, 3));
  assert.equal(data.similar.find((c) => c.id === "t_9a9103").position, 3);
  // Without a league record: no place, no record.
  const one = data.similar.find((c) => c.id === "t_9a9111");
  assert.deepEqual(one.closest.length, 3);
  assert.deepEqual(one.league, { id: "l_9bbbbb", name: "Liga Beta", country: "POR" });
  assert.equal(one.position, undefined);
  assert.equal(one.record, undefined);
  // Eight axes in common: the closest are among them.
  assert.ok(data.similar.find((c) => c.id === "t_9a9114").closest.every((k) => SITE.slice(0, 8).includes(k)));
});

test("one league narrows the pool, with the same numbers", { skip }, async () => {
  const x = await similar("t_9a9101/similar?season=2025/2026&league=l_9aaaaa");
  assert.equal(x.league, "l_9aaaaa");
  assert.deepEqual(
    x.similar.map((c) => [c.id, c.similarity]),
    [["t_9a9102", 96], ["t_9a9103", 90], ["t_9a9104", 86], ["t_9a9105", 82], ["t_9a9106", 78], ["t_9a9107", 74], ["t_9a9108", 70], ["t_9a9109", 66], ["t_9a9110", 62]],
  );
  assert.equal(x.compared, 9);
  const y = await similar("t_9a9101/similar?season=2025/2026&league=l_9bbbbb");
  assert.deepEqual(
    y.similar.map((c) => [c.id, c.similarity]),
    [["t_9a9111", 93], ["t_9a9114", 92], ["t_9a9116", 82], ["t_9a9117", 80], ["t_9a9118", 78], ["t_9a9119", 76], ["t_9a9120", 74], ["t_9a9115", 63], ["t_9a9112", 53]],
  );
  // Narrowed, a league far below pays its gap; a league without a level pays nothing.
  for (const [league, first, score] of [["l_9zzzzz", "t_9a9141", 78], ["l_9nnnnn", "t_9a9151", 100]]) {
    const z = await similar(`t_9a9101/similar?season=2025/2026&league=${league}`);
    assert.deepEqual([z.compared, z.similar.length, z.similar[0].id, z.similar[0].similarity], [10, 10, first, score], league);
  }
  // A league of women, a league under ten clubs, a league with no centiles: nobody to compare.
  for (const league of ["l_9wwwww", "l_9sssss", "l_3FJFUl"]) {
    const { response, body } = await get(`/api/teams/t_9a9101/similar?season=2025/2026&league=${league}`);
    assert.equal(response.status, 200, league);
    assert.deepEqual([body.data.similar, body.data.compared], [[], 0], league);
  }
});

test("women's clubs are compared among themselves", { skip }, async () => {
  const data = await similar("t_9a9122/similar?season=2025/2026");
  assert.equal(data.compared, 9);
  assert.equal(data.similar[0].id, "t_9a9121");
  assert.ok(data.similar.every((c) => c.league.id === "l_9wwwww"));
});

test("what the read refuses", { skip }, async () => {
  const status = async (path) => (await get(path)).response.status;
  // No league centiles: a club of the seed's league, a club of a league under ten clubs.
  assert.equal(await status("/api/teams/t_aaaaa1/similar?season=2025/2026"), 404);
  assert.equal(await status("/api/teams/t_9a9131/similar?season=2025/2026"), 404);
  assert.equal(await status("/api/teams/t_9a9101/similar?season=2024/2025"), 404);
  assert.equal(await status("/api/teams/t_9a9101/similar"), 400);
  assert.equal(await status("/api/teams/t_9a9101/similar?season=2025"), 400);
  assert.equal(await status("/api/teams/t_9a9101/similar?season=2025/2026&league=ligue1"), 400);
  assert.equal(await status("/api/teams/t_9a9101/similar?season=2025/2026&level=all"), 400);
});

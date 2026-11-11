// /api/read/players has two reads (routes/players.mjs): the season's rows per player and
// edition, and the appearances. This file checks that they answer the same, on a season
// with two editions: the seed's league and a cup added here, whose public id sorts before
// the league's and whose matches are played before, between and after the league's.
//
// The cup is written after the seed and before the tests; the next test file seeds again.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { context, get, skip } from "./context.mjs";
import { resolveEditions } from "../src/publication.mjs";
import { parsePlayerRead, playerReadQuery, playerReadRecord, playerRollupQuery, supportsPlayerRollup } from "../src/routes/players.mjs";

const LEAGUE = "l_3FJFUl",
  CUP = "l_0aaaaa";
// (id, home, away, date, statistics coverage). The last one has no date: it sorts last.
// Their public ids are m_aaaab1 to m_aaaab4.
const CUP_MATCHES = [
  [9011, 1, 3, "2025-08-20", "ok"],
  [9012, 2, 4, "2025-09-03", "ok"],
  [9013, 3, 2, "2025-09-10", "pending"],
  [9014, 4, 1, null, "ok"],
];
// (player, match, team, minutes, rating, goals, xg, shots, passes ok, passes, duels won, duels lost, position, starter)
const CUP_STATS = [
  // Élie Durand plays the cup for another club and in midfield, then for his league club.
  [101, 9011, 3, 90, 8.0, 1, 0.6, 3, 30, 40, 4, 2, 61, true],
  [101, 9014, 1, 45, 6.4, 0, 0.1, 1, 9, 10, 0, 0, 91, false],
  // Marc Petit: a second match whose minutes are unknown.
  [102, 9012, 2, null, null, null, null, null, null, null, null, null, 61, true],
  // Cristiano Test: as many cup minutes as striker as league minutes as attacking midfielder.
  [104, 9012, 2, 90, 7.7, 2, 1.4, 5, 20, 26, 3, 3, 91, true],
  [104, 9013, 2, 70, 6.1, 0, 0.3, 2, 11, 16, 1, 4, 91, true],
  // Zoé Coupe plays only the cup; her rating is not a number.
  [105, 9011, 1, 90, "NaN", 0, 0.0, 0, 50, 55, 6, 1, 33, true],
];
// Line-up entries without statistics: (player, match, team). 106 has no name and no public
// id of the provider; the third match's statistics are not collected yet, so 107's minutes are unknown.
const CUP_BENCH = [
  [106, 9011, 1],
  [107, 9013, 3],
];
const CUP_PLAYERS = [
  [105, "p_aaaab5", "Zoé Coupe"],
  [106, null, ""],
  [107, "p_aaaab7", "Banc Attente"],
];

let owner;
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  const x = (sql, values) => owner.query(sql, values);
  await x("INSERT INTO core.competitions(id,name,country_code,kind) VALUES (9001,'Coupe Été','FRA','cup')");
  await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('competition','pitchapi',$1,9001)", [CUP]);
  await x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,is_current) VALUES (9001,9001,2025,'2025/2026',true)");
  for (const [id, home, away, date, coverage] of CUP_MATCHES) {
    await x(
      `INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date,kickoff_at)
       VALUES ($1,9001,2025,'pitchapi','finished',$2,$3,1,0,$4::date,$4::date + time '19:00')`,
      [id, home, away, date],
    );
    await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('match','pitchapi',$1,$2)", [`m_aaaab${id - 9010}`, id]);
    await x("INSERT INTO core.match_coverage(season_id,match_id,player_stats) VALUES (2025,$1,$2)", [id, coverage]);
  }
  for (const [id, key, name] of CUP_PLAYERS) {
    await x("INSERT INTO core.players(id,name) VALUES ($1,$2)", [id, name]);
    if (key) await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','pitchapi',$1,$2)", [key, id]);
  }
  for (const [player, match, team, minutes, rating, goals, xg, shots, ok, passes, won, lost, position, starter] of CUP_STATS) {
    await x(
      `INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played,rating,goals,xg,total_shots,
         accurate_passes,accurate_passes_total,duels_won,duels_lost)
       VALUES (2025,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [match, team, player, minutes, rating, goals, xg, shots, ok, passes, won, lost],
    );
    await x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES (2025,$1,$2,$3,$4,$5)", [
      match, team, player, starter, position,
    ]);
  }
  for (const [player, match, team] of CUP_BENCH)
    await x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES (2025,$1,$2,$3,false,61)", [
      match, team, player,
    ]);
  // What the calculator does after a collected match of the edition.
  await x("SELECT agg.refresh_player_list(9001)");
});
after(() => owner?.end());

// Sums of sums are not the sums bit for bit: numbers are compared to twelve digits.
function same(actual, expected, path) {
  if (typeof expected === "number" && typeof actual === "number") {
    const scale = Math.max(1, Math.abs(expected));
    assert.ok(Math.abs(actual - expected) <= 1e-12 * scale, `${path}: ${actual} != ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path}: not a list`);
    assert.equal(actual.length, expected.length, `${path}: length`);
    expected.forEach((value, index) => same(actual[index], value, `${path}[${index}]`));
  } else if (expected !== null && typeof expected === "object") {
    assert.ok(actual !== null && typeof actual === "object", `${path}: not an object`);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path}: keys`);
    for (const key of Object.keys(expected)) same(actual[key], expected[key], `${path}.${key}`);
  } else assert.equal(actual, expected, path);
}

/** The appearance read's answer to a request, as the route shapes it (without `power`). */
async function fromAppearances(query) {
  const params = new URL("https://api.test/api/read/players?" + query).searchParams;
  const filters = parsePlayerRead(params);
  const editions = await resolveEditions(context.reader.read, filters.scope);
  assert.ok(supportsPlayerRollup(filters), `${query}: the route would read the appearances`);
  assert.match(playerRollupQuery(filters, params, editions).sql, /^\/\*vega:v2:players:rollup\*\//);
  const { sql, values } = playerReadQuery(filters, params, editions);
  const [row] = await context.reader.read(sql, values);
  return JSON.parse(JSON.stringify({ total: row.total, players: row.players.map(playerReadRecord), teams: row.teams }));
}

const SCOPES = ["leagues=all", `leagues=${LEAGUE}`, `leagues=${CUP}`, `leagues=${CUP},${LEAGUE}`];
const REQUESTS = [
  "", "&minutes=0", "&minutes=0&sort=name&direction=asc", "&minutes=0&sort=name&direction=desc", "&minutes=0&sort=matches&direction=asc",
  "&minutes=0&sort=minutes", "&sort=goals", "&sort=goals&basis=total", "&sort=xg&basis=per90", "&sort=passAccuracy", "&sort=duelRate&direction=asc",
  "&sort=finishingDelta", "&ranking=goals", "&ranking=assists", "&ranking=clinical&basis=total", "&ranking=wasteful", "&ranking=rating",
  "&pos=M", "&pos=A", "&pos=G", "&pos=D", "&minutes=0&pos=M,A", "&group=O", "&group=M", "&minutes=0&group=G,D", "&group=O&pos=M", "&q=cr7", "&q=elie", "&q=union", "&q=coupe", "&q=stade", "&minutes=0&q=joueur",
  "&q=nord&pos=M", "&stats=goals:1", "&stats=passAccuracy:80,shots:1", "&rmin=7", "&minutes=0&limit=2", "&minutes=0&limit=2&page=2",
  "&minutes=0&limit=2&page=4", "&minutes=60",
];

test("the season's rows answer as the appearances do", { skip }, async () => {
  for (const scope of SCOPES)
    for (const request of REQUESTS) {
      const query = `season=2025/2026&${scope}${request}`;
      const expected = await fromAppearances(query);
      const { response, body } = await get("/api/read/players?" + query);
      assert.equal(response.status, 200, query);
      assert.equal(body.pagination.total, expected.total, `${query}: total`);
      same(body.data.players.map(({ power, ...player }) => player), expected.players, query);
      assert.deepEqual(body.data.teams, expected.teams, `${query}: teams`);
    }
});

test("a player of two editions: clubs, role, identity and unknown minutes", { skip }, async () => {
  const { body } = await get("/api/read/players?season=2025/2026&leagues=all&minutes=0&limit=50");
  const by = Object.fromEntries(body.data.players.map((p) => [p.id, p]));
  assert.equal(body.pagination.total, 7);
  // Élie Durand: five played matches, 395 minutes; the cup's rows come first (its id sorts
  // before the league's), so the cup's club is his first; he is a striker by his minutes.
  const elie = by.p_aaaab1;
  assert.deepEqual([elie.matches, elie.profile.minutes, elie.position], [5, 395, "Attaquant"]);
  assert.deepEqual(elie.profile.teams, ["Stade Nord", "Olympique Été"]);
  assert.deepEqual(elie.profile.teamIds, ["t_aaaaa1", "t_aaaaa3"]);
  assert.deepEqual(elie.profile.leagues, ["Coupe Été", "Ligue 1"]);
  assert.deepEqual(elie.profile.leagueIds, [CUP, LEAGUE]);
  assert.deepEqual(elie.profile.stats.goals, { sum: 3, count: 5, minutes: 395 });
  assert.deepEqual(elie.profile.ratios.duelRate, { numerator: 4, denominator: 6, count: 1, minutes: 90 });
  // His most recent dated row is the league's of 5 September; the cup match without a date is not.
  assert.equal(elie.profile.identity.id, "m_aaaaa5:p_aaaab1");
  assert.equal(elie.profile.latest.id, "m_aaaaa5:p_aaaab1");
  // Cristiano Test: 160 minutes in each role of the attack; the first one read (the cup's) is kept.
  assert.equal(by.p_aaaab4.position, "Attaquant");
  // Marc Petit: one unknown match in each edition.
  assert.deepEqual([by.p_aaaab2.matches, by.p_aaaab2.profile.unknownMinutes], [1, 2]);
  // Zoé Coupe: a rating that is not a number is not a rating.
  assert.deepEqual([by.p_aaaab5.matches, by.p_aaaab5.rating, by.p_aaaab5.profile.ratingCount], [1, null, 0]);
  // Bench only: no match played. With statistics collected the minutes are 0, without they are unknown.
  assert.deepEqual([by.p_v0000106.name, by.p_v0000106.matches, by.p_v0000106.minutes, by.p_v0000106.profile.latest], ["Joueur", 0, 0, null]);
  assert.deepEqual([by.p_aaaab7.matches, by.p_aaaab7.minutes, by.p_aaaab7.profile.unknownMinutes], [0, null, 1]);
  assert.equal(by.p_aaaab7.profile.identity.id, "m_aaaab3:p_aaaab7");
});

test("a request that filters appearances reads them", { skip }, () => {
  const filtersOf = (query) => parsePlayerRead(new URL("https://api.test/api/read/players?season=2025/2026&leagues=all" + query).searchParams);
  for (const query of ["&match=m_aaaaa1", "&from=2025-09-01", "&to=2025-09-30", "&role=starter", "&venue=home", "&result=win"])
    assert.equal(supportsPlayerRollup(filtersOf(query)), false, query);
  assert.equal(supportsPlayerRollup(filtersOf("&pos=M&q=x&stats=goals:1&ranking=goals&basis=per90")), true);
});

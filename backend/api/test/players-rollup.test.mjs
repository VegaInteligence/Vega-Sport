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

// A request that filters appearances over a scope: the season's rows are worked out from
// them (appearanceRows). The statement on the appearances is the reference.
const FILTERS = [
  "&venue=home", "&venue=away", "&result=win", "&result=draw", "&result=loss", "&role=starter", "&role=sub",
  "&from=2025-09-01", "&to=2025-09-03", "&from=2025-09-02&to=2025-09-05", "&venue=home&result=win", "&venue=away&role=starter&from=2025-09-01",
];
const SHAPES = [
  "&minutes=0", "", "&minutes=0&sort=name&direction=asc", "&minutes=0&sort=matches&direction=asc", "&sort=goals&basis=total", "&sort=xg&basis=per90",
  "&sort=passAccuracy", "&sort=duelRate&direction=asc", "&sort=finishingDelta", "&ranking=goals", "&ranking=clinical&basis=total", "&ranking=rating",
  "&minutes=0&pos=M,A", "&minutes=0&group=O", "&minutes=0&group=G,D", "&minutes=0&q=elie", "&minutes=0&q=union", "&minutes=0&q=coupe", "&minutes=0&q=joueur",
  "&stats=goals:1", "&stats=passAccuracy:80,shots:1", "&rmin=7", "&minutes=0&limit=2", "&minutes=0&limit=2&page=2", "&minutes=0&whole=1",
];

test("a filtered request's rows, worked out from the appearances, answer as the statement on the appearances does", { skip }, async () => {
  let compared = 0,
    found = 0;
  for (const scope of SCOPES)
    for (const filter of FILTERS)
      for (const shape of SHAPES) {
        const query = `season=2025/2026&${scope}${shape}${filter}`;
        const params = new URL("https://api.test/api/read/players?" + query).searchParams;
        const filters = parsePlayerRead(params);
        const editions = await resolveEditions(context.reader.read, filters.scope);
        assert.equal(supportsPlayerRollup(filters), false, query);
        assert.match(playerRollupQuery(filters, params, editions, { fromAppearances: true }).sql, /^\/\*vega:v2:players:appearances\*\//);
        const reference = playerReadQuery(filters, params, editions);
        const [row] = await context.reader.read(reference.sql, reference.values);
        const expected = JSON.parse(JSON.stringify({ total: row.total, players: row.players.map(playerReadRecord), teams: row.teams }));
        const { response, body } = await get("/api/read/players?" + query);
        assert.equal(response.status, 200, query);
        assert.equal(body.pagination.total, expected.total, `${query}: total`);
        same(body.data.players.map(({ power, ...player }) => player), expected.players, query);
        assert.deepEqual(body.data.teams, expected.teams, `${query}: teams`);
        compared++;
        found += expected.players.length;
      }
  // The comparison is not of empty answers.
  assert.equal(compared, SCOPES.length * FILTERS.length * SHAPES.length);
  assert.ok(found > compared, `${found} players over ${compared} requests`);
});

// A whole selection keeps its page by rank (pageSql): the same players, in the same
// order and with the same records, as LIMIT … OFFSET keeps, page after page and past the end.
test("a whole selection's pages, kept by rank, are those LIMIT … OFFSET keeps", { skip }, async () => {
  for (const request of ["&minutes=0", "&minutes=0&sort=goals&basis=total", "&minutes=0&venue=home", "&minutes=0&group=O"]) {
    const params = new URL(`https://api.test/api/read/players?season=2025/2026&leagues=all&detail=profile${request}`).searchParams;
    const parsed = parsePlayerRead(params);
    const editions = await resolveEditions(context.reader.read, parsed.scope);
    const fromAppearances = !supportsPlayerRollup(parsed);
    const page = async (whole, limit, offset) => {
      const { sql, values } = playerRollupQuery({ ...parsed, whole, limit, offset }, params, editions, { fromAppearances });
      assert.equal(/ n WHERE n\.result_order>\$\d+ ORDER BY n\.result_order LIMIT \$\d+\)/.test(sql), whole, request);
      assert.equal(/ LIMIT \$\d+ OFFSET \$\d+\)/.test(sql), !whole, request);
      const [row] = await context.reader.read(sql, values, fromAppearances ? { plan: ["hashJoins"] } : undefined);
      return JSON.parse(JSON.stringify({ total: row.total, players: row.players, teams: row.teams }));
    };
    const all = await page(false, 100, 0);
    assert.ok(all.total >= 2 && all.players.length === all.total, `${request}: ${all.total} players`);
    // Several pages whatever the selection's size: of two players, or of one.
    const size = all.total > 4 ? 2 : 1,
      seen = [];
    for (let offset = 0; offset < all.total + size; offset += size) {
      const ranked = await page(true, size, offset);
      same(ranked, await page(false, size, offset), `${request} from ${offset}`);
      assert.equal(ranked.players.length, Math.max(0, Math.min(size, all.total - offset)), `${request} from ${offset}`);
      seen.push(...ranked.players.map((player) => player.p.player_id));
    }
    assert.deepEqual(seen, all.players.map((player) => player.p.player_id), request);
  }
});

// api.match_keys gives a match's public id by the rule of api.public_id: the provider's
// current key, else the Vega key.
test("a match's key is the public id the function gives, with or without a provider's key", { skip }, async () => {
  await owner.query("BEGIN");
  try {
    await owner.query(
      `INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date,kickoff_at)
       VALUES (9099,9001,2025,'pitchapi','finished',1,2,1,0,'2025-10-01'::date,'2025-10-01'::date + time '19:00')`,
    );
    const { rows } = await owner.query("SELECT k.match_id,k.public_id,api.public_id('match',k.match_id) expected FROM api.match_keys k ORDER BY 1");
    const { rows: [{ matches }] } = await owner.query("SELECT count(*)::int matches FROM core.matches");
    assert.equal(rows.length, matches);
    for (const row of rows) assert.equal(row.public_id, row.expected, `match ${row.match_id}`);
    assert.equal(rows.find((row) => row.match_id === 9099).public_id, "m_v0009099");
    assert.equal(rows.find((row) => row.match_id === 9011).public_id, "m_aaaab1");
  } finally {
    await owner.query("ROLLBACK");
  }
});

test("one match's players are read by the statement on the appearances; a filtered scope is not", { skip }, async () => {
  const sent = [];
  const reader = { read: async (sql, values, options) => (sent.push([sql.slice(0, 40), options?.plan ?? null]), context.reader.read(sql, values, options)) };
  const { createHandler } = await import("../src/handler.mjs");
  const handle = createHandler({ read: reader.read, clock: () => context.now });
  const tags = async (query) => {
    sent.length = 0;
    const response = await handle(new Request("https://api.test/api/read/players?season=2025/2026&leagues=all" + query));
    assert.equal(response.status, 200, query);
    return sent.filter(([sql]) => sql.startsWith("/*vega:v2:players")).map(([sql, plan]) => [/players[:a-z]*/.exec(sql)[0], plan]);
  };
  assert.deepEqual(await tags(""), [["players:rollup", null]]);
  assert.deepEqual(await tags("&match=m_aaaaa1"), [["players", null]]);
  assert.deepEqual(await tags("&match=m_aaaaa1&venue=home"), [["players", null]]);
  assert.deepEqual(await tags("&venue=home"), [["players:appearances", ["hashJoins"]]]);
  assert.deepEqual(await tags("&from=2025-09-01&detail=profile&whole=1"), [["players:appearances", ["hashJoins"]]]);
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

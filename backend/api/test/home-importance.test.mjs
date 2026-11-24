// The home's importance v2 and its two windows (GitHub #69, Linear VI-48): `billboard` (« À l'affiche ») and
// `highlights[].weight2` on /api/read/home, and the common read /api/read/home-local?country=XXX. Written before the
// code (AGENTS.md): the failure modes, edge cases and expected outcomes first, then the tests.
//
// importance = stakes × level + balance (sql/171_home_importance_v2.sql)
//   stakes  = competition prestige × round multiplier, the values of vega/power.py (PRESTIGE, STAGE via round_of),
//             stored as rows (core.home_stakes);
//   level   = (mean of the two sides' rating − centre) / divisor, centre and divisor a row per scope (clubs, nations:
//             core.home_level_scales, today 1400 and 100 for both). A side's rating: its Elo of the season
//             (agg.team_power), else its league's level (agg.league_levels), else the centre;
//   balance = 1 − |p_home − p_away| of the match forecast, else of the Elo expected score (power.expected_score, the
//             run's home advantage, none on neutral ground) when both sides have a rating, else 0.5.
//
// Failure modes and edge cases, with the expected outcome (I = importance, B = billboard, L = home-local):
// I1  a fixed list of clubs decides the order (v1's flaw) → v2 reads no list: two unknown clubs of a strong league
//     outrank two unknown clubs of a weaker one, by their league's level.
// I2  a side without an Elo makes the score NULL (and the match drops out or sorts last at random) → the side takes its
//     league's level; with nothing known the level term is 0 and the balance 0.5: I = 0.5, never NULL.
// I3  the stakes drift from power.py (two copies of 1.15, one edited) → the values are rows of one migration, and a
//     drift test (backend/tests/test_home_importance.py; and here, the round classification against power.round_of)
//     compares them with power.py.
// I4  a round's multiplier read from its name alone → power.round_of's rule: a 'regular' stage is ordinary whatever
//     its name; 'Final' with a final stage is ×1.15.
// I5  the forecast and the Elo disagree on the balance → the forecast wins when there is one.
// I6  the home advantage is a new constant → the Elo run's own (agg.power_runs.elo_home_advantage), 0 on neutral
//     ground (core.matches.is_neutral), as power.elo_updates.
// I7  the nations' Elo changes scale (VI-48 addition) → their centre and divisor are a row: changing it changes
//     their importance without touching a function.
// B1  the window misses Paris days → a match's day is its Paris day (kick-off 22:30 UTC on 4 Sep is 5 Sep), from
//     yesterday to today + 3 (rules as data: api.home_rules_v2).
// B2  live, postponed or cancelled matches → finished, in play and not started are shown; postponed is not.
// B3  a crowded day floods the block → at most 8 a day (rules), the most important first.
// B4  the order is unstable between two requests → day ↑, importance ↓, kick-off ↑, id ↑.
// B5  the billboard ignores the visitor's leagues → same scope as the rest of the read (leagues=…).
// B6  v2 reorders the existing blocks before the user validates it → highlights keep v1's order; v2 is only weight2.
// L1  a bad country code reaches SQL, or any personal parameter is accepted → 400 before any read.
// L2  an unknown but well-formed country is a 404 or an error, and each costs a full read → 200 with empty lists and
//     the window, cacheable like the home (public, stale-while-revalidate, ETag, 304).
// L3  another country's or a European cup's matches leak in → only competitions whose country is the code.
// L4  home-local's window is the billboard's → its own: yesterday → today + 7 (rules), and the bounds used are in the
//     answer (window.start, window.end) for the site's columns.
// L5  a stale page is served after a publication → `generation` that is not the publication's is a 409.
// L6  the table: the top six of the country's highest-level league (api.standing_rows), null when there is none.
// B7  the site merges home-local's matches into « À l'affiche » (24 Nov: the country inside the existing cards) and must
//     keep them to the billboard's days, but the read does not say which days those are (an empty billboard says
//     nothing) → `billboardWindow` {start, end}: the Paris days used, next to `billboard`, as home-local's `window`;
//     kept by the compact presentation (media=1).
//
// The seed's week: "now" is Saturday 6 September 2025, 14:00 in Paris (context.mjs): yesterday is 5 Sep, the billboard
// runs to 9 Sep and home-local to 13 Sep. The rows below are written after the seed; the next test file seeds again.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { get, skip } from "./context.mjs";
import { createHandler, presentHome } from "../src/handler.mjs";
import { compactHomePresentation } from "../src/home-presentation.mjs";
import { CAPABILITIES, COMPACT_READS } from "../src/routes/system.mjs";

const home = "/api/read/home?season=2025/2026&leagues=all";
const local = (query) => `/api/read/home-local?season=2025/2026&${query}`;
const id = (n) => "m_v" + String(n).padStart(7, "0");
const league = (n) => "l_v" + String(n).padStart(7, "0");
// Competitions: (id, name, country, kind, PitchAPI key or null, league level or null).
const COMPETITIONS = [
  [980001, "Champions League", "UEFA", "cup", "l_0bfbkO", null],
  [980002, "Ligue 2", "FRA", "league", null, 1500],
  [980003, "Série A", "BRA", "league", null, null],
  [980004, "World Cup", "WORLD", "international", "l_1XLtP0", null],
];
// Teams: (id, name, Elo of the season or null, edition it plays in or null, national).
const CROWD = Array.from({ length: 18 }, (_, k) => [980030 + k, `Crowd ${String(k).padStart(2, "0")}`, 1400 + 10 * k, 980002, false]);
const TEAMS = [
  [980001, "Alpha FC", 1900, 980001, false], [980002, "Beta FC", 1800, 980001, false],
  [980011, "Deux Domicile", null, 980002, false], [980012, "Deux Extérieur", null, 980002, false],
  [980021, "Brasil Um", null, 980003, false], [980022, "Brasil Dois", null, 980003, false],
  [980060, "Nationland", 1800, 980004, true], [980061, "Otherland", 1700, 980004, true],
  ...CROWD,
];
// The seed's Ligue 1 clubs, given fixed Elos so the expected values are exact.
const SEED_ELO = [[1, 1700], [2, 1650], [3, 1550], [4, 1500]];
// Matches: (id, edition, home, away, kick-off UTC, match date, status, score, round [name, stage], neutral).
const pair = (i) => [980030 + 2 * i, 980031 + 2 * i];
const MATCHES = [
  [980001, 980001, 980001, 980002, "2025-09-07T19:00:00Z", "2025-09-07", "not_started", null, ["Final", "final"]],
  [980002, 980002, 980011, 980012, "2025-09-07T15:00:00Z", "2025-09-07", "not_started"],
  [980003, 980003, 980021, 980022, "2025-09-07T18:00:00Z", "2025-09-07", "not_started"],
  [980004, 980002, ...pair(0), "2025-09-05T18:00:00Z", "2025-09-05", "finished", [1, 0]],
  // B1: 22:30 UTC on 4 Sep is 00:30 on 5 Sep in Paris: in the window.
  [980005, 980002, ...pair(1), "2025-09-04T22:30:00Z", "2025-09-04", "finished", [2, 2]],
  // B1: 4 Sep in Paris: before yesterday.
  [980006, 980002, ...pair(3), "2025-09-04T20:00:00Z", "2025-09-04", "finished", [0, 1]],
  // B1: 22:30 UTC on 9 Sep is 10 Sep in Paris: after the billboard, inside home-local's window.
  [980007, 980002, 980011, 980012, "2025-09-09T22:30:00Z", "2025-09-09", "not_started"],
  // B2: postponed, never shown; in play, shown.
  [980008, 980002, ...pair(4), "2025-09-07T13:00:00Z", "2025-09-07", "postponed"],
  [980009, 980002, ...pair(2), "2025-09-06T11:00:00Z", "2025-09-06", "in_play", [0, 0]],
  // B3: nine on Monday 8, eight kept: pair 0 (the weakest) drops out.
  ...Array.from({ length: 9 }, (_, i) => [980010 + i, 980002, ...pair(i), `2025-09-08T${String(10 + i).padStart(2, "0")}:00:00Z`, "2025-09-08", "not_started"]),
  // L4: the last day of home-local's window, and the day after.
  [980019, 980002, 980011, 980012, "2025-09-13T19:00:00Z", "2025-09-13", "not_started"],
  [980020, 980002, 980011, 980012, "2025-09-14T19:00:00Z", "2025-09-14", "not_started"],
  // I6, I7: a World Cup match between two national teams, on neutral ground.
  [980021, 980004, 980060, 980061, "2025-09-09T18:00:00Z", "2025-09-09", "not_started", null, ["Group A", "group"], true],
];
// Expected importances (rounded to 2 decimals), from the formula above:
const W = {
  // I4, I6: 1.15 (Champions League) × 1.15 (final) × (1850 − 1400) / 100 + 1 − |2E − 1|, E = 1 / (1 + 10^((1800 − 1900 − 60) / 400)).
  [id(980001)]: 6.52,
  // I1, I2: neither side has an Elo: Ligue 2's level, 1500 each: level 1, balance from the home advantage alone.
  [id(980002)]: 1.83, [id(980007)]: 1.83, [id(980019)]: 1.83,
  // I2: nothing known (Série A has no level): 0 + 0.5.
  [id(980003)]: 0.5,
  // The seed's m5 (Union Sud 1500 – Olympique Été 1700, finished on 5 Sep) and m6 (Racing 1650 – Stade Nord 1550, its
  // forecast 0.5123 / 0.2501 / 0.2376, I5: balance 1 − |0.5123 − 0.2376|).
  m_aaaaa5: 2.62, m_aaaaa6: 2.73,
  // Crowd pairs: (1400 + 20i, 1410 + 20i): level 0.05 + 0.2i, balance 0.857074.
  [id(980004)]: 0.91, [id(980005)]: 1.11, [id(980009)]: 1.31,
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [id(980010 + i), Math.round((0.05 + 0.2 * i + 0.857074) * 100) / 100])),
  // I6, I7: 1.30 × (1750 − 1400) / 100 + balance on neutral ground (no home advantage).
  [id(980021)]: 5.27,
};

let owner;
const x = (sql, values) => owner.query(sql, values);
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  const run = (await x("INSERT INTO agg.power_runs(kind,method_version,status,elo_home_advantage,finished_at) VALUES ('elo','seed-importance','published',60,now()) RETURNING id")).rows[0].id;
  // A competition's country is a foreign key: the seed has France only.
  await x("INSERT INTO core.countries(code) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING", [COMPETITIONS.map((c) => c[2])]);
  for (const [cid, name, country, kind, key, level] of COMPETITIONS) {
    await x("INSERT INTO core.competitions(id,name,country_code,kind) VALUES ($1,$2,$3,$4)", [cid, name, country, kind]);
    if (key) await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('competition','pitchapi',$1,$2)", [key, cid]);
    await x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,is_current) VALUES ($1,$1,2025,'2025/2026',true)", [cid]);
    if (level !== null)
      await x("INSERT INTO agg.league_levels(competition_id,entry_level,level,teams,links,linked,run_id) VALUES ($1,$2,$2,20,10,true,$3)", [cid, level, run]);
  }
  // L6: Ligue 1 is France's highest league (1700 > 1500).
  await x(
    `INSERT INTO agg.league_levels(competition_id,entry_level,level,teams,links,linked,run_id) VALUES (1,1700,1700,4,10,true,$1)
     ON CONFLICT (competition_id) DO UPDATE SET level=1700,entry_level=1700,run_id=$1`,
    [run],
  );
  const power = (team, elo, scope, rank) =>
    x(
      `INSERT INTO agg.team_power(season_id,team_id,scope,elo,elo_change,matches,rank,run_id) VALUES (2025,$1,$2,$3,0,5,$4,$5)
       ON CONFLICT (season_id,team_id) DO UPDATE SET elo=$3,scope=$2,run_id=$5`,
      [team, scope, elo, rank, run],
    );
  for (const [team, elo] of SEED_ELO) await power(team, elo, "clubs", team);
  for (const [n, [tid, name, elo, edition, national]] of TEAMS.entries()) {
    await x("INSERT INTO core.teams(id,name,is_national) VALUES ($1,$2,$3)", [tid, name, national]);
    await x("INSERT INTO core.team_seasons(team_id,competition_season_id) VALUES ($1,$2)", [tid, edition]);
    if (elo !== null) await power(tid, elo, national ? "nations" : "clubs", 100 + n);
  }
  for (const [mid, edition, h, a, kickoff, day, status, score, round, neutral] of MATCHES) {
    let roundId = null;
    if (round)
      roundId = (await x("INSERT INTO core.rounds(competition_season_id,name,stage) VALUES ($1,$2,$3) RETURNING id", [edition, ...round])).rows[0].id;
    await x(
      `INSERT INTO core.matches(id,competition_season_id,season_id,source,status,round_id,home_team_id,away_team_id,home_score,away_score,match_date,kickoff_at,is_neutral)
       VALUES ($1,$2,2025,'pitchapi',$3,$4,$5,$6,$7,$8,$9::date,$10,$11)`,
      [mid, edition, status, roundId, h, a, score?.[0] ?? null, score?.[1] ?? null, day, kickoff, neutral ?? null],
    );
  }
  // The editions' counts (api.editions lists an edition with matches).
  await x("SELECT ops.refresh_editions()");
});
after(() => owner?.end());

const weights = (records) => records.map((r) => [r.fixture.id, r.weight]);

test("billboard: yesterday to today + 3 in Paris days, eight a day, day then importance", { skip }, async () => {
  const { response, body } = await get(home);
  assert.equal(response.status, 200);
  const b = body.data.billboard;
  // B7: the bounds used, yesterday → today + 3.
  assert.deepEqual(body.data.billboardWindow, { start: "2025-09-05", end: "2025-09-09" });
  // B1, B2, B4: 5 Sep (m5, 980005 at 00:30 Paris, 980004), 6 Sep (m6, 980009 in play), 7 Sep (the final, Ligue 2,
  // Série A; not the postponed one), 8 Sep (eight of nine), 9 Sep (the World Cup; not 980007, 10 Sep in Paris).
  assert.deepEqual(
    weights(b),
    [
      ["m_aaaaa5", 2.62], [id(980005), 1.11], [id(980004), 0.91],
      ["m_aaaaa6", 2.73], [id(980009), 1.31],
      [id(980001), 6.52], [id(980002), 1.83], [id(980003), 0.5],
      ...[8, 7, 6, 5, 4, 3, 2, 1].map((i) => [id(980010 + i), W[id(980010 + i)]]),
      [id(980021), 5.27],
    ],
  );
  assert.deepEqual([...new Set(b.map((r) => r.day))], ["2025-09-05", "2025-09-06", "2025-09-07", "2025-09-08", "2025-09-09"]);
  // The record: the fixture fields of the other lists, its kick-off time, its Paris day, its forecast when it has one.
  const m6 = b.find((r) => r.fixture.id === "m_aaaaa6");
  assert.equal(m6.time, Date.parse("2025-09-06T19:00:00Z"));
  assert.deepEqual(m6.forecast, { home: 0.5123, draw: 0.2501, away: 0.2376 });
  assert.deepEqual([m6.fixture.home_team.id, m6.fixture.away_team.id, m6.fixture.status, m6.fixture.league.id], ["t_aaaaa2", "t_aaaaa3", "not_started", "l_3FJFUl"]);
  const live = b.find((r) => r.fixture.id === id(980009));
  assert.deepEqual([live.fixture.status, live.forecast], ["in_play", null]);
  const early = b.find((r) => r.fixture.id === id(980005));
  assert.deepEqual([early.day, early.fixture.date, early.fixture.score_home], ["2025-09-05", "2025-09-04", 2]);
});

test("billboard: the visitor's leagues only", { skip }, async () => {
  const { data } = (await get("/api/read/home?season=2025/2026&leagues=l_3FJFUl")).body;
  assert.deepEqual(weights(data.billboard), [["m_aaaaa5", 2.62], ["m_aaaaa6", 2.73]]); // B5
  // B7: the window does not depend on the scope; media=1 keeps it.
  assert.deepEqual(data.billboardWindow, { start: "2025-09-05", end: "2025-09-09" });
  assert.deepEqual((await get("/api/read/home?season=2025/2026&leagues=l_3FJFUl&media=1")).body.data.billboardWindow, data.billboardWindow);
});

test("highlights keep v1's order and carry v2 as weight2", { skip }, async () => {
  const h = (await get(home)).body.data.highlights;
  assert.ok(h.length >= 2);
  // B6: v1's order (editorial weight ↓, kick-off ↑, id ↑), whatever weight2 says.
  const v1 = [...h].sort((p, q) => q.weight - p.weight || p.time - q.time || (p.fixture.id < q.fixture.id ? -1 : 1));
  assert.deepEqual(h.map((r) => r.fixture.id), v1.map((r) => r.fixture.id));
  for (const r of h) assert.equal(r.weight2, W[r.fixture.id], r.fixture.id);
  // media=1 (the site's read) keeps it too.
  const compact = (await get(home + "&media=1")).body.data.highlights;
  assert.deepEqual(compact.map((r) => [r.fixture.id, r.weight2]), h.map((r) => [r.fixture.id, r.weight2]));
});

test("importance: the nations' scale is a row, changed without touching a function", { skip }, async () => {
  // I7: centre 1500 and divisor 50 for the nations: 1.30 × (1750 − 1500) / 50 + 0.71987 = 7.22; the clubs unchanged.
  await x("UPDATE core.home_level_scales SET centre=1500,divisor=50 WHERE scope='nations'");
  try {
    const b = (await get(home + "&generation=" + (await get(home)).body.meta.generation)).body.data.billboard;
    assert.equal(b.find((r) => r.fixture.id === id(980021)).weight, 7.22);
    assert.equal(b.find((r) => r.fixture.id === id(980001)).weight, 6.52);
  } finally {
    await x("UPDATE core.home_level_scales SET centre=1400,divisor=100 WHERE scope='nations'");
  }
});

test("importance: the round's multiplier follows power.round_of", { skip }, async () => {
  // I3, I4: the SQL classification against power.py's own, on its words and its edge cases.
  const cases = [
    ["regular", "Final"], ["final", "Final"], ["knockout", "1/8"], ["knockout", "1/2"], ["playoff", "Semi-finals"],
    ["knockout", "Quarter-finals"], ["knockout", "Round of 16"], ["knockout", "Last 32"], ["knockout", "Huitièmes de finale"],
    ["knockout", "huitiemes"], ["knockout", "Seizièmes"], ["knockout", "Achtelfinale"], ["knockout", "Viertelfinale"],
    ["knockout", "Halbfinale"], ["knockout", "Demi-finales"], ["knockout", "quarts de finale"], ["final", "finale"],
    ["final", "Finals"], ["final", "The Final"], ["final", "Championship Round - Final"], ["playoff", "Third place"],
    ["qualifying", "Qualifying round 2"], ["group", "Group A"], [null, "Final"], [null, null], ["knockout", "  1/4  "],
  ];
  const python = spawnSync(
    "python3",
    ["-c", "import json,sys; from vega import power; print(json.dumps([power.round_of(s, n) for s, n in json.load(sys.stdin)]))"],
    { input: JSON.stringify(cases), encoding: "utf8", cwd: fileURLToPath(new URL("../../", import.meta.url)), env: { ...process.env, PYTHONPATH: "." } },
  );
  assert.equal(python.status, 0, python.stderr);
  const sql = await x("SELECT api.home_round_v2(c.s, c.n) r FROM ROWS FROM (jsonb_to_recordset($1::jsonb) AS (s text, n text)) WITH ORDINALITY AS c(s, n, o) ORDER BY c.o", [
    JSON.stringify(cases.map(([s, n]) => ({ s, n }))),
  ]);
  assert.deepEqual(sql.rows.map((r) => r.r), JSON.parse(python.stdout));
  // The multipliers are power.py's: a final of the Champions League, a semi-final, a knockout round.
  const stakes = await x("SELECT kind,key,multiplier::float8 m FROM core.home_stakes ORDER BY kind,key");
  const py = spawnSync("python3", ["-c", "import json; from vega import power; print(json.dumps([power.PRESTIGE, power.STAGE]))"], {
    encoding: "utf8", cwd: fileURLToPath(new URL("../../", import.meta.url)), env: { ...process.env, PYTHONPATH: "." },
  });
  const [prestige, stage] = JSON.parse(py.stdout);
  assert.deepEqual(Object.fromEntries(stakes.rows.filter((r) => r.kind === "prestige").map((r) => [r.key, r.m])), prestige);
  assert.deepEqual(Object.fromEntries(stakes.rows.filter((r) => r.kind === "round").map((r) => [r.key, r.m])), stage);
});

test("home-local: a country's competitions, its window to today + 7, its matches and its table", { skip }, async () => {
  const { response, body } = await get(local("country=FRA"));
  assert.equal(response.status, 200);
  const d = body.data;
  assert.deepEqual(Object.keys(d).sort(), ["competitions", "country", "matches", "table", "window"]);
  assert.equal(d.country, "FRA");
  // L4: the bounds used.
  assert.deepEqual(d.window, { start: "2025-09-05", end: "2025-09-13" });
  // L3: France's leagues of the season, the highest first; not the Champions League (UEFA), not Brazil.
  assert.deepEqual(d.competitions, [
    { id: "l_3FJFUl", name: "Ligue 1", country: "FRA", level: 1700 },
    { id: league(980002), name: "Ligue 2", country: "FRA", level: 1500 },
  ]);
  // L4: 5 Sep → 13 Sep; 980007 (10 Sep in Paris) and 980019 (13 Sep) are in, 980020 (14 Sep) and 980006 (4 Sep) are not;
  // every one of the nine matches of 8 Sep (no cap of eight here: rules.local_per_day is 16).
  assert.deepEqual(weights(d.matches), [
    ["m_aaaaa5", 2.62], [id(980005), 1.11], [id(980004), 0.91],
    ["m_aaaaa6", 2.73], [id(980009), 1.31],
    [id(980002), 1.83],
    ...[8, 7, 6, 5, 4, 3, 2, 1, 0].map((i) => [id(980010 + i), W[id(980010 + i)]]),
    [id(980007), 1.83],
    [id(980019), 1.83],
  ]);
  assert.deepEqual(d.matches.find((r) => r.fixture.id === "m_aaaaa6").forecast, { home: 0.5123, draw: 0.2501, away: 0.2376 });
  // L6: Ligue 1's table (Vega's own in the seed), its top six (four clubs).
  assert.equal(d.table.leagueId, "l_3FJFUl");
  assert.deepEqual(d.table.rows.map((r) => [r.id, r.position, r.points]), [["t_aaaaa1", 1, 4], ["t_aaaaa3", 2, 4], ["t_aaaaa2", 3, 3], ["t_aaaaa4", 4, 2]]);
  // Nothing personal, and the home's public cache.
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400");
});

test("home-local: Brazil, a league without level, and an unknown country", { skip }, async () => {
  const brazil = (await get(local("country=BRA"))).body.data;
  assert.deepEqual(brazil.competitions, [{ id: league(980003), name: "Série A", country: "BRA", level: null }]);
  assert.deepEqual(weights(brazil.matches), [[id(980003), 0.5]]);
  assert.equal(brazil.table, null); // L6: no league with a level, no table
  // L2: well-formed, unknown: 200, empty, cacheable, the window still given.
  const { response, body } = await get(local("country=ZZZ"));
  assert.equal(response.status, 200);
  assert.deepEqual(body.data, { country: "ZZZ", window: { start: "2025-09-05", end: "2025-09-13" }, competitions: [], matches: [], table: null });
  assert.match(response.headers.get("cache-control"), /^public, /);
  const etag = response.headers.get("etag");
  assert.ok(etag);
  assert.equal((await get(local("country=ZZZ"), { "if-none-match": etag })).response.status, 304);
});

test("home-local: generation and media", { skip }, async () => {
  const { body } = await get(local("country=FRA"));
  assert.equal((await get(local("country=FRA&generation=" + body.meta.generation))).response.status, 200);
  assert.equal((await get(local("country=FRA&generation=999999999"))).response.status, 409); // L5
  const media = await get(local("country=FRA&media=1"));
  assert.equal(media.response.status, 200);
  assert.equal(typeof media.body.media, "object");
});

// Without a database: what the route answers before any read, and how it maps what it reads (a reader that answers
// each of the route's statements with a fixed row).
function stubbed() {
  const seen = [];
  const publication = { generation: "7", published_at: "2025-09-20T11:00:00Z", source_retrieved_at: null, latest_source_retrieved_at: null,
    start_date: null, end_date: null, partition_count: 1, missing_watermarks: 0 };
  const read = async (sql) => {
    seen.push(sql);
    if (sql.includes("/*vega:v2:home-local-competitions*/"))
      return [{ id: "l_3FJFUl", name: "Ligue 1", country: "FRA", level: 1700.25, kind: "league", competition_season_id: 1, is_current: true }];
    if (sql.includes("api.edition_keys e")) return [{ season_id: 2025, ids: [1] }];
    if (sql.includes("/*vega:v2:home-local*/"))
      return [{ ...publication, window: { start: "2025-09-05", end: "2025-09-13" }, table: null,
        matches: [{ id: "m_aaaaa6", season: "2025/2026", day: "2025-09-06", time_ms: 1757185200000, local_day: "2025-09-06", status: "not_started",
          home_team_id: "t_aaaaa2", home_name: "Racing Club", away_team_id: "t_aaaaa3", away_name: "Stade Nord", league_id: "l_3FJFUl", league_name: "Ligue 1",
          importance: 2.72530001, forecast: { home_win: 0.51230001, draw: 0.2501, away_win: 0.2376 } }] }];
    if (sql.includes("FROM api.publication g")) return [publication];
    throw new Error("unexpected statement: " + sql.slice(0, 80));
  };
  return { seen, handle: createHandler({ read, clock: () => Date.parse("2025-09-06T12:00:00Z") }) };
}
const call = async (handle, path, headers = {}) => {
  const response = await handle(new Request("https://api.test" + path, { headers }));
  return { response, body: response.status === 304 ? null : await response.json() };
};

test("home-local: refuses a bad country and any personal or scope parameter, before reading", async () => {
  // L1
  for (const query of ["", "country=", "country=fra", "country=FR", "country=FRAN", "country=INT-2", "country=F1A", "country=FRA&leagues=all",
    "country=FRA&league=l_3FJFUl", "country=FRA&personalTeams=t_aaaaa1", "country=FRA&personalPlayers=p_aaaab1", "country=FRA&archive=1",
    "country=FRA&country=BRA", "country=FRA&foo=1"]) {
    const { seen, handle } = stubbed();
    const { response, body } = await call(handle, local(query));
    assert.equal(response.status, 400, query);
    assert.equal(body.error.code, "INVALID_PARAMETER");
    assert.deepEqual(seen, [], query);
  }
  const { seen, handle } = stubbed();
  assert.equal((await call(handle, "/api/read/home-local?country=FRA")).response.status, 400); // no season
  assert.equal((await call(handle, "/api/read/home-local?season=2025&country=FRA", {})).response.status, 200);
  assert.equal(seen.length, 3);
});

test("home-local: the answer's form and its public cache", async () => {
  const { handle } = stubbed();
  const { response, body } = await call(handle, local("country=FRA"));
  assert.equal(response.status, 200);
  assert.deepEqual(body.data.competitions, [{ id: "l_3FJFUl", name: "Ligue 1", country: "FRA", level: 1700.25 }]);
  assert.deepEqual(body.data.window, { start: "2025-09-05", end: "2025-09-13" });
  const [m] = body.data.matches;
  assert.deepEqual([m.fixture.id, m.time, m.day, m.weight, m.forecast], ["m_aaaaa6", 1757185200000, "2025-09-06", 2.73, { home: 0.5123, draw: 0.2501, away: 0.2376 }]);
  assert.equal(m.fixture.forecast.home, 0.5123);
  assert.equal(body.meta.generation, "7");
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400");
  // A conditional request is answered from the publication alone.
  const again = stubbed();
  const held = await call(again.handle, local("country=FRA"), { "if-none-match": response.headers.get("etag") });
  assert.equal(held.response.status, 304);
  assert.ok(!again.seen.some((sql) => sql.includes("/*vega:v2:home-local*/")));
  // HEAD needs no payload either.
  const head = stubbed();
  assert.equal((await head.handle(new Request("https://api.test" + local("country=FRA"), { method: "HEAD" }))).status, 200);
  assert.ok(!head.seen.some((sql) => sql.includes("/*vega:v2:home-local*/")));
});

// Round 2 (the site's needs, without a database):
// R1 the site reads only what the manifest announces (compactReads); home-local unannounced → the strip never shows
//    → COMPACT_READS["home-local"] is true and in the manifest's capabilities.
// R2 media=1's compact home keeps the ranks of the teams it shows only; « À l'affiche » teams lose « 1er en
//    championnat » → the ranks of the billboard's teams are kept too, the others still trimmed.
test("R1 the manifest announces home-local", () => {
  assert.equal(COMPACT_READS["home-local"], true);
  assert.equal(CAPABILITIES.compactReads["home-local"], true);
});

test("R2 media=1 keeps the ranks of the billboard's teams", () => {
  const rank = (id, n) => [id, { id, rank: n, leagueId: "l_3FJFUl", form: ["W"] }];
  const data = {
    results: [], highlights: [], tables: [], defences: [],
    ranks: [rank("t_aaaaa1", 1), rank("t_aaaaa2", 2), rank("t_aaaaa3", 3)],
    billboard: [{ fixture: { id: "m_aaaaa9", home_team: { id: "t_aaaaa1" }, away_team: { id: "t_aaaaa2" } }, time: 1, day: "2025-09-06", weight: 2 }],
  };
  // The compact cards' trim: the billboard's teams are shown, so kept; a team shown nowhere is trimmed.
  assert.deepEqual(compactHomePresentation(data).ranks, [["t_aaaaa1", { rank: 1, form: ["W"] }], ["t_aaaaa2", { rank: 2, form: ["W"] }]]);
  // What the handler serves (presentHome puts back every club's rank for « Prochains matchs »): the billboard's teams in it.
  const served = new Map(presentHome(data).ranks);
  assert.equal(served.get("t_aaaaa1").rank, 1);
  assert.equal(served.get("t_aaaaa2").rank, 2);
  assert.equal(presentHome(data).billboard.length, 1);
});

test("B7 the compact presentation keeps the billboard's window", () => {
  const data = { results: [], highlights: [], tables: [], defences: [], ranks: [], billboard: [], billboardWindow: { start: "2025-09-05", end: "2025-09-09" } };
  assert.deepEqual(compactHomePresentation(data).billboardWindow, { start: "2025-09-05", end: "2025-09-09" });
  assert.deepEqual(presentHome(data).billboardWindow, { start: "2025-09-05", end: "2025-09-09" });
});

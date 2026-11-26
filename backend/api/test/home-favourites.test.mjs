// GET /api/read/home-favourites with followed players (GH #220, docs/calculs/09-audit-2026-11/FAILURE_MODES_OPTIMISATIONS.md,
// GH220), on the API seed (test/seed.py, "now" Saturday 6 September 2025, 12:00 UTC) plus the rows below. Written before
// the fix: GH220-m fails on the base commit (each read of the followed players' appearances looked at the whole season);
// the others pass on both, they pin what the fix keeps.
//
// Failure modes and expected outcomes (GH220.2):
//  GH220-c A statistics row without its team, the line-up's team known: the line-up's team (club, opponent, score).
//  GH220-d His latest statistics row with neither team: the earlier row's club; the match kept in the week, its opponent
//          the home side (the base's rule).
//  GH220-e Only line-up rows (minutes 0): no favourite, no « Vos joueurs » entry.
//  GH220-f A key with no appearance: nothing for it; a malformed key, 101 keys: 400.
//  GH220-g National-team appearances in the season of year − 3 (2022): his national team, strength 3; only before (2021):
//          none.
//  GH220-h Club appearances in year − 2 (2023) only: listed with that club and its next match; only before (2022): not
//          listed.
//  GH220-i His latest appearance for another club in a competition of country WORLD: his club stays the league one, his
//          latest club (« Vos joueurs ») is the other one.
//  GH220-j A player who changed club this season: this season's club.
//  GH220-l media=1: the media map, private; If-None-Match: 304 in one statement; a stale generation: 409.
//  GH220-m The statement the route runs, with 100 000 line-up rows and 80 000 statistics rows of other players in the
//          season (the order at which the planner takes production's plan): the appearance scans look at the followed
//          player's rows only.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { context, get, skip } from "./context.mjs";
import { homeFavouritesQuery, parseHomeRead } from "../src/routes/home.mjs";
import { resolveEditions } from "../src/publication.mjs";

before(() => {
  if (skip) return;
  const backend = fileURLToPath(new URL("../..", import.meta.url));
  const script = `
import sys
sys.path[:0] = [sys.argv[1]]
from vega.store import connect_local, Store
db = connect_local(sys.argv[2])
x = db.execute
with db.transaction():
    for label in ("2021/2022", "2022/2023", "2023/2024", "2024/2025"):
        Store(db).season(label)
    x("INSERT INTO core.countries(code) VALUES ('WORLD'), ('INT') ON CONFLICT DO NOTHING")
    x("INSERT INTO core.teams(id, name, country_code, is_national) VALUES (9601, 'Équipe A', 'FRA', true), (9602, 'Équipe B', NULL, true)")
    x("INSERT INTO core.competitions(id, name, country_code, kind) VALUES (9601, 'Internationaux', 'INT', 'international'), (9602, 'Guest Cup', 'WORLD', 'cup')")
    x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
         ('team','pitchapi','t_natio1',9601), ('team','pitchapi','t_natio2',9602),
         ('competition','pitchapi','l_intern',9601), ('competition','pitchapi','l_guestc',9602)""")
    x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, is_current) VALUES
         (9611, 9601, 2022, '2022/2023', false), (9612, 9601, 2021, '2021/2022', false), (9613, 1, 2023, '2023/2024', false),
         (9614, 1, 2022, '2022/2023', false), (9615, 9602, 2025, '2025/2026', true), (9616, 1, 2024, '2024/2025', false)""")
    matches = [(9621, 9611, 2022, '2022-09-23', 9601, 9602, 1, 0), (9622, 9612, 2021, '2021-09-23', 9601, 9602, 2, 2),
               (9623, 9613, 2023, '2023-10-01', 3, 4, 1, 0), (9624, 9614, 2022, '2022-10-01', 2, 1, 0, 0),
               (9625, 9615, 2025, '2025-09-05', 3, 2, 2, 1), (9626, 9616, 2024, '2025-05-10', 2, 3, 1, 1)]
    for mid, cs, season, day, home, away, hs, aws in matches:
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score,
               match_date, kickoff_at) VALUES (%s,%s,%s,'pitchapi','finished',%s,%s,%s,%s,%s,%s)""", (mid, cs, season, home, away, hs, aws, day, day + 'T19:00:00Z'))
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match','pitchapi',%s,%s)", ('m_tst' + str(mid)[-3:], mid))
        x("INSERT INTO core.match_coverage(season_id, match_id, player_stats) VALUES (%s,%s,'ok')", (season, mid))
    players = {105: ('p_nulltm', 'Null Équipe'), 106: ('p_noteam', 'Sans Équipe'), 107: ('p_bench1', 'Banc Seul'), 108: ('p_natin1', 'Sélection 2022'),
               109: ('p_natou1', 'Sélection 2021'), 110: ('p_club23', 'Club 2023'), 111: ('p_club22', 'Club 2022'), 112: ('p_guest1', 'Invité'),
               113: ('p_moved1', 'Transfert'), 114: ('p_absent', 'Jamais Vu')}
    for pid, (key, name) in players.items():
        x("INSERT INTO core.players(id, name) VALUES (%s,%s)", (pid, name))
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player','pitchapi',%s,%s)", (key, pid))
    # (player, season, match, statistics' team, line-up's team, minutes); minutes None: a line-up row only.
    rows = [(105, 2025, 4, None, 2, 90), (105, 2025, 2, 3, 3, 80), (106, 2025, 4, None, None, 70), (106, 2025, 1, 1, 1, 90),
            (107, 2025, 1, None, 1, None), (107, 2025, 3, None, 1, None), (108, 2022, 9621, 9601, 9601, 90), (109, 2021, 9622, 9602, 9602, 90),
            (110, 2023, 9623, 3, 3, 90), (111, 2022, 9624, 1, 1, 90), (112, 2025, 1, 1, 1, 90), (112, 2025, 3, 1, 1, 90),
            (112, 2025, 9625, 3, 3, 90), (113, 2024, 9626, 2, 2, 90), (113, 2025, 2, 4, 4, 90)]
    for pid, season, mid, stats_team, lineup_team, minutes in rows:
        x("INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id, is_starter, position_id) VALUES (%s,%s,%s,%s,%s,81)",
          (season, mid, lineup_team, pid, minutes is not None))
        if minutes is not None:
            x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played, goals, touches) VALUES (%s,%s,%s,%s,%s,0,30)",
              (season, mid, stats_team, pid, minutes))
    # Other players of the season: 20 000 of them in the five finished matches (100 000 line-up rows, 80 000 statistics
    # rows), the order at which the planner takes the plan it takes on production's (GH220-m).
    x("INSERT INTO core.players(id, name) SELECT g, 'Autre ' || g FROM generate_series(20000, 39999) g")
    x("""CREATE TEMP TABLE others AS SELECT 2025::smallint season_id, m.id match_id,
           CASE WHEN p % 2 = 0 THEN m.home_team_id ELSE m.away_team_id END team_id, p player_id, (m.id <> p % 5 + 1) played
         FROM generate_series(20000, 39999) p CROSS JOIN core.matches m WHERE m.season_id = 2025 AND m.id BETWEEN 1 AND 5""")
    x("INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id, is_starter, position_id) SELECT season_id, match_id, team_id, player_id, played, 61 FROM others")
    x("""INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played, goals, touches)
         SELECT season_id, match_id, team_id, player_id, 45, 0, 20 FROM others WHERE played""")
# The worker's daily pass keeps the partitions' statistics (ops.analyze_partitioned); the planner reads them.
x("ANALYZE core.player_match_stats")
x("ANALYZE core.lineup_players")
`;
  const done = spawnSync("python3", ["-c", script, backend, process.env.VEGA_V2_API_NODE_TEST_DSN], { encoding: "utf8" });
  assert.equal(done.status, 0, done.stderr);
});

// GH220.4 (the reopened #220): a season of many matches and three followed players with many appearances in it, outside
// the displayed week (2025-09-01 → 2025-09-07), and their few matches of the week (GH220-t–x).
//   t_bk0001…t_bk0040 (9701…9740): 40 clubs; 1 500 finished matches between them, 1 Jul → 31 Aug 2025, in edition 1.
//   p_bulk01 (club t_bk0001): 40 of them, and m_wk0001 (3 Sep, t_bk0001 – t_bk0002) and m_wk0002 (5 Sep, t_bk0003 – t_bk0001).
//   p_bulk02 (club t_bk0002): 40 of them, m_wk0001 too (GH220-u), m_wk0004 (1 Sep, the week's first day) and m_wk0005
//            (31 Aug, the day before: GH220-w).
//   p_bulk03 (club t_bk0003): 40 of them, m_wk0002 for his club and m_wk0003 (4 Sep) for t_natio1 in an international
//            edition of 2025 (l_intern: outside leagues=l_3FJFUl, GH220-v).
before(() => {
  if (skip) return;
  const backend = fileURLToPath(new URL("../..", import.meta.url));
  const script = `
import sys
sys.path[:0] = [sys.argv[1]]
from vega.store import connect_local
db = connect_local(sys.argv[2])
x = db.execute
with db.transaction():
    for i in range(40):
        x("INSERT INTO core.teams(id, name, country_code) VALUES (%s, %s, 'FRA')", (9701 + i, 'Club %02d' % (i + 1)))
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','pitchapi',%s,%s)", ('t_bk%04d' % (i + 1), 9701 + i))
    x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, is_current) VALUES (9717, 9601, 2025, '2025/2026', true)")
    matches = []
    for i in range(1500):
        home, away = 9701 + i % 40, 9701 + (i // 40 + i % 40 + 1) % 40
        if away == home:
            away = 9701 + (away - 9701 + 1) % 40
        matches.append((9700 + i, 1, 'm_bk%04d' % (i + 1), '2025-%02d-%02d' % ((7, 1 + i % 31) if i % 62 < 31 else (8, 1 + i % 31)), home, away))
    week = [(11201, 1, 'm_wk0001', '2025-09-03', 9701, 9702), (11202, 1, 'm_wk0002', '2025-09-05', 9703, 9701),
            (11203, 9717, 'm_wk0003', '2025-09-04', 9601, 9602), (11204, 1, 'm_wk0004', '2025-09-01', 9702, 9704),
            (11205, 1, 'm_wk0005', '2025-08-31', 9704, 9702)]
    for mid, cs, key, day, home, away in matches + week:
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score,
               match_date, kickoff_at) VALUES (%s,%s,2025,'pitchapi','finished',%s,%s,%s,%s,%s,%s)""", (mid, cs, home, away, mid % 3, mid % 2, day, day + 'T19:00:00Z'))
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match','pitchapi',%s,%s)", (key, mid))
        x("INSERT INTO core.match_coverage(season_id, match_id, player_stats) VALUES (2025,%s,'ok')", (mid,))
    for pid, key, club in ((9801, 'p_bulk01', 9701), (9802, 'p_bulk02', 9702), (9803, 'p_bulk03', 9703)):
        x("INSERT INTO core.players(id, name) VALUES (%s,%s)", (pid, 'Suivi ' + key[-2:]))
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player','pitchapi',%s,%s)", (key, pid))
        played = [(m[0], club) for m in matches if club in (m[4], m[5])][:40]
        played += {9801: [(11201, 9701), (11202, 9701)], 9802: [(11201, 9702), (11204, 9702), (11205, 9702)],
                   9803: [(11202, 9703), (11203, 9601)]}[pid]
        for mid, team in played:
            x("INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id, is_starter, position_id) VALUES (2025,%s,%s,%s,true,81)", (mid, team, pid))
            x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played, goals, touches) VALUES (2025,%s,%s,%s,90,%s,40)",
              (mid, team, pid, mid % 2))
x("ANALYZE core.matches")
x("ANALYZE core.provider_ids")
x("ANALYZE core.player_match_stats")
x("ANALYZE core.lineup_players")
`;
  const done = spawnSync("python3", ["-c", script, backend, process.env.VEGA_V2_API_NODE_TEST_DSN], { encoding: "utf8" });
  assert.equal(done.status, 0, done.stderr);
});

const favourites = "/api/read/home-favourites?season=2025/2026&leagues=all";
const followed = async (keys) => (await get(`${favourites}&personalPlayers=${keys}`)).body.data;
const brief = (players) => players.map((p) => ({ playerId: p.playerId, teamId: p.teamId, matches: p.matches.map((m) => [m.matchId, m.opponentId, m.score]), next: p.next?.id ?? null }));
const queries = (response) => Number(/desc="(\d+) quer/.exec(response.headers.get("server-timing"))[1]);

test("GH220-c a statistics row without its club: the line-up's club, side, opponent and score", { skip }, async () => {
  const d = await followed("p_nulltm");
  assert.deepEqual(d.favourites, [{ teamId: "t_aaaaa2", strength: 2, reason: "player_club", players: ["p_nulltm"] }]);
  assert.deepEqual(brief(d.yourPlayers), [
    { playerId: "p_nulltm", teamId: "t_aaaaa2", matches: [["m_aaaaa2", "t_aaaaa4", [1, 1]], ["m_aaaaa4", "t_aaaaa4", [3, 2]]], next: "m_aaaaa6" },
  ]);
});

test("GH220-d the latest row with neither club: the earlier club, the match kept with the base's opponent rule", { skip }, async () => {
  const d = await followed("p_noteam");
  assert.deepEqual(d.favourites, [{ teamId: "t_aaaaa1", strength: 2, reason: "player_club", players: ["p_noteam"] }]);
  assert.deepEqual(brief(d.yourPlayers), [
    { playerId: "p_noteam", teamId: "t_aaaaa1", matches: [["m_aaaaa1", "t_aaaaa2", [2, 0]], ["m_aaaaa4", "t_aaaaa2", [2, 3]]], next: null },
  ]);
});

test("GH220-e GH220-f the bench, a key never seen, malformed keys and too many", { skip }, async () => {
  for (const key of ["p_bench1", "p_absent"]) {
    const d = await followed(key);
    assert.deepEqual([d.favourites, d.upcoming, d.yourPlayers], [[], [], []], key);
  }
  assert.equal((await get(`${favourites}&personalPlayers=p_bad`)).response.status, 400);
  const many = Array.from({ length: 101 }, (_, i) => `p_x${String(i).padStart(5, "0")}`).join(",");
  assert.equal((await get(`${favourites}&personalPlayers=${many}`)).response.status, 400);
  // A key given twice counts once.
  assert.deepEqual(await followed("p_nulltm,p_nulltm"), await followed("p_nulltm"));
});

test("GH220-g GH220-h the national team within three seasons, the latest club within two", { skip }, async () => {
  assert.deepEqual((await followed("p_natin1")).favourites, [{ teamId: "t_natio1", strength: 3, reason: "player_nation", players: ["p_natin1"] }]);
  assert.deepEqual((await followed("p_natin1")).yourPlayers, []);
  assert.deepEqual((await followed("p_natou1")).favourites, []);
  const d = await followed("p_club23");
  assert.deepEqual(d.favourites, []);
  assert.deepEqual(brief(d.yourPlayers), [{ playerId: "p_club23", teamId: "t_aaaaa3", matches: [], next: "m_aaaaa6" }]);
  assert.deepEqual((await followed("p_club22")).yourPlayers, []);
});

test("GH220-i GH220-j a guest match of country WORLD, a club change", { skip }, async () => {
  const d = await followed("p_guest1");
  assert.deepEqual(d.favourites, [{ teamId: "t_aaaaa1", strength: 2, reason: "player_club", players: ["p_guest1"] }]);
  assert.deepEqual(brief(d.yourPlayers), [
    { playerId: "p_guest1", teamId: "t_aaaaa3", matches: [["m_aaaaa1", "t_aaaaa2", [2, 0]], ["m_aaaaa3", "t_aaaaa3", [0, 1]], ["m_tst625", "t_aaaaa2", [2, 1]]], next: "m_aaaaa6" },
  ]);
  assert.deepEqual((await followed("p_moved1")).favourites, [{ teamId: "t_aaaaa4", strength: 2, reason: "player_club", players: ["p_moved1"] }]);
  // Several players at once: each his own, the favourites merged by club.
  const all = await followed("p_nulltm,p_moved1,p_natin1,p_bench1");
  assert.deepEqual(all.favourites.map((f) => [f.teamId, f.strength, f.players]), [["t_aaaaa2", 2, ["p_nulltm"]], ["t_aaaaa4", 2, ["p_moved1"]], ["t_natio1", 3, ["p_natin1"]]]);
  assert.deepEqual(all.yourPlayers.map((p) => p.playerId).sort(), ["p_moved1", "p_nulltm"]);
});

test("GH220-l media, the validator and a stale publication", { skip }, async () => {
  const path = `${favourites}&personalPlayers=p_nulltm&personalTeams=t_aaaaa3`;
  const first = await get(path);
  assert.equal(first.response.status, 200);
  assert.match(first.response.headers.get("cache-control"), /^private/);
  const again = await get(path, { "if-none-match": first.response.headers.get("etag") });
  assert.equal(again.response.status, 304);
  assert.equal(queries(again.response), 1);
  const media = await get(path + "&media=1");
  assert.equal(media.response.status, 200);
  assert.match(media.response.headers.get("cache-control"), /^private/);
  assert.deepEqual(media.body.data.yourPlayers, first.body.data.yourPlayers);
  const stale = await get(path + "&generation=1");
  assert.deepEqual([stale.response.status, stale.body.error.code], [409, "PUBLICATION_CHANGED"]);
});

test("GH220-m each read of the followed player's appearances looks at his rows only, never the season's", { skip }, async () => {
  const params = new URLSearchParams("season=2025/2026&leagues=all&personalPlayers=p_aaaab4");
  const filters = parseHomeRead(params, { personal: true });
  // What the route runs: its editions resolved, then the read.
  const { sql, values } = homeFavouritesQuery(filters, params, context.now, await resolveEditions(context.reader.read, filters.scope));
  const [row] = await context.reader.read(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, values);
  // Rows each scan of the appearance tables looked at: those it returned and those its filter dropped, per loop.
  const scans = [];
  const walk = (node) => {
    if (/^(player_match_stats|lineup_players)(_s\d{4}|_archive)?$/.test(node["Relation Name"] || ""))
      scans.push({ relation: node["Relation Name"], examined: ((node["Actual Rows"] || 0) + (node["Rows Removed by Filter"] || 0)) * (node["Actual Loops"] || 1) });
    for (const child of node.Plans || []) walk(child);
  };
  walk(row["QUERY PLAN"][0].Plan);
  const examined = scans.reduce((n, s) => n + s.examined, 0);
  assert.ok(scans.length > 0, "the statement reads the appearance tables");
  // The season holds 180 000 rows of other players; the followed player has two matches. The four reads together, each
  // through his id at the tables, look at a few dozen rows.
  assert.ok(examined <= 200, `the appearance scans looked at ${examined} rows: ${JSON.stringify(scans)}`);
  // And the answer is the one the route gives.
  const d = await followed("p_aaaab4");
  assert.deepEqual(d.favourites, [{ teamId: "t_aaaaa2", strength: 2, reason: "player_club", players: ["p_aaaab4"] }]);
  assert.deepEqual(d.yourPlayers.map((p) => p.matches.map((m) => m.matchId)), [["m_aaaaa1", "m_aaaaa4"]]);
});

// Rows each scan of `relations` looked at inside the CTE `name` of a JSON plan: returned and dropped by its filter, per loop.
function examinedIn(plan, name, relations) {
  const found = [];
  const find = (node) => {
    if (node["Subplan Name"] === `CTE ${name}`) found.push(node);
    for (const child of node.Plans || []) find(child);
  };
  find(plan);
  assert.equal(found.length, 1, `the plan holds the CTE ${name}`);
  const scans = [];
  const walk = (node) => {
    const relation = node["Relation Name"] || "";
    if (relations.test(relation))
      scans.push({ relation, node: node["Node Type"], examined: ((node["Actual Rows"] || 0) + (node["Rows Removed by Filter"] || 0)) * (node["Actual Loops"] || 1) });
    for (const child of node.Plans || []) walk(child);
  };
  walk(found[0]);
  return scans;
}

test("GH220-t the followed players' matches of the week read the week's fixtures only, never the season's", { skip }, async () => {
  const params = new URLSearchParams("season=2025/2026&leagues=all&personalPlayers=p_bulk01,p_bulk02,p_bulk03");
  const filters = parseHomeRead(params, { personal: true });
  const { sql, values } = homeFavouritesQuery(filters, params, context.now, await resolveEditions(context.reader.read, filters.scope));
  const [row] = await context.reader.read(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, values);
  const plan = row["QUERY PLAN"][0].Plan;
  const count = (scans, relation) => scans.filter((s) => s.relation === relation).reduce((n, s) => n + s.examined, 0);
  const scans = examinedIn(plan, "your_matches", /^(matches|provider_ids)$/);
  // The season holds 1 500 matches of other clubs and each followed player 40 appearances outside the week; the week
  // holds five matches of theirs.
  assert.ok(count(scans, "matches") <= 100, `matches: ${JSON.stringify(scans)}`);
  assert.ok(count(scans, "provider_ids") <= 500, `provider_ids: ${JSON.stringify(scans)}`);
});

const BASE_X = "c12b6ebe6fa24de5b373ff3d58f7d5303ffb74066c936820572879bd14661217";
const bulkBrief = (d) => brief(d.yourPlayers).sort((a, b) => a.playerId.localeCompare(b.playerId));

test("GH220-u GH220-w two followed players in one match; the week's first day kept, the day before not", { skip }, async () => {
  const d = await followed("p_bulk01,p_bulk02");
  assert.deepEqual(bulkBrief(d), [
    { playerId: "p_bulk01", teamId: "t_bk0001", matches: [["m_wk0001", "t_bk0002", [2, 1]], ["m_wk0002", "t_bk0003", [0, 0]]], next: null },
    { playerId: "p_bulk02", teamId: "t_bk0002", matches: [["m_wk0004", "t_bk0004", [2, 0]], ["m_wk0001", "t_bk0001", [1, 2]]], next: null },
  ]);
});

test("GH220-v a match of the week outside the leagues asked (his national team) is still his", { skip }, async () => {
  const d = (await get("/api/read/home-favourites?season=2025/2026&leagues=l_3FJFUl&personalPlayers=p_bulk03")).body.data;
  assert.deepEqual(bulkBrief(d), [
    { playerId: "p_bulk03", teamId: "t_bk0003", matches: [["m_wk0003", "t_natio2", [1, 1]], ["m_wk0002", "t_bk0001", [0, 0]]], next: null },
  ]);
});

test("GH220-x the three followed players and their clubs together: the base commit's answer", { skip }, async () => {
  const r = await get(`${favourites}&personalPlayers=p_bulk01,p_bulk02,p_bulk03&personalTeams=t_bk0001,t_bk0002,t_bk0003`);
  assert.equal(r.response.status, 200);
  const d = r.body.data;
  assert.deepEqual(d.favourites.map((f) => [f.teamId, f.strength, f.reason, f.players]), [
    ["t_bk0001", 1, "club", ["p_bulk01"]], ["t_bk0002", 1, "club", ["p_bulk02"]], ["t_bk0003", 1, "club", ["p_bulk03"]],
    ["t_natio1", 3, "player_nation", ["p_bulk03"]],
  ]);
  // The whole answer, byte for byte, as the base commit (e401480) gave it on this base.
  assert.equal(createHash("sha256").update(JSON.stringify(d)).digest("hex"), BASE_X, JSON.stringify(d));
  assert.deepEqual(bulkBrief(d), [
    ...bulkBrief(await followed("p_bulk01,p_bulk02")),
    ...bulkBrief(await followed("p_bulk03")),
  ]);
});

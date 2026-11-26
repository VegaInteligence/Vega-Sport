// The check a Deploy makes last (infra/aws/smoke-favourites.mjs; FAILURE_MODES_OPTIMISATIONS.md, GH220.3, GH220-n to
// GH220-r), against the real handler on the API seed behind a local HTTP server ("now" pinned to the seed's week,
// context.mjs), each case changing what one read answers. Revised after the review of 25 Nov 2026, before the probe.
//
// Failure modes and expected outcomes:
//  GH220-n the seed's player of the week and the team of his match, followed alone and together: the source said, three
//          lines (status, times, sizes, what was checked), each 200 with the club and the player found where the read
//          puts them; no name, key or body printed; exit 0.
//  GH220-o the manifest or the home answering 503, a body that is not JSON or JSON of another form; the origin closed:
//          exit 1, the read and the reason named, never « skipped ».
//  GH220-p three 200 with empty lists for a club and a player the probe found; the club missing; the player of the week
//          missing from « Vos joueurs »; an answer 503, not private, without its generation or a list: exit 1, the case
//          and what is missing named.
//  GH220-q no player of the week: the leaders' top player and his club; neither in the season: the season before; his
//          match in another week than the answer's, or a player of the week known by his national team only (review of
//          20:02: « Vos joueurs » starts from his non-national clubs, GH220-g): said, the rest checked; the operator's
//          pair, first: exit 0 each; a pair given half or malformed: exit 2.
//  GH220-r a manifest naming no season and /api/health saying the base is empty: the only skip (exit 0); the same
//          manifest unconfirmed by /api/health: exit 1; seasons but no player anywhere: exit 1, « no player to follow ».
// The reopened #220 (GH220.4, written before the probe changed): a fourth read follows a visitor's list, every read is
// held to a budget of the base's time.
//  GH220-y the seed's leaders: a fourth line « favourites many », its clubs with strength 1 and its players named, the
//          list asked once (GH220-n's three lines become four).
//  GH220-z a read whose db;dur is 3 001 ms: that line FAILED « db 3001 ms over 3000 ms », exit 1; 3 000 ms: passed.
//  GH220-aa the home naming no player but the one followed: « favourites many not checked (the home names no other
//          player) », the fourth read not asked.
//  GH220-ab the fourth answer missing a club, or naming a player nowhere: exit 1, what is missing named.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { context, get, skip } from "./context.mjs";
import { createHandler } from "../src/handler.mjs";

// A player known by his national team only, as in home-favourites.test.mjs (GH220-g): p_natin1, one appearance for
// t_natio1 in 2022 (within the read's three seasons), no club.
before(() => {
  if (skip) return;
  const script = `
import sys
sys.path[:0] = [sys.argv[1]]
from vega.store import connect_local, Store
db = connect_local(sys.argv[2])
x = db.execute
with db.transaction():
    Store(db).season("2022/2023")
    x("INSERT INTO core.countries(code) VALUES ('INT') ON CONFLICT DO NOTHING")
    x("INSERT INTO core.teams(id, name, country_code, is_national) VALUES (9601, 'Équipe A', 'FRA', true), (9602, 'Équipe B', NULL, true)")
    x("INSERT INTO core.competitions(id, name, country_code, kind) VALUES (9601, 'Internationaux', 'INT', 'international')")
    x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
         ('team','pitchapi','t_natio1',9601), ('team','pitchapi','t_natio2',9602), ('competition','pitchapi','l_intern',9601)""")
    x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, is_current) VALUES (9611, 9601, 2022, '2022/2023', false)")
    x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score,
           match_date, kickoff_at) VALUES (9621, 9611, 2022, 'pitchapi', 'finished', 9601, 9602, 1, 0, '2022-09-23', '2022-09-23T19:00:00Z')""")
    x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match','pitchapi','m_tst621',9621)")
    x("INSERT INTO core.match_coverage(season_id, match_id, player_stats) VALUES (2022, 9621, 'ok')")
    x("INSERT INTO core.players(id, name) VALUES (108, 'Sélection 2022')")
    x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player','pitchapi','p_natin1',108)")
    x("INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id, is_starter, position_id) VALUES (2022, 9621, 9601, 108, true, 81)")
    x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played, goals, touches) VALUES (2022, 9621, 9601, 108, 90, 0, 30)")
`;
  const done = spawnSync("python3", ["-c", script, fileURLToPath(new URL("../..", import.meta.url)), process.env.VEGA_V2_API_NODE_TEST_DSN], { encoding: "utf8" });
  assert.equal(done.status, 0, done.stderr);
});

const PROBE = fileURLToPath(new URL("../../../infra/aws/smoke-favourites.mjs", import.meta.url));
const servers = [];
after(() => Promise.all(servers.map((s) => new Promise((done) => s.close(done)))));

// A local origin: the real handler, but for what `change(url, real)` answers itself (`real()` is the handler's answer,
// for a change to edit). `seen` keeps every URL asked.
async function origin(change = () => null) {
  const handle = createHandler({ read: context.reader.read, clock: () => context.now });
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://local");
    seen.push(url);
    const real = () => handle(new Request(url, { method: req.method, headers: req.headers }));
    const response = (await change(url, real)) || (await real());
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  servers.push(server);
  return Object.assign(`http://127.0.0.1:${server.address().port}`, { seen });
}
async function probe(url, ...args) {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [PROBE, String(url), ...args], { timeout: 60_000 });
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    return { code: error.code, out: (error.stdout || "") + (error.stderr || "") };
  }
}
const PRIVATE = { "cache-control": "private, max-age=0, must-revalidate" };
const json = (status, value, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const text = (status, value) => new Response(value, { status, headers: { "content-type": "text/html" } });
const unavailable = () => json(503, { ok: false, available: false, error: { code: "DATA_UNAVAILABLE", message: "Données indisponibles.", retry: true } });
// The handler's answer, its JSON edited, its status and headers kept (but those given).
async function rewrite(real, edit, given = {}) {
  const response = await real();
  const body = await response.json();
  edit(body);
  const headers = Object.fromEntries([...response.headers].filter(([name]) => name !== "content-length"));
  return new Response(JSON.stringify(body), { status: response.status, headers: { ...headers, ...given } });
}
const at = (path, answer) => (url, real) => (url.pathname === path ? answer(url, real) : null);
const favourites = (answer) => at("/api/read/home-favourites", answer);
// The seed: one season, 2025/2026; its player of the week Cristiano Test (p_aaaab4), of Racing Club (t_aaaaa2), his
// match of the week m_aaaaa4; the second scorer p_aaaab1, of t_aaaaa1.
const NAMES = ["Cristiano", "Racing", "p_aaaab4", "t_aaaaa2", "m_aaaaa4", "p_aaaab1", "t_aaaaa1", "{"];
const asked = (seen) =>
  seen.filter((u) => u.pathname === "/api/read/home-favourites").map((u) => Object.fromEntries(u.searchParams));
const noPlayer = (body) => Object.assign(body.data, { potw: null, potwSeason: null, potwMatch: null });
const nobody = (body) => Object.assign(noPlayer(body), { leaders: { goals: [], assists: [] } });

test("GH220-n GH220-y the seed's player of the week and the team of his match, then its leaders: four answers checked, no name, key or body", { skip }, async () => {
  const url = await origin();
  const { code, out } = await probe(url);
  assert.equal(code, 0, out);
  const lines = out.trim().split("\n");
  assert.equal(lines[0], "favourites: following the player of the week of 2025/2026 and the team of his match");
  assert.deepEqual(lines.slice(1).map((l) => l.split(" ").slice(0, 3).join(" ")), ["favourites club 200", "favourites player 200", "favourites both 200", "favourites many 200"]);
  for (const line of lines.slice(1)) assert.match(line, /^favourites \w+ 200 \d+ ms db \d+ ms favourites=\d+ upcoming=\d+ yourPlayers=\d+ checked: .+$/);
  assert.match(lines[1], / checked: the club \(strength 1\)$/);
  assert.match(lines[2], / checked: a favourite naming the player, his match of the week$/);
  assert.match(lines[3], / checked: the club \(strength 1\), a favourite naming the player, his match of the week$/);
  // The seed's leaders: two scorers, each of his club.
  assert.match(lines[4], / checked: 2 clubs \(strength 1\), 2 players named$/);
  assert.equal(lines.length, 5, out);
  for (const secret of NAMES) assert.ok(!out.includes(secret), secret);
  // What it asked: the season the manifest names, every league, the ids the home gave.
  const scope = { season: "2025/2026", leagues: "all" };
  assert.deepEqual(asked(url.seen), [
    { ...scope, personalTeams: "t_aaaaa2" },
    { ...scope, personalPlayers: "p_aaaab4" },
    { ...scope, personalTeams: "t_aaaaa2", personalPlayers: "p_aaaab4" },
    { ...scope, personalTeams: "t_aaaaa2,t_aaaaa1", personalPlayers: "p_aaaab4,p_aaaab1" },
  ]);
});

test("GH220-o the manifest or the home answering badly, the origin closed: exit 1, the read and the reason named", { skip }, async () => {
  const cases = [
    ["/api/dashboard/manifest", unavailable, /^favourites: FAILED the manifest: status 503 DATA_UNAVAILABLE$/m],
    ["/api/dashboard/manifest", () => text(200, "<html>CloudFront</html>"), /^favourites: FAILED the manifest: not JSON$/m],
    ["/api/dashboard/manifest", () => json(200, { defaultSeason: "2025/2026" }), /^favourites: FAILED the manifest: not its form \(seasons, defaultSeason\)$/m],
    ["/api/dashboard/manifest", () => json(200, { seasons: [{ id: "2025/2026" }], defaultSeason: "2024/2025" }), /^favourites: FAILED the manifest: its default season is not one of its seasons$/m],
    ["/api/read/home", unavailable, /^favourites: FAILED the home of 2025\/2026: status 503 DATA_UNAVAILABLE$/m],
    ["/api/read/home", () => text(200, "not json"), /^favourites: FAILED the home of 2025\/2026: not JSON$/m],
    ["/api/read/home", () => json(200, { data: null }), /^favourites: FAILED the home of 2025\/2026: not its form \(data\)$/m],
  ];
  for (const [path, answer, reason] of cases) {
    const url = await origin(at(path, answer));
    const r = await probe(url);
    assert.equal(r.code, 1, `${path}: ${r.out}`);
    assert.match(r.out, reason);
    assert.doesNotMatch(r.out, /skipped/);
    assert.deepEqual(asked(url.seen), [], "the favourites are not asked");
    for (const secret of NAMES) assert.ok(!r.out.includes(secret), secret);
  }
  // A port nothing listens on: the network, after one more try.
  const free = http.createServer();
  await new Promise((done) => free.listen(0, "127.0.0.1", done));
  const port = free.address().port;
  await new Promise((done) => free.close(done));
  const closed = await probe(`http://127.0.0.1:${port}`);
  assert.equal(closed.code, 1, closed.out);
  assert.match(closed.out, /^favourites: FAILED the manifest: network \(ECONNREFUSED\)$/m);
});

test("GH220-p answers that miss what was followed, fail, or are shared: exit 1, the case and what is missing named", { skip }, async () => {
  const empty = await probe(await origin(favourites(() =>
    json(200, { data: { period: null, rules: null, favourites: [], upcoming: [], yourPlayers: [] }, meta: { generation: "7" } }, PRIVATE))));
  assert.equal(empty.code, 1, empty.out);
  assert.match(empty.out, /^favourites club 200 .* FAILED: the club is not among the favourites with strength 1$/m);
  // No favourite and no « Vos joueurs » for him: the answer knows no club of his, so his match is not asked for; the
  // missing favourite fails each read.
  assert.match(empty.out, /^favourites player 200 .* FAILED: no favourite names the player$/m);
  assert.match(empty.out, /^favourites both 200 .* FAILED: the club is not among the favourites with strength 1, no favourite names the player$/m);

  const withPlayers = (url) => url.searchParams.has("personalPlayers");
  const noClub = await probe(await origin(favourites((url, real) => (withPlayers(url) ? null : rewrite(real, (b) => { b.data.favourites = []; })))));
  assert.equal(noClub.code, 1, noClub.out);
  assert.match(noClub.out, /^favourites club 200 .* FAILED: the club is not among the favourites with strength 1$/m);
  assert.match(noClub.out, /^favourites player 200 .* checked: a favourite naming the player, his match of the week$/m);

  // His entry in « Vos joueurs » removed; then kept without his match of the week.
  for (const edit of [(b) => { b.data.yourPlayers = []; }, (b) => { for (const p of b.data.yourPlayers) p.matches = p.matches.filter((m) => m.matchId !== "m_aaaaa4"); }]) {
    const r = await probe(await origin(favourites((url, real) => (withPlayers(url) ? rewrite(real, edit) : null))));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^favourites player 200 .* FAILED: his match of the week is not in yourPlayers$/m);
    assert.match(r.out, /^favourites both 200 .* FAILED: his match of the week is not in yourPlayers$/m);
    assert.match(r.out, /^favourites club 200 .* checked: the club \(strength 1\)$/m);
  }

  const down = await probe(await origin(favourites((url) => (withPlayers(url) && !url.searchParams.has("personalTeams") ? unavailable() : null))));
  assert.equal(down.code, 1, down.out);
  assert.match(down.out, /^favourites player 503 \d+ ms db \? ms FAILED: status 503 DATA_UNAVAILABLE$/m);
  assert.match(down.out, /^favourites both 200 .* checked: /m);

  const shared = await probe(await origin(favourites((url, real) => rewrite(real, () => {}, { "cache-control": "public, max-age=0, s-maxage=60" }))));
  assert.equal(shared.code, 1, shared.out);
  assert.match(shared.out, /^favourites club 200 .* FAILED: not private$/m);

  const noGeneration = await probe(await origin(favourites((url, real) => rewrite(real, (b) => { delete b.meta.generation; }))));
  assert.equal(noGeneration.code, 1, noGeneration.out);
  assert.match(noGeneration.out, /^favourites club 200 .* FAILED: no generation$/m);

  const noList = await probe(await origin(favourites((url, real) => rewrite(real, (b) => { delete b.data.upcoming; delete b.data.yourPlayers; }))));
  assert.equal(noList.code, 1, noList.out);
  assert.match(noList.out, /^favourites club 200 .* FAILED: no upcoming, no yourPlayers$/m);

  const notJson = await probe(await origin(favourites(() => text(200, "<html>"))));
  assert.equal(notJson.code, 1, notJson.out);
  assert.match(notJson.out, /^favourites club 200 .* FAILED: not JSON$/m);
  for (const r of [empty, noClub, down, shared, noGeneration, noList, notJson]) for (const secret of NAMES) assert.ok(!r.out.includes(secret), secret);
});

test("GH220-q no player of the week: the leaders' player; none in the season: the season before; the operator's pair first", { skip }, async () => {
  const home = (edit) => at("/api/read/home", (url, real) => rewrite(real, edit));
  const leaders = await probe(await origin(home(noPlayer)));
  assert.equal(leaders.code, 0, leaders.out);
  assert.match(leaders.out, /^favourites: following the top of the leaders of 2025\/2026 and his club$/m);
  assert.match(leaders.out, /^favourites club 200 .* checked: the club \(strength 1\)$/m);
  assert.match(leaders.out, /^favourites player 200 .* checked: the player named$/m);
  assert.match(leaders.out, /^favourites both 200 .* checked: the club \(strength 1\), the player named$/m);

  // The manifest names 2026/2027 first (its default), whose home has neither: the season before, 2025/2026, its own.
  const before = await origin(async (url, real) => {
    if (url.pathname === "/api/dashboard/manifest")
      return rewrite(real, (b) => { b.seasons.unshift({ id: "2026/2027", chunks: [] }); b.defaultSeason = "2026/2027"; });
    if (url.pathname === "/api/read/home" && url.searchParams.get("season") === "2026/2027")
      return json(200, { data: { potw: null, potwSeason: null, leaders: { goals: [], assists: [] } }, meta: { generation: "7" } });
    return null;
  });
  const previous = await probe(before);
  assert.equal(previous.code, 0, previous.out);
  assert.match(previous.out, /^favourites: following the player of the week of 2025\/2026 and the team of his match$/m);
  assert.deepEqual([...new Set(asked(before.seen).map((q) => q.season))], ["2025/2026"]);

  // His match of the week dated outside the answer's week (the week changed between the two reads): said, not failed.
  const shifted = await probe(await origin(home((b) => { b.data.potw.date = "2025-08-25"; })));
  assert.equal(shifted.code, 0, shifted.out);
  assert.match(shifted.out, /^favourites player 200 .* checked: a favourite naming the player, his match of the week not checked \(another week than the answer's\)$/m);

  // A player of the week known by his national team only (the home's player of the week made p_natin1, for t_natio1,
  // dated in the displayed week as a player of the week is): the real read answers him a favourite player_nation and no
  // « Vos joueurs » (it starts from his non-national clubs, GH220-g); his match is not asked for, said; the rest checked.
  const scope = "/api/read/home-favourites?season=2025/2026&leagues=all";
  const alone = (await get(`${scope}&personalPlayers=p_natin1`)).body.data;
  assert.deepEqual([alone.favourites, alone.yourPlayers], [[{ teamId: "t_natio1", strength: 3, reason: "player_nation", players: ["p_natin1"] }], []]);
  const national = await origin(home((b) => { b.data.potw = { ...b.data.potw, playerId: "p_natin1", teamId: "t_natio1", matchId: "m_tst621", date: "2025-09-04" }; }));
  const nation = await probe(national);
  assert.equal(nation.code, 0, nation.out);
  assert.match(nation.out, /^favourites club 200 .* checked: the club \(strength 1\)$/m);
  assert.match(nation.out, /^favourites player 200 .* yourPlayers=0 checked: a favourite naming the player, his match of the week not checked \(no club of his in the base\)$/m);
  assert.match(nation.out, /^favourites both 200 .* yourPlayers=0 checked: the club \(strength 1\), a favourite naming the player, his match of the week not checked \(no club of his in the base\)$/m);
  assert.deepEqual(asked(national.seen).map((q) => [q.personalTeams, q.personalPlayers]), [["t_natio1", undefined], [undefined, "p_natin1"], ["t_natio1", "p_natin1"], ["t_natio1,t_aaaaa2,t_aaaaa1", "p_natin1,p_aaaab4,p_aaaab1"]]);
  // The same answers but his club known (a favourite player_club naming him) and « Vos joueurs » still empty: exit 1.
  const clubbed = await probe(await origin(async (url, real) => {
    if (url.pathname === "/api/read/home") return rewrite(real, (b) => { b.data.potw = { ...b.data.potw, playerId: "p_natin1", teamId: "t_natio1", matchId: "m_tst621", date: "2025-09-04" }; });
    if (url.pathname === "/api/read/home-favourites" && !url.searchParams.has("personalTeams"))
      return rewrite(real, (b) => { b.data.favourites.push({ teamId: "t_aaaaa1", strength: 2, reason: "player_club", players: ["p_natin1"] }); });
    return null;
  }));
  assert.equal(clubbed.code, 1, clubbed.out);
  assert.match(clubbed.out, /^favourites player 200 .* FAILED: his match of the week is not in yourPlayers$/m);
  assert.match(clubbed.out, /^favourites both 200 .* FAILED: his match of the week is not in yourPlayers$/m);

  // The operator's pair, before the home's players (here the home has none).
  const paired = await origin(home(nobody));
  const pair = await probe(paired, "--team", "t_aaaaa1", "--player", "p_aaaab1");
  assert.equal(pair.code, 0, pair.out);
  assert.match(pair.out, /^favourites: following the club and the player given, in 2025\/2026$/m);
  assert.match(pair.out, /^favourites both 200 .* checked: the club \(strength 1\), the player named$/m);
  assert.match(pair.out, /^favourites many not checked \(the home names no other player\)$/m);
  assert.deepEqual(asked(paired.seen).map((q) => [q.personalTeams, q.personalPlayers]), [["t_aaaaa1", undefined], [undefined, "p_aaaab1"], ["t_aaaaa1", "p_aaaab1"]]);
  for (const r of [leaders, previous, shifted, nation, clubbed, pair]) for (const secret of [...NAMES, "p_natin1", "t_natio1", "m_tst621", "Sélection"]) assert.ok(!r.out.includes(secret), secret);

  for (const args of [["--team", "t_aaaaa1"], ["--player", "p_aaaab1"], ["--team", "x_aaaaa1", "--player", "p_aaaab1"],
    ["--team", "t_aaaaa1", "--player", "p_aaaab1", "--more"], ["--team", "t_aaaaa1", "--player"]]) {
    const r = await probe(paired, ...args);
    assert.equal(r.code, 2, `${args.join(" ")}: ${r.out}`);
  }
});

test("GH220-r an empty base confirmed by /api/health: the only skip; seasons without a player to follow: exit 1", { skip }, async () => {
  const emptyManifest = at("/api/dashboard/manifest", (url, real) => rewrite(real, (b) => { b.seasons = []; b.defaultSeason = null; }));
  const pending = await probe(await origin((url, real) =>
    url.pathname === "/api/health" ? json(503, { source: "AWS", status: "pending", revision: "0" }) : emptyManifest(url, real)));
  assert.deepEqual([pending.code, pending.out.trim()], [0, "favourites: skipped (the base holds no season)"]);

  // The same manifest, /api/health saying the base holds editions (the seed's), or failing: not confirmed.
  const unconfirmed = await probe(await origin(emptyManifest));
  assert.equal(unconfirmed.code, 1, unconfirmed.out);
  assert.match(unconfirmed.out, /^favourites: FAILED the manifest names no season, but \/api\/health does not say the base is empty \(status 200\)$/m);
  const healthDown = await probe(await origin((url, real) => (url.pathname === "/api/health" ? unavailable() : emptyManifest(url, real))));
  assert.equal(healthDown.code, 1, healthDown.out);
  assert.match(healthDown.out, /\/api\/health does not say the base is empty \(status 503\)$/m);

  const none = await origin(at("/api/read/home", (url, real) => rewrite(real, nobody)));
  const r = await probe(none);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^favourites: FAILED no player to follow: the home of 2025\/2026 names no player of the week and no leader, and the manifest no season before it$/m);
  assert.doesNotMatch(r.out, /skipped/);
  assert.deepEqual(asked(none.seen), []);

  assert.equal((await probe("not-a-url")).code, 2);
});

test("GH220-z GH220-ab a read over the budget of the base's time; the fourth answer missing a club or a player", { skip }, async () => {
  const many = (url) => (url.searchParams.get("personalPlayers") || "").includes(",");
  const timed = (dur, which) => favourites((url, real) => (which(url) ? rewrite(real, () => {}, { "server-timing": `total;dur=${dur}, db;dur=${dur};desc="2 queries"` }) : null));
  const clubOnly = (url) => !url.searchParams.has("personalPlayers");
  const over = await probe(await origin(timed(3001, clubOnly)));
  assert.equal(over.code, 1, over.out);
  assert.match(over.out, /^favourites club 200 \d+ ms db 3001 ms .* FAILED: db 3001 ms over 3000 ms$/m);
  assert.match(over.out, /^favourites player 200 .* checked: /m);
  const at3000 = await probe(await origin(timed(3000, many)));
  assert.equal(at3000.code, 0, at3000.out);
  assert.match(at3000.out, /^favourites many 200 \d+ ms db 3000 ms .* checked: 2 clubs \(strength 1\), 2 players named$/m);

  const noClub = await probe(await origin(favourites((url, real) => (many(url) ? rewrite(real, (b) => { b.data.favourites = b.data.favourites.filter((f) => f.teamId !== "t_aaaaa1"); }) : null))));
  assert.equal(noClub.code, 1, noClub.out);
  assert.match(noClub.out, /^favourites many 200 .* FAILED: a club is not among the favourites with strength 1$/m);
  const unnamed = (b) => {
    b.data.favourites = b.data.favourites.map((f) => ({ ...f, players: f.players.filter((p) => p !== "p_aaaab1") }));
    b.data.yourPlayers = b.data.yourPlayers.filter((p) => p.playerId !== "p_aaaab1");
  };
  const noPlayer = await probe(await origin(favourites((url, real) => (many(url) ? rewrite(real, unnamed) : null))));
  assert.equal(noPlayer.code, 1, noPlayer.out);
  assert.match(noPlayer.out, /^favourites many 200 .* FAILED: a player is named nowhere$/m);
  for (const r of [over, at3000, noClub, noPlayer]) for (const secret of NAMES) assert.ok(!r.out.includes(secret), secret);
});

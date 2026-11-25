// Round trip of the match detail families on a real match: the provider's responses
// (backend/tests/fixtures/match_m_08LEIz), written by the collector (test/seed_match.py),
// must come back from GET /api/matches/{id}[/<family>] as they were, apart from the
// differences match-details.mjs lists.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { context, get, skip } from "./context.mjs";

// The shared seed runs first (context.mjs); this file's database is the real match only.
before(() => {
  if (skip) return;
  const seed = spawnSync("python3", [fileURLToPath(new URL("./seed_match.py", import.meta.url)), process.env.VEGA_V2_API_NODE_TEST_DSN], { encoding: "utf8" });
  assert.equal(seed.status, 0, seed.stderr);
});
const fixture = (name) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/match_m_08LEIz/${name}.json`, import.meta.url), "utf8")).data;
const BASE = "/api/matches/m_08LEIz";

// Reals are stored as reals: compare every fraction at single precision.
const numbers = (v) =>
  Array.isArray(v) ? v.map(numbers) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, numbers(x)])) : typeof v === "number" && !Number.isInteger(v) ? Math.fround(v) : v;
const byId = (key) => (list) => [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
// A stat the source sent without a value is not kept.
const valued = (groups) =>
  groups.map((g) => ({ ...g, stats: Object.fromEntries(Object.entries(g.stats).filter(([, s]) => s.stat.value !== null)) })).filter((g) => Object.keys(g.stats).length);
// The source's rating is not read any more: Vega's own grade stands in its place, and this
// match of the source's fixture has none (it is not in the seed's ranking).
const unrated = (groups) => groups.map((g) => ({ ...g, stats: Object.fromEntries(Object.entries(g.stats).filter(([label]) => label !== "Rating")) }));

async function read(suffix) {
  const { response, body } = await get(BASE + suffix);
  assert.equal(response.status, 200, suffix);
  return body.data;
}

test("the match and its line-ups, events, shots, momentum and head-to-head", { skip }, async () => {
  for (const [suffix, name] of [["", "match"], ["/events", "events"], ["/shots", "shots"], ["/momentum", "momentum"], ["/h2h", "h2h"]])
    assert.deepEqual(numbers(await read(suffix)), numbers(fixture(name)), name);
});

// R28 (FAILURE_MODES § 67): the provider's line-ups, each player with his photo in the base (or null), so the official
// elevens have their photos before the player statistics are read.
test("the line-ups, each player with his photo", { skip }, async () => {
  const lineups = await read("/lineups");
  const entries = (body) => ["home", "away"].flatMap((side) => [...body[side].starters, ...body[side].subs]);
  const bare = structuredClone(lineups);
  for (const p of entries(bare)) {
    assert.ok("image_url" in p, p.player_id);
    delete p.image_url;
  }
  assert.deepEqual(numbers(bare), numbers(fixture("lineups")));
  const photos = new Map(fixture("players").map((r) => [r.player.id, r.player.image_url ?? null]));
  for (const p of entries(lineups)) assert.equal(p.image_url, photos.get(p.player_id) ?? null, p.player_id);
  assert.ok(lineups.home.starters.some((p) => p.image_url), "a starter has a photo");
  // In the provider's order, the photo last.
  assert.deepEqual(Object.keys(lineups.home.starters[0]).at(-1), "image_url");
  // A client holding the former body (same match revision, no photos) does not get a 304 for it.
  const [{ revision }] = await context.reader.read("SELECT revision FROM api.fixtures WHERE match_id=api.internal_id('match',$1)", ["m_08LEIz"]);
  const former = `W/"match-v1-${createHash("sha256").update(`${BASE}/lineups||${revision}`).digest("hex")}"`;
  const { response } = await get(BASE + "/lineups", { "if-none-match": former });
  assert.equal(response.status, 200);
  assert.notEqual(response.headers.get("etag"), former);
});

test("team statistics: groups, labels and display strings of every period", { skip }, async () => {
  assert.deepEqual(await read("/stats"), fixture("stats"));
});

test("player statistics and halves, with the source's groups and labels", { skip }, async () => {
  const id = (r) => r.player.id;
  const players = await read("/players");
  assert.deepEqual(numbers(byId(id)(players)), numbers(byId(id)(fixture("players").map((r) => ({ ...r, stats: valued(unrated(r.stats)) })))));
  const halves = await read("/players/halves");
  const expected = fixture("players_halves");
  assert.deepEqual(
    numbers({ ...halves, players: byId(id)(halves.players) }),
    numbers({ ...expected, players: byId(id)(expected.players.map((p) => ({ ...p, periods: p.periods.map((x) => ({ ...x, stats: valued(x.stats) })) }))) }),
  );
  // Home first, in line-up order.
  const lineups = fixture("lineups"), home = lineups.home_team.id;
  const order = [...lineups.home.starters, ...lineups.home.subs].map((p) => p.player_id);
  const listed = players.filter((p) => p.team_id === home).map((p) => p.player.id);
  assert.deepEqual(listed, order.filter((p) => listed.includes(p)));
  assert.ok(players.findIndex((p) => p.team_id !== home) >= listed.length);
});

test("advanced team and player values, pass networks", { skip }, async () => {
  assert.deepEqual(numbers(await read("/advanced")), numbers(fixture("advanced")));
  const advanced = await read("/advanced/players"), id = (r) => r.player.id;
  const expected = fixture("advanced_players");
  assert.deepEqual(numbers({ ...advanced, players: byId(id)(advanced.players) }), numbers({ ...expected, players: byId(id)(expected.players) }));
  const network = await read("/advanced/network"), source = fixture("advanced_network");
  const sorted = (n) => ({
    ...n,
    networks: n.networks.map((t) => ({ ...t, nodes: byId((x) => x.player.id)(t.nodes), edges: byId((e) => e.from.id + e.to.id)(t.edges) })),
  });
  assert.deepEqual(numbers(sorted(network)), numbers(sorted(source)));
  for (const t of network.networks) assert.ok(t.nodes.every((n, i) => !i || t.nodes[i - 1].passes >= n.passes));
});

test("heatmaps in both frames", { skip }, async () => {
  const sorted = (h) => ({ ...h, players: byId((p) => p.player.id)(h.players) });
  assert.deepEqual(numbers(sorted(await read("/heatmaps"))), numbers(sorted(fixture("heatmaps"))));
  const { body } = await get(BASE + "/heatmaps?frame=home_ltr");
  assert.deepEqual(numbers(sorted(body.data)), numbers(sorted(fixture("heatmaps_home_ltr"))));
});

test("player and team profiles, and the competition catalogue", { skip }, async () => {
  const lineup = fixture("lineups").home.starters[0];
  const { body } = await get("/api/players/" + lineup.player_id);
  const photo = fixture("players").find((r) => r.player.id === lineup.player_id).player.image_url;
  assert.deepEqual(body.data, { id: lineup.player_id, name: lineup.name, image_url: photo, position_id: lineup.position_id, shirt_number: lineup.shirt_number });
  const home = fixture("match").home_team;
  assert.deepEqual((await get("/api/teams/" + home.id)).body.data, home);
  const { leagues } = (await get("/api/competitions")).body.data;
  assert.deepEqual(leagues, [{ ...fixture("match").league, seasons: ["2026/2027"], country_code: "RUS" }]);
  assert.equal((await get("/api/players/p_zzzzzz")).response.status, 404);
  assert.equal((await get("/api/pitchapi/leagues")).response.status, 404);
});

test("unknown matches, families and parameters", { skip }, async () => {
  assert.equal((await get("/api/matches/m_zzzzzz/lineups")).response.status, 404);
  assert.equal((await get(BASE + "/heatmaps?frame=away")).response.status, 400);
  assert.equal((await get(BASE + "/lineups?frame=home_ltr")).response.status, 400);
  assert.equal((await get(BASE + "/odds")).response.status, 404);
  assert.equal((await get("/api/pitchapi/matches/m_08LEIz")).response.status, 404); // no source in a route
  const first = await get(BASE + "/events");
  assert.equal((await get(BASE + "/events", { "if-none-match": first.response.headers.get("etag") })).response.status, 304);
});

test("a shot carries Vega's own expected goals when the base has scored it", async () => {
  const { shotsBody } = await import("../src/match-families.mjs");
  const row = { period: "first_half", team_id: "t_aaaaa1", id: "s1", x: 94, y: 30, minute: 12, xg: 0.21, xgot: 0.4, vega_xg: 0.18, outcome: "saved", is_on_target: true };
  const body = shotsBody("m_aaaaa1", [row, { ...row, id: "s2", vega_xg: null }]);
  const [scored, unscored] = body.periods[0].shots;
  assert.deepEqual([scored.expected_goals, scored.expected_goals_vega, scored.expected_goals_on_target], [0.21, 0.18, 0.4]);
  assert.equal("expected_goals_vega" in unscored, false);
});

test("the match display restores confirmed zeros and keeps raw and half reads independent", { skip }, async () => {
  const refresh = spawnSync("python3", ["-c", [
    "import sys",
    "from vega.store import connect_local",
    "db = connect_local(sys.argv[1])",
    "db.execute('SELECT agg.refresh_match_zeros(id) FROM core.competition_seasons')",
    "db.close()",
  ].join("\n"), process.env.VEGA_V2_API_NODE_TEST_DSN], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    encoding: "utf8",
  });
  assert.equal(refresh.status, 0, refresh.stderr);

  const stats = (players, id) => Object.fromEntries(players.find((row) => row.player.id === id).stats
    .flatMap((group) => Object.values(group.stats).map((item) => [item.key, item.stat])));
  const raw = await read("/players");
  const halvesBefore = await read("/players/halves");
  const display = await get(BASE + "/players/display");
  assert.equal(display.response.status, 200);

  const noDribbles = "p_13nLyq", noShots = "p_04vc3l", missedDribble = "p_3X9wFa";
  const shown = display.body.data;
  assert.equal(stats(raw, noDribbles).dribbles_succeeded, undefined);
  assert.deepEqual(stats(shown, noDribbles).dribbles_succeeded, {
    type: "fractionWithPercentage", value: 0, total: 0,
  });
  assert.equal(stats(raw, noShots).expected_goals, undefined);
  assert.equal(stats(shown, noShots).expected_goals.value, 0);
  assert.equal(stats(shown, noShots).total_shots.value, 0);
  assert.equal(stats(shown, noShots).ShotsOnTarget.value, 0);
  assert.deepEqual(stats(shown, missedDribble).dribbles_succeeded, stats(raw, missedDribble).dribbles_succeeded);
  assert.equal(stats(shown, "p_30KEqj").dribbles_succeeded, undefined);
  assert.equal(stats(shown, "p_3yNPPF").dribbles_succeeded, undefined);
  assert.deepEqual(await read("/players/halves"), halvesBefore);
  assert.deepEqual(await read("/players"), raw);
  const cached = await get(BASE + "/players/display", { "if-none-match": display.response.headers.get("etag") });
  assert.equal(cached.response.status, 304);
});

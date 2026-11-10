// Round trip of the match detail families on a real match: the provider's responses
// (backend/tests/fixtures/match_m_08LEIz), written by the collector (test/seed_match.py),
// must come back from GET /api/matches/{id}[/<family>] as they were, apart from the
// differences match-details.mjs lists.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { get, skip } from "./context.mjs";

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

async function read(suffix) {
  const { response, body } = await get(BASE + suffix);
  assert.equal(response.status, 200, suffix);
  return body.data;
}

test("the match and its line-ups, events, shots, momentum and head-to-head", { skip }, async () => {
  for (const [suffix, name] of [["", "match"], ["/lineups", "lineups"], ["/events", "events"], ["/shots", "shots"], ["/momentum", "momentum"], ["/h2h", "h2h"]])
    assert.deepEqual(numbers(await read(suffix)), numbers(fixture(name)), name);
});

test("team statistics: groups, labels and display strings of every period", { skip }, async () => {
  assert.deepEqual(await read("/stats"), fixture("stats"));
});

test("player statistics and halves, with the source's groups and labels", { skip }, async () => {
  const id = (r) => r.player.id;
  const players = await read("/players");
  assert.deepEqual(numbers(byId(id)(players)), numbers(byId(id)(fixture("players").map((r) => ({ ...r, stats: valued(r.stats) })))));
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

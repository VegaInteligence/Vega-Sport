// Contract tests of /api/search (relational-discovery.js on main).
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";

const search = (q, season = "2025/2026") => get(`/api/search?season=${encodeURIComponent(season)}&q=${encodeURIComponent(q)}`);
const found = (body, kind) => body[kind].map((r) => [r.id, r.rank]);

test("search: players by name, alias and context; clubs by name and initials", { skip }, async () => {
  const { response, body } = await search("Élie");
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ["clubs", "clubsHasMore", "generation", "players", "playersHasMore", "season"]);
  assert.deepEqual(body.players, [{
    kind: "players", id: "p_aaaab1", name: "Élie Durand", imageUrl: "https://img.example/p1.png", meta: "Olympique Été", outside: false, rank: 1,
  }]);
  assert.deepEqual([body.generation, body.season, body.playersHasMore, body.clubsHasMore], ["7", "2025/2026", false, false]);
  assert.deepEqual(found((await search("cr7")).body, "players"), [["p_aaaab4", 0]]);
  // Several terms: each in the name, the team or the league of the season.
  assert.deepEqual(found((await search("durand olympique")).body, "players"), [["p_aaaab1", 2]]);
  assert.deepEqual(found((await search("durand racing")).body, "players"), []);
  const sud = (await search("sud")).body;
  assert.deepEqual(found(sud, "players"), [["p_aaaab3", 2]]);
  assert.deepEqual(found(sud, "clubs"), [["t_aaaaa4", 2]]);
  assert.deepEqual(sud.clubs[0], { kind: "clubs", id: "t_aaaaa4", name: "Union Sud", imageUrl: null, meta: "Ligue 1", outside: false, rank: 2 });
  assert.deepEqual(found((await search("us")).body, "clubs"), [["t_aaaaa4", 0]]); // Union Sud's initials
  assert.deepEqual(found((await search("olympique")).body, "clubs"), [["t_aaaaa1", 1]]);
});

test("search: season membership, short queries, validation and 304", { skip }, async () => {
  const other = (await search("elie", "2024/2025")).body;
  assert.deepEqual([other.players, other.clubs], [[], []]);
  assert.deepEqual((await search("e")).body, { players: [], clubs: [], playersHasMore: false, clubsHasMore: false });
  assert.equal((await get("/api/search?q=elie")).response.status, 400);
  assert.equal((await search("a b c d e f g h i")).response.status, 400);
  const first = await search("elie");
  const again = await get("/api/search?season=2025%2F2026&q=elie", { "if-none-match": first.response.headers.get("etag") });
  assert.equal(again.response.status, 304);
});

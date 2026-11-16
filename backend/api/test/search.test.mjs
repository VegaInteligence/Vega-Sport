// Contract tests of /api/search (relational-discovery.js on main), and of how it ranks
// players. The ranking's players are written after the seed and before the tests; the
// next test file seeds again.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import { get, skip } from "./context.mjs";
import { WORD_SEPARATORS, WORD_SPLIT } from "../src/routes/search.mjs";

const search = (q, season = "2025/2026") => get(`/api/search?season=${encodeURIComponent(season)}&q=${encodeURIComponent(q)}`);
const found = (body, kind) => body[kind].map((r) => [r.id, r.rank]);

// The navbar's "Messi" of 2026/2027 (GET /api/search, November 2026) answered Messias,
// Messi Bouli, Junior Messias, Lionel Messi, Manoel Messias, Rayane Messi: the names
// beginning with "messi" first. Lionel Messi has his public id, the others fixture ids.
// (player, public id, name, club, match): the seed's clubs and finished matches of
// 2025/2026; Stade Nord (3) is the club of four of them.
const PLAYERS = [
  [9001, "p_1mZO3B", "Lionel Messi", 2, 4],
  [9002, "p_mesbou", "Messi Bouli", 1, 5],
  [9003, "p_rayms1", "Rayane Messi", 4, 5],
  // Two players of one name, written in the other order than their public ids.
  [9004, "p_zmessi", "Messias", 4, 4],
  [9005, "p_amessi", "Messias", 1, 3],
  [9006, "p_junmes", "Junior Messias", 3, 2],
  [9007, "p_manmes", "Manoel Messias", 4, 2],
  [9008, "p_andmes", "Andrea Messineo", 3, 3],
  [9009, "p_mesozi", "Mesut Özil", 3, 2],
  [9010, "p_jamrod", "James Rodríguez", 3, 3],
  [9011, "p_ngolok", "N'Golo Kanté", 2, 1],
  // Of Union Sud, the club of the seed's Hugo Sud.
  [9012, "p_hugmar", "Hugo Martin", 4, 4],
  // His name is the query, but he did not play in the season.
  [9013, "p_messi0", "Messi", null, null],
];

let owner;
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  for (const [id, key, name, team, match] of PLAYERS) {
    await owner.query("INSERT INTO core.players(id,name) VALUES ($1,$2)", [id, name]);
    await owner.query("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','pitchapi',$1,$2)", [key, id]);
    if (team)
      await owner.query("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter) VALUES (2025,$1,$2,$3,true)", [match, team, id]);
  }
});
after(() => owner?.end());

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
  // A whole word of his name (rank 1), wherever it stands.
  assert.deepEqual(found(sud, "players"), [["p_aaaab3", 1]]);
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
  // The tag an answer of the previous ranking (v1) carried is not this answer's.
  const v1 = `W/"search-v1-${createHash("sha256").update(JSON.stringify([first.body.generation, "2025/2026", "elie"])).digest("hex")}"`;
  assert.match(first.response.headers.get("etag"), /^W\/"search-v2-/);
  assert.equal((await get("/api/search?season=2025%2F2026&q=elie", { "if-none-match": v1 })).response.status, 200);
});

test("search ranks whole words of a name first, wherever they stand, then a fragment by the share of its word", { skip }, async () => {
  const messi = (await search("Messi")).body;
  // Three names holding the word, alphabetically; then "messi" as 5/7 of Messias, before
  // 5/8 of Andrea Messineo (past the six, with the second Messias). The Messi who did not
  // play in the season is not there, though his name is the query.
  assert.deepEqual(found(messi, "players"), [
    ["p_1mZO3B", 1], ["p_mesbou", 1], ["p_rayms1", 1], ["p_junmes", 2], ["p_manmes", 2], ["p_amessi", 2],
  ]);
  assert.deepEqual(messi.players.map((p) => p.name).slice(0, 3), ["Lionel Messi", "Messi Bouli", "Rayane Messi"]);
  assert.equal(messi.playersHasMore, true);
  assert.deepEqual(found((await search("Messi", "2024/2025")).body, "players"), []);
  // The exact name first, accents, case and separators aside; the same words in another
  // order are whole words.
  for (const q of ["Lionel Messi", "LIONEL messi"]) assert.deepEqual(found((await search(q)).body, "players"), [["p_1mZO3B", 0]], q);
  assert.deepEqual(found((await search("messi lionel")).body, "players"), [["p_1mZO3B", 1]]);
  assert.deepEqual(found((await search("messias")).body, "players"), [["p_amessi", 0], ["p_zmessi", 0], ["p_junmes", 1], ["p_manmes", 1]]);
  assert.deepEqual(found((await search("ÖZIL")).body, "players"), [["p_mesozi", 1]]);
  assert.deepEqual(found((await search("mesut ozil")).body, "players"), [["p_mesozi", 0]]);
  for (const q of ["N'Golo Kanté", "n golo kante", "N’GOLO-KANTE", "n.golo  kanté"])
    assert.deepEqual(found((await search(q)).body, "players"), [["p_ngolok", 0]], q);
  for (const q of ["golo", "kante golo"]) assert.deepEqual(found((await search(q)).body, "players"), [["p_ngolok", 1]], q);
  // Equal shares (3/5): the term beginning its word first (Mesut before James); every
  // fragment after the whole words, so "mes" keeps six of its eleven names.
  const mes = (await search("mes")).body;
  assert.deepEqual(found(mes, "players"), [
    ["p_1mZO3B", 2], ["p_mesbou", 2], ["p_mesozi", 2], ["p_rayms1", 2], ["p_jamrod", 2], ["p_junmes", 2],
  ]);
  assert.equal(mes.playersHasMore, true);
  // Typed characters are literal.
  for (const q of ["me%si", "mes_i", "m\\essi"]) assert.deepEqual((await search(q)).body.players, [], q);
});

test("search ranks a name holding every term before one that needs the club or the league", { skip }, async () => {
  // Hugo Sud holds both words; Hugo Martin needs his club, Union Sud.
  assert.deepEqual(found((await search("sud hugo")).body, "players"), [["p_aaaab3", 1], ["p_hugmar", 2]]);
  // With a club (Stade Nord) or a league (Ligue 1) for the other term, the name decides as
  // above: 5/7 before 5/8, then for "mes" the beginning of a word at equal share.
  assert.deepEqual(found((await search("messi nord")).body, "players"), [["p_junmes", 2], ["p_andmes", 2]]);
  assert.deepEqual(found((await search("mes nord")).body, "players"), [["p_mesozi", 2], ["p_jamrod", 2], ["p_junmes", 2], ["p_andmes", 2]]);
  const league = (await search("messi ligue")).body;
  assert.deepEqual(found(league, "players"), [
    ["p_1mZO3B", 2], ["p_mesbou", 2], ["p_rayms1", 2], ["p_junmes", 2], ["p_manmes", 2], ["p_amessi", 2],
  ]);
  assert.equal(league.playersHasMore, true);
  // An alias is exact typed whole only; with another word it is one whole word among them.
  assert.deepEqual(found((await search("cr7 test")).body, "players"), [["p_aaaab4", 1]]);
  assert.deepEqual(found((await search("cr7 racing")).body, "players"), [["p_aaaab4", 2]]);
});

test("search cuts a name into words at the characters that cut the terms", () => {
  const separators = Array.from({ length: 0x10000 }, (_, code) => String.fromCharCode(code)).filter((c) => WORD_SPLIT.test(c));
  assert.deepEqual([...WORD_SEPARATORS].sort(), separators.sort());
});

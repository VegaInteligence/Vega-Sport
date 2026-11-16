import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchIndex,
  searchIndex,
} from "../dashboard/frontend/src/services/global-search.js";

// The navbar's local index (a backend without /api/search) ranks players as the
// bounded search does (backend/api/test/search.test.mjs): the same real names,
// Lionel Messi with his public id. The minutes would have ordered them
// otherwise.
const PLAYERS = [
  ["p_1mZO3B", "Lionel Messi", "Inter Miami", 900],
  ["p_mesbou", "Messi Bouli", "Club A", 1200],
  ["p_rayms1", "Rayane Messi", "Club B", 2400],
  ["p_zmessi", "Messias", "Club C", 1500],
  ["p_amessi", "Messias", "Club D", 300],
  ["p_junmes", "Junior Messias", "Club E", 600],
  ["p_manmes", "Manoel Messias", "Club F", 700],
  ["p_andmes", "Andrea Messineo", "Inter Miami", 2000],
  ["p_mesozi", "Mesut Özil", "Club G", 100],
  ["p_jamrod", "James Rodríguez", "Club H", 3000],
  ["p_ngolok", "N'Golo Kanté", "Club I", 50],
];
const rows = PLAYERS.map(([playerId, name, team, minutes], i) => ({
  playerId,
  name,
  team,
  league: "League",
  leagueId: "l_test01",
  matchId: `m_${i}`,
  season: "2026/2027",
  date: "2026-09-01",
  minutes,
}));
const ids = (result) => result.players.map((player) => player.id);

test("the navbar ranks whole name words first, then a fragment by the share of its word", () => {
  const index = buildSearchIndex({ appearances: rows, matches: [] }, []);
  const messi = searchIndex(index, "Messi");
  assert.deepEqual(ids(messi), [
    "p_1mZO3B",
    "p_mesbou",
    "p_rayms1",
    "p_junmes",
    "p_manmes",
    "p_amessi",
  ]);
  assert.equal(messi.playersCount, 8);
  // The exact name, word for word, accents, case and separators aside.
  assert.equal(ids(searchIndex(index, "LIONEL messi"))[0], "p_1mZO3B");
  assert.equal(ids(searchIndex(index, "n golo kante"))[0], "p_ngolok");
  assert.deepEqual(ids(searchIndex(index, "ÖZIL")), ["p_mesozi"]);
  assert.deepEqual(ids(searchIndex(index, "messias")), [
    "p_amessi",
    "p_zmessi",
    "p_junmes",
    "p_manmes",
  ]);
  // 3/5 beginning a word, 3/5 inside one (James), 3/7, 3/8.
  assert.deepEqual(ids(searchIndex(index, "mes")), [
    "p_1mZO3B",
    "p_mesbou",
    "p_mesozi",
    "p_rayms1",
    "p_jamrod",
    "p_junmes",
  ]);
  // A word left to the club: the name still decides (whole before 5/8).
  assert.deepEqual(ids(searchIndex(index, "messi inter")), [
    "p_1mZO3B",
    "p_andmes",
  ]);
});

test("typing on narrows the same players, and clubs keep their order", () => {
  const index = buildSearchIndex({ appearances: rows, matches: [] }, []);
  for (const query of ["me", "mes", "mess", "messi"]) searchIndex(index, query);
  const narrowed = searchIndex(index, "messia");
  const fresh = searchIndex(
    buildSearchIndex({ appearances: [...rows], matches: [] }, []),
    "messia",
  );
  assert.deepEqual(ids(narrowed), ids(fresh));
  assert.deepEqual(ids(fresh), [
    "p_junmes",
    "p_manmes",
    "p_amessi",
    "p_zmessi",
  ]);
  // Clubs as before: the beginning of the name, then the matches played; and
  // the group shown first still compares the closest names (Messina begins
  // with "messi", Lionel Messi's word is whole).
  const side = (id, name) => ({ id, name });
  const matches = [
    ["t_fc", "Messina FC", "t_x1"],
    ["t_fc", "Messina FC", "t_x2"],
    ["t_ca", "Messina Calcio", "t_x3"],
  ].map(([id, name, other], i) => ({
    id: `m_${i}`,
    league: "League",
    home: side(id, name),
    away: side(other, `Club ${other}`),
  }));
  const clubs = buildSearchIndex(
    { appearances: rows.slice(0, 1), matches },
    [],
  );
  const result = searchIndex(clubs, "messi");
  assert.deepEqual(result.clubs.map((club) => club.id), ["t_fc", "t_ca"]);
  assert.deepEqual(result.order, ["clubs", "players", "competitions"]);
});

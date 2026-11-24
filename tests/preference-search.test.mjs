// Effect 7 (#69): in the search, at equal relevance, favourite clubs and players come first.
//  S7a Local index: a favourite with the same relevance as others is listed after them (by name) → first of them;
//      a less relevant favourite is not lifted above a better match; no favourites → the order of before.
//  S7b The server's answer (/api/search): its order is kept, except that within a run of equal relevance (the same
//      tier for players, the same score for clubs, as the site computes them) favourites come first.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchIndex,
  liftFavouriteResults,
  searchIndex,
} from "../dashboard/frontend/src/services/global-search.js";

const appearance = (playerId, name, team, minutes) => ({ playerId, name, team, teamId: "t_x", league: "L", leagueId: "l_x", date: "2026-11-01", minutes });
const match = (home, away) => ({ leagueId: "l_x", league: "L", home, away });
const data = {
  appearances: [
    appearance("p_aaa", "Lucas Alpha", "A", 900),
    appearance("p_bbb", "Lucas Beta", "B", 800),
    appearance("p_fav", "Lucas Zeta", "C", 10),
    appearance("p_far", "Lucasinho", "D", 5000),
  ],
  matches: [match({ id: "t_ra", name: "Real Avila" }, { id: "t_rb", name: "Real Burgos" }), match({ id: "t_rz", name: "Real Zamora" }, { id: "t_q", name: "Quimper" })],
};

test("S7a local index: favourites first within equal relevance only", () => {
  const index = buildSearchIndex(data, []);
  const before = searchIndex(index, "lucas").players.map((p) => p.id);
  const fav = searchIndex(index, "lucas", { favourites: { players: new Set(["p_fav"]), clubs: new Set() } }).players.map((p) => p.id);
  // "Lucas X" are whole-word matches (tier 1); Lucasinho only a prefix (tier 2): it stays last.
  assert.equal(before.at(-1), "p_far");
  assert.deepEqual(fav, ["p_fav", ...before.filter((id) => id !== "p_fav")]);
  const notLifted = searchIndex(index, "lucas", { favourites: { players: new Set(["p_far"]), clubs: new Set() } }).players.map((p) => p.id);
  assert.deepEqual(notLifted, before);
  const clubs = searchIndex(index, "real", { favourites: { clubs: new Set(["t_rz"]), players: new Set() } }).clubs.map((c) => c.id);
  assert.equal(clubs[0], "t_rz");
  assert.deepEqual(searchIndex(index, "real").clubs.map((c) => c.id).slice(0, 1), ["t_ra"]);
});

test("S7b the server's answer: favourites first within runs of equal relevance", () => {
  const players = [
    { id: "p_aaa", name: "Lucas Alpha" },
    { id: "p_bbb", name: "Lucas Beta" },
    { id: "p_fav", name: "Lucas Zeta" },
    { id: "p_far", name: "Lucasinho" },
  ];
  const lifted = liftFavouriteResults("players", players, "lucas", new Set(["p_fav"])).map((p) => p.id);
  assert.deepEqual(lifted, ["p_fav", "p_aaa", "p_bbb", "p_far"]);
  assert.deepEqual(liftFavouriteResults("players", players, "lucas", new Set(["p_far"])).map((p) => p.id), ["p_aaa", "p_bbb", "p_fav", "p_far"]);
  assert.deepEqual(liftFavouriteResults("players", players, "lucas", new Set()).map((p) => p.id), ["p_aaa", "p_bbb", "p_fav", "p_far"]);
  const clubs = [{ id: "t_ra", name: "Real Avila" }, { id: "t_rz", name: "Real Zamora" }, { id: "t_q", name: "Real" }];
  assert.deepEqual(liftFavouriteResults("clubs", clubs, "real", new Set(["t_rz"])).map((c) => c.id), ["t_rz", "t_ra", "t_q"]);
});

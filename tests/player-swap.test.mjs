import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";

// The hook reads through the resource cache; the lines are pure.
const source = await fs.readFile(new URL("../dashboard/frontend/src/services/player-swap.js", import.meta.url), "utf8");
const { swapLine, swapBlock } = await import(
  "data:text/javascript," + encodeURIComponent(source.replace(/^import .*$/m, "const useResource = null, json = null;"))
);

const answer = {
  season: "2026/2027", role: "winger", position: "Ailier / milieu offensif",
  club: { id: "t_aaaaa1", name: "Lille", elo: 1612, league: { id: "l_aaaaa1", name: "Ligue 1", matches: 34, opponentsElo: 1561 } },
  out: { id: "p_aaaaa1", name: "Joueur Sortant", rate: -0.021, minutes: 2100 },
  in: { id: "p_aaaaa2", name: "Joueur Entrant", rate: 0.284, minutes: 3050, team: { id: "t_aaaaa2", name: "Lens" } },
  estimate: { rateGap: 0.305, elo: 13.7, pointsPerMatch: 0.056, pointsPerSeason: 1.9 },
  model: { version: "lineup-v1", fittedAt: "2026-11-13T21:00:00.000Z", matches: 28524, eloPerUnit: 44.8, error: 3.2 },
};

test("an estimate reads as points per league match, then over the club's league season", () => {
  assert.deepEqual(swapLine(answer), {
    key: "p_aaaaa2", title: "Joueur Entrant à la place de Joueur Sortant", club: "Lille", estimate: true,
    text: "+0,06 point par match de Ligue 1, soit +1,9 point sur ses 34 matchs.",
    detail: "Rendement propre par 90 min : +0,28 contre -0,02, un écart qui vaut +14 Elo pour Lille.",
  });
  // A weaker player: the same sentence with its sign; two points or more take the plural.
  const worse = swapLine({ ...answer, estimate: { rateGap: -0.5, elo: -22.4, pointsPerMatch: -0.094, pointsPerSeason: -3.2 } });
  assert.equal(worse.text, "-0,09 point par match de Ligue 1, soit -3,2 points sur ses 34 matchs.");
  // A league whose matches are not known yet: the estimate per match alone.
  assert.equal(swapLine({ ...answer, club: { ...answer.club, league: { ...answer.club.league, matches: 0 } } }).text, "+0,06 point par match de Ligue 1.");
});

test("without an estimate the line says why", () => {
  const none = { ...answer, estimate: undefined };
  assert.equal(swapLine({ ...none, reason: "role", inPosition: "Avant-centre" }).text,
    "Pas d’estimation : au classement, Joueur Entrant est avant-centre et Joueur Sortant ailier / milieu offensif.");
  assert.match(swapLine({ ...none, reason: "goalkeeper" }).text, /^Pas d’estimation pour un gardien/);
  assert.match(swapLine({ ...none, reason: "minutes" }).text, /trop peu joué sur deux saisons/);
  assert.equal(swapLine({ ...none, reason: "role", inPosition: "Avant-centre" }).estimate, undefined);
  // No answer (a player the ranking has not read), or one without its figures: no line.
  assert.equal(swapLine(null), null);
  assert.equal(swapLine(none), null);
});

test("the block gathers the lines of the compared players, or is not shown", () => {
  const block = swapBlock([answer, null, { ...answer, in: { ...answer.in, id: "p_aaaaa3", name: "Autre" }, estimate: undefined, reason: "goalkeeper" }]);
  assert.deepEqual([block.club, block.estimated, block.lines.map((line) => line.key)], ["Lille", true, ["p_aaaaa2", "p_aaaaa3"]]);
  assert.equal(swapBlock([{ ...answer, estimate: undefined, reason: "goalkeeper" }]).estimated, false);
  assert.equal(swapBlock([null]), null);
  assert.equal(swapBlock(undefined), null);
});

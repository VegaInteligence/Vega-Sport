import assert from "node:assert/strict";
import test from "node:test";
import { headToHeadNote } from "../dashboard/frontend/src/services/head-to-head.js";

const A = { id: "t_a", name: "Troyes" }, B = { id: "t_b", name: "Le Havre" };
// Newest first; "A2-1" = A at home wins 2-1, "B0-0" = B at home, 0-0.
const meetings = (...codes) => codes.map((code) => {
  const [, host, home, away] = /^([AB])(\d)-(\d)$/.exec(code);
  const [first, second] = host === "A" ? [A, B] : [B, A];
  return { home: { id: first.id, score: +home }, away: { id: second.id, score: +away } };
});

test("a run of wins, of draws or of meetings without a win is said in one sentence", () => {
  assert.equal(headToHeadNote(meetings("A2-1", "B0-1", "A3-0", "B2-0"), A, B), "Troyes reste sur 3 victoires de suite contre Le Havre.");
  assert.equal(headToHeadNote(meetings("A0-1", "B2-0", "A1-3"), A, B), "Le Havre reste sur 3 victoires de suite contre Troyes.");
  assert.equal(headToHeadNote(meetings("A1-1", "B0-0", "A2-2", "A3-0"), A, B), "Les 3 dernières confrontations se sont terminées sur un nul.");
  // Draws and defeats together: the side that has not won, and since when.
  assert.equal(headToHeadNote(meetings("A1-1", "B2-0", "A0-0", "A0-1", "A2-0"), A, B), "Troyes n’a plus battu Le Havre depuis 4 confrontations.");
  assert.equal(headToHeadNote(meetings("A1-1", "B2-0", "A0-0"), A, B), "Troyes n’a battu Le Havre dans aucune des 3 confrontations collectées.");
});

test("nothing is said of two results, of a broken run or of unknown scores", () => {
  assert.equal(headToHeadNote(meetings("A2-1", "B0-1"), A, B), null);
  assert.equal(headToHeadNote(meetings("A2-1", "A0-1", "A1-0", "A0-2"), A, B), null);
  assert.equal(headToHeadNote([...meetings("A2-1", "A1-0"), { home: { id: "t_a", score: null }, away: { id: "t_b", score: null } }], A, B), null);
  assert.equal(headToHeadNote(null, A, B), null);
  assert.equal(headToHeadNote(meetings("A2-1", "A1-0", "A1-0"), A, null), null);
});

// The table on the page of a match to come (FAILURE_MODES § 80.2, 80.6; Codex on #263): the rule of the Classement tab.
//  T1 the season in play is shown; another season's is not.
//  T2 a table computed from the results (source « Vega ») of a split or play-off league is withheld, as on Classement.
//  T3 the same computed table of a plain league (Premier League) is shown.
import test from "node:test";
import assert from "node:assert/strict";
import { previewTable } from "../dashboard/frontend/src/services/match-preview.js";

const rows = (n, played) => Array.from({ length: n }, (_, i) => ({ id: "t" + i, position: i + 1, played, points: 30 - i }));
const SPLIT = "l_2L6d1F"; // Belgium: a regular season, then play-offs.
const PREMIER = "l_4WFCIZ";

test("T1 the season in play only", () => {
  const value = { season: "2026/2027", tables: [{ rows: rows(20, 12) }] };
  assert.equal(previewTable(value, { leagueId: PREMIER, season: "2026/2027" }), value);
  assert.equal(previewTable(value, { leagueId: PREMIER, season: "2025/2026" }), null);
  assert.equal(previewTable({ tables: [] }, { leagueId: PREMIER, season: "2026/2027" }), null);
});

test("T2 a result-derived table of a split league is withheld", () => {
  const value = { source: "Vega", season: "2026/2027", tables: [{ rows: rows(16, 15) }] };
  assert.equal(previewTable(value, { leagueId: SPLIT, season: "2026/2027" }), null);
  // The provider's own table of that league is shown.
  const provider = { ...value, source: "PitchAPI" };
  assert.equal(previewTable(provider, { leagueId: SPLIT, season: "2026/2027" }), provider);
});

test("T3 a result-derived table of a plain league is shown", () => {
  const value = { source: "Vega", season: "2026/2027", tables: [{ rows: rows(20, 12) }] };
  assert.equal(previewTable(value, { leagueId: PREMIER, season: "2026/2027" }), value);
});

import test from "node:test";
import assert from "node:assert/strict";
import { internationalCareerDetails } from "../dashboard/frontend/src/services/player-international-career.js";

test("summarizes only played observed dates and real shirt numbers", () => {
  const rows = [
    { date: "2026-07-19", minutes: 120, shirtNumber: "19" },
    { date: "2026-06-15", minutes: 19, shirtNumber: 19 },
    { date: "2024-09-05", minutes: 90, shirtNumber: null, positionId: 19 },
    { date: "2023-01-01", minutes: 0, shirtNumber: 10 },
    { date: "2024-02-31", minutes: 45, shirtNumber: "invalid" },
  ];
  assert.deepEqual(internationalCareerDetails(rows), {
    firstMatchDate: "2024-09-05",
    shirtNumbers: [19],
    numberedMatches: 2,
  });
});
test("missing data stays unknown and valid numbers are distinct and sorted", () => {
  assert.deepEqual(internationalCareerDetails(), {
    firstMatchDate: null,
    shirtNumbers: [],
    numberedMatches: 0,
  });
  assert.deepEqual(
    internationalCareerDetails([
      { date: "2025-01-02", minutes: 1, shirtNumber: "10" },
      { date: "2025-01-01", minutes: 1, shirtNumber: 7 },
      { date: "2025-01-03", minutes: 1, shirtNumber: 100 },
    ]),
    { firstMatchDate: "2025-01-01", shirtNumbers: [7, 10], numberedMatches: 2 },
  );
});

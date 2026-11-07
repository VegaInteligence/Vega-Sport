import test from "node:test";
import assert from "node:assert/strict";
import {
  competitionMatchRows,
  matchExternalUrl,
} from "../dashboard/frontend/src/services/player-competition-matches.js";
test("observed matches deduplicate and sort by real date, missing matches stay unknown", () => {
  const rows = [
    { matchId: "b", date: "2026-01-01" },
    { matchId: "a", date: "2026-02-01" },
    { matchId: "a", date: "2026-02-01" },
  ];
  const result = competitionMatchRows(rows, [{ id: "b", date: "2026-03-01" }]);
  assert.deepEqual(
    result.map((x) => x.row.matchId),
    ["b", "a"],
  );
  assert.equal(result[1].match, null);
});
test("UEFA links use the actual trusted source and do not guess a match", () => {
  assert.equal(
    matchExternalUrl({
      id: "uefa:123",
      sourceUrl: "https://www.uefa.com/uefanationsleague/match/123/",
    }),
    "https://www.uefa.com/uefanationsleague/match/123/",
  );
  assert.equal(
    matchExternalUrl({ id: "uefa:123", sourceUrl: "https://example.com/123" }),
    null,
  );
  assert.equal(
    matchExternalUrl({ id: "m_123", sourceUrl: "https://www.uefa.com/" }),
    null,
  );
});

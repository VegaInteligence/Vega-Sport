import test from "node:test";
import assert from "node:assert/strict";
import {
  marketClubCrest,
  loadMarketClubCrests,
} from "../dashboard/frontend/src/services/player-market-clubs.js";

const team = (id, name, imageUrl = id) => ({ id, name, imageUrl });
test("normalised exact and limited legal-affix matches reject ambiguity", () => {
  assert.equal(
    marketClubCrest("Olympique Lyonnais", [team("a", "Olympique Lyonnais")]),
    "a",
  );
  assert.equal(marketClubCrest("FC Köln", [team("b", "Koln FC")]), "b");
  assert.equal(
    marketClubCrest("FC Köln", [
      team("b", "Koln FC", "recent"),
      team("b", "Koln FC", "older"),
    ]),
    "recent",
  );
  assert.equal(
    marketClubCrest("FC Lyon", [team("a", "Lyon FC"), team("b", "Lyon AC")]),
    "",
  );
  assert.equal(
    marketClubCrest("Barcelona B", [
      team("a", "Barcelona B"),
      team("b", "Barcelona"),
    ]),
    "a",
  );
  assert.equal(marketClubCrest("Arsenal B", [team("b", "Arsenal")]), "");
  assert.equal(
    marketClubCrest("Barça Atlètic", [team("b", "FC Barcelona")]),
    "b",
  );
  assert.equal(
    marketClubCrest("Barça Atlètic", [
      team("a", "FC Barcelona B"),
      team("b", "FC Barcelona"),
    ]),
    "a",
  );
  assert.equal(
    marketClubCrest("Barcelona B", [
      team("a", "Barcelona B", ""),
      team("b", "Barcelona"),
    ]),
    "b",
  );
});
test("search failures remain isolated and cancellation propagates", async () => {
  const originalFetch = globalThis.fetch;
  const queries = [];
  globalThis.fetch = async (url) => {
    const q = new URL(url, "https://example.test").searchParams.get("q");
    queries.push(q);
    if (q === "missing") throw Error("offline");
    return Response.json({
      players: [],
      clubs: q === "barcelona" ? [team("b", "Barcelona")] : [team("a", q)],
    });
  };
  try {
    assert.deepEqual(
      await loadMarketClubCrests(
        ["Lyon", "Missing", "Barça Atlètic", "FC Barcelona"],
        "2026/2027",
      ),
      { Lyon: "a", Missing: "", "Barça Atlètic": "b", "FC Barcelona": "b" },
    );
    assert.equal(queries.filter((query) => query === "barcelona").length, 1);
    const c = new AbortController();
    c.abort();
    await assert.rejects(
      loadMarketClubCrests(["Lyon"], "2026/2027", { signal: c.signal }),
      { name: "AbortError" },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

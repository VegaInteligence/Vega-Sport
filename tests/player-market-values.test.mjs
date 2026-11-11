// A player's market values are asked for only from an API that serves them.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MARKET_VALUES_UNSERVED,
  servesMarketValues,
} from "../dashboard/frontend/src/services/player-market-values.js";

test("market values are not asked from an API that does not say it serves them", () => {
  assert.equal(servesMarketValues({ capabilities: { marketValues: true } }), true);
  for (const manifest of [null, {}, { capabilities: {} }, { capabilities: { marketValues: "yes" } }, { capabilities: { compactReads: { player: true } } }])
    assert.equal(servesMarketValues(manifest), false);
  // What the page then holds: the unavailable history its 404 gave, and nothing loading.
  assert.equal(MARKET_VALUES_UNSERVED.loading, undefined);
  assert.equal(MARKET_VALUES_UNSERVED.value, undefined);
  assert.match(MARKET_VALUES_UNSERVED.error, /indisponible/);
});

test("the retired cup index is not asked from an API that does not say it serves it", async () => {
  const { servesCupWorkerIndex } = await import("../dashboard/frontend/src/services/catalog-client.js");
  assert.equal(servesCupWorkerIndex({ capabilities: { cupWorkerIndex: true } }), true);
  for (const manifest of [null, {}, { capabilities: {} }, { capabilities: { cupWorkerIndex: 1 } }, { capabilities: { boundedSearch: true } }])
    assert.equal(servesCupWorkerIndex(manifest), false);
});

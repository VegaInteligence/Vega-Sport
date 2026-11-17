import test from "node:test";
import assert from "node:assert/strict";
import { cupProjectionSource } from "../dashboard/frontend/src/services/cup-projection.js";
import { cupId } from "../dashboard/frontend/src/services/api-routes.js";

test("a cup's projection is read from the source that holds its rounds", () => {
  // A domestic cup of open-matchday is projected from its own edition; the German cup from OpenLigaDB's (124).
  assert.deepEqual(cupProjectionSource({ source: "open-matchday", folder: "ENG_CUP_efl-cup" }), { kind: "open-matchday", key: "ENG_CUP_efl-cup" });
  assert.deepEqual(cupProjectionSource({ source: "open-matchday", folder: "GER_CUP_dfb-pokal" }), { kind: "openligadb", key: "germany-cup" });
  assert.equal(cupProjectionSource({ source: "openfootball", sourceKey: "euro" }), null);  // a tournament's archive: no projection
  assert.equal(cupProjectionSource(null), null);
});

test("an open-matchday cup's Vega id comes from the cups' index, as the other cup sources'", async () => {
  const index = { cups: [{ id: "l_v0000087", key: "ENG_CUP_efl-cup", format: "table-v1" }, { id: "l_v0000077", key: "germany-cup", format: "rounds-v1" }] };
  const read = async () => index;
  assert.equal(await cupId("open-matchday", "ENG_CUP_efl-cup", read), "l_v0000087");
  assert.equal(await cupId("openligadb", "germany-cup", read), "l_v0000077");
  assert.equal(await cupId("open-matchday", "NED_CUP_knvb-beker", read), null);
});

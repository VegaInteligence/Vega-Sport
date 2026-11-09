import { test } from "node:test";
import assert from "node:assert/strict";
import { compare } from "../parity.mjs";

test("parity ignores publication metadata and reports real differences", () => {
  const legacy = { meta: { generation: "1", startDate: "2025-08-01" }, data: { clubs: [{ id: "t_a", points: 10, xg: 1.0000001 }] } };
  const v2 = { meta: { generation: "9", startDate: "2025-08-02" }, data: { clubs: [{ id: "t_a", points: 11, xg: 1, extra: true }] } };
  assert.deepEqual(compare(legacy, v2), [
    { path: "$.meta.startDate", legacy: "2025-08-01", v2: "2025-08-02" },
    { path: "$.data.clubs[0].points", legacy: 10, v2: 11 },
    { path: "$.data.clubs[0].extra", legacy: "(missing)", v2: true },
  ]);
  assert.deepEqual(compare([1, 2], [1]), [{ path: "$.length", legacy: 2, v2: 1 }]);
});

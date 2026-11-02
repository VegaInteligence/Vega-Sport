import test from "node:test";
import assert from "node:assert/strict";
import {
  historyYears,
  inHistoryScope,
  validSourceSeason,
} from "../dashboard/scripts/history_scope.mjs";

test("a 2023 scope includes both 2023/2024 and calendar-year 2023 only", () => {
  const years = historyYears(["--history", "--years=2023"]);
  assert.equal(inHistoryScope({ season: "2023/2024" }, years), true);
  assert.equal(inHistoryScope({ season: "2023" }, years), true);
  assert.equal(inHistoryScope({ season: "2024/2025" }, years), false);
  assert.equal(inHistoryScope({ season: "2022/2023" }, years), false);
  assert.equal(inHistoryScope({ season: "2021/2022" }, null), true);
  assert.equal(validSourceSeason("2022/2024"), false);
  assert.equal(validSourceSeason("not-a-season"), false);
  assert.deepEqual([...historyYears(["--years=2023,2022"])], ["2023", "2022"]);
  assert.throws(() => historyYears(["--years=2023/2024"]), /four-digit/);
  assert.throws(() => historyYears(["--years="]), /four-digit/);
});

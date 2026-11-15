// A coming match's odds on the site: their text.
import test from "node:test";
import assert from "node:assert/strict";
import { oddsText } from "../dashboard/frontend/src/services/forecasts.js";

test("odds read with two decimals and a comma", () => {
  assert.equal(oddsText(2), "2,00");
  assert.equal(oddsText(3.456), "3,46");
  assert.equal(oddsText(null), "—");
});

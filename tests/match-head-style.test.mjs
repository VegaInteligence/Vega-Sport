// The match page's head without the line under the buttons, and its status as plain text (FAILURE_MODES.md § 70).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../dashboard/frontend/src/analysis.css", import.meta.url), "utf8");
const block = (selector) => {
  const at = css.indexOf("\n" + selector + " {");
  assert.ok(at >= 0, selector);
  return css.slice(at, css.indexOf("}", at));
};

test("R36 the scoreboard has no top border, the status no box", () => {
  assert.doesNotMatch(block(".match-scoreboard"), /border-top:\s*1px/);
  const status = block(".match-status");
  assert.doesNotMatch(status, /border:\s*1px/);
  assert.doesNotMatch(status, /background:/);
});

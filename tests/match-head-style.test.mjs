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

// The buttons as pills on the match page only (FAILURE_MODES.md § 72): every rule of match-pills.css is scoped to
// `.match-detail` under `:root`, two classes above the site's rules, so the build's stylesheet order cannot undo it.
const pills = await readFile(new URL("../dashboard/frontend/src/match-pills.css", import.meta.url), "utf8");
const layout = await readFile(new URL("../dashboard/frontend/app/layout.jsx", import.meta.url), "utf8");
const selectors = (text) =>
  [...text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?:^|})\s*([^{}@]+?)\s*\{/g)]
    .map((m) => m[1].replace(/\s+/g, " ").trim())
    .filter((sel) => sel && !/^(from|to|\d+%)$/.test(sel));

test("R41 match-pills.css styles the match page only and is loaded by the layout", () => {
  assert.match(layout, /import "\.\.\/src\/match-pills\.css";/);
  const rules = selectors(pills);
  assert.ok(rules.length > 30, "rules read: " + rules.length);
  for (const sel of rules) {
    if (/^html(\[data-theme="light"\])?$/.test(sel)) continue; // the tokens
    for (const part of sel.split(/,(?![^(]*\))/)) assert.match(part.trim(), /^:root \.match-detail\b/, sel);
  }
  for (const token of ["--pill-fill", "--pill-ink", "--pill-quiet", "--pill-quiet-hover", "--pill-quiet-ink", "--pill-track", "--pill-focus"])
    assert.equal(pills.match(new RegExp(token + ":", "g"))?.length, 2, token + " in dark and light");
});

test("R41 the head's crests have no frame or fill, the slash is gone", async () => {
  const crest = block(".scoreboard-team > .crest");
  assert.match(crest, /border:\s*0;/);
  assert.match(crest, /background:\s*none;/);
  assert.doesNotMatch(css, /\n\.scoreboard-away > \.crest \{/);
  const nav = await readFile(new URL("../dashboard/frontend/src/components/MatchNav.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(nav, /s\.slash/);
});

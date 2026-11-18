// The player page's « Forme récente »: one thin bar per rated match, a curve over the bars'
// tops, and under each bar the match it stands for (mock-up validated on 18 Nov 2026).
//
// Failure modes and expected outcomes, written before the component:
//  1. Each bar is one match: one link per match, to that match's page, oldest first.
//  2. The score and result read from the player's side: a 1–2 defeat away at Arsenal shows
//     « à Arsenal », « 1–2 » and a defeat, never « 2–1 » or a win.
//  3. A match the page has no details for keeps its bar, labelled by its competition; no
//     opponent, score or result is invented.
//  4. The figure and the colour agree: 59.5 shows « 60 » and takes the 60-and-over tone
//     (the matches table coloured 59.5 as an average match while showing 60).
//  5. The average is drawn once, labelled with its rounded figure.
//  6. The curve joins the bars' tops when there are at least two matches.
//  7. Nothing renders NaN or Infinity, whatever is missing.
// Hover, focus and tap behaviour run in the browser E2E (scratchpad evidence), not here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireLocal = createRequire(path.join(root, "dashboard/package.json"));
const React = requireLocal("react"),
  { renderToStaticMarkup } = requireLocal("react-dom/server");
const babel = requireLocal("next/dist/compiled/babel/core"),
  preset = requireLocal("next/dist/compiled/babel/preset-react"),
  commonjs = requireLocal("next/dist/compiled/babel/plugin-transform-modules-commonjs");
const e = React.createElement;
const grades = await import("../dashboard/frontend/src/services/grades.js");

const classes = new Proxy({}, { get: (_, key) => String(key) });
function load(file, stubs) {
  const filename = path.join(root, "dashboard/frontend/src", file);
  const code = babel.transformSync(fs.readFileSync(filename, "utf8"), {
    presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename,
  }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports,process){" + code + "\n})", { filename })(
    (name) => {
      if (name in stubs) return stubs[name];
      if (name.endsWith(".css")) return { __esModule: true, default: classes };
      throw new Error(`unexpected import ${name}`);
    },
    mod, mod.exports, process,
  );
  return mod.exports;
}

const FormBars = load("components/FormBars.jsx", {
  react: React,
  "next/link": { __esModule: true, default: ({ href, children, prefetch, ...rest }) => e("a", { href, ...rest }, children) },
  "../hooks/FootballContext.jsx": { useFootball: () => ({ href: (page, { id }) => `${page}?id=${id}` }) },
  "./UI.jsx": { Media: ({ name }) => e("img", { alt: "", "data-crest": name }) },
  "../services/grades.js": grades,
}).default;

const item = (over) => ({
  key: over.matchId, grade: 55, date: "2026-08-30", home: true, competition: "Premier League", minutes: 90,
  goalsAssists: "0 / 0", ...over,
});
const ITEMS = [
  item({ matchId: "m_a", grade: 55.4, date: "2026-08-30", home: true, opponent: { name: "Brighton & Hove Albion", imageUrl: "b.png" }, score: { for: 4, against: 3 }, result: "V" }),
  item({ matchId: "m_b", grade: 47.8, date: "2026-09-06", home: false, opponent: { name: "Arsenal", imageUrl: "a.png" }, score: { for: 1, against: 2 }, result: "D" }),
  item({ matchId: "m_c", grade: 50, date: "2026-09-12", home: null, opponent: null, score: null, result: null, competition: "Ligue Test" }),
  item({ matchId: "m_d", grade: 59.5, date: "2026-09-18", home: false, opponent: { name: "Brentford", imageUrl: null }, score: { for: 0, against: 3 }, result: "D" }),
];
const render = (items = ITEMS, average = 54.4) =>
  renderToStaticMarkup(e(FormBars, { items, average, ariaLabel: "Note des derniers matchs" }));
const links = (html) => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*aria-label="([^"]+)"/g)].map((m) => [m[1], m[2].replaceAll("&amp;", "&")]);

test("each bar is one match, linked to its page, oldest first (1)", () => {
  const html = render();
  assert.deepEqual(links(html).map(([href]) => href), ["/matchs/?id=m_a", "/matchs/?id=m_b", "/matchs/?id=m_c", "/matchs/?id=m_d"]);
  assert.match(html, /role="img" aria-label="Note des derniers matchs"/);
  assert.equal((html.match(/data-bar=/g) || []).length, 4);
});

test("score and result read from the player's side (2)", () => {
  const html = render();
  const [, arsenal] = links(html)[1];
  assert.equal(arsenal, "à Arsenal, défaite 1–2, 6 sept., note 48");
  assert.equal(links(html)[0][1], "vs Brighton & Hove Albion, victoire 4–3, 30 août, note 55");
  assert.match(html, /data-result="D"/);
  assert.match(html, />1–2</);
  assert.doesNotMatch(html, />2–1</);
});

test("a match without details keeps its bar, named by its competition, nothing invented (3)", () => {
  const html = render();
  assert.equal(links(html)[2][1], "Ligue Test, 12 sept., note 50");
  const column = html.split("/matchs/?id=m_c")[1].split("</a>")[0];
  assert.doesNotMatch(column, /data-result|–|vs |à /);
  assert.match(column, /Ligue Test/);
});

test("the figure and the colour agree: 59.5 shows 60 in the 60-and-over tone (4)", () => {
  const html = render();
  assert.match(html, /data-bar="60" fill="var\(--mq-pos-1\)"/);
  assert.match(html, /data-bar="48" fill="var\(--mq-mid\)"/);
  assert.match(html, />60<\/text>/);
});

test("the average is drawn once with its rounded figure (5)", () => {
  const html = render();
  assert.equal((html.match(/data-average=/g) || []).length, 1);
  assert.match(html, /data-average="54"/);
});

test("the curve joins the tops when there are two matches or more (6)", () => {
  assert.equal((render().match(/data-curve=/g) || []).length, 1);
  assert.doesNotMatch(render(ITEMS.slice(0, 1)), /data-curve=/);
});

test("nothing renders NaN or Infinity (7)", () => {
  const html = render(ITEMS, null);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  assert.doesNotMatch(html, /data-average=/);
  assert.doesNotMatch(render([]), /NaN|Infinity|undefined/);
});

// FAILURE_MODES.md §22 (C6), written before the code: the club hero's plain image (ClubScoutUI.jsx Picture, Crest)
// goes through the site's checked resolver like Media: a Vega reference is never fetched from its reserved host, an
// image the gate refuses shows the initials.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as format from "../dashboard/frontend/src/services/format.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireLocal = createRequire(path.join(root, "dashboard/package.json"));
const React = requireLocal("react");
const { renderToStaticMarkup } = requireLocal("react-dom/server");
const babel = requireLocal("next/dist/compiled/babel/core");
const preset = requireLocal("next/dist/compiled/babel/preset-react");
const commonjs = requireLocal("next/dist/compiled/babel/plugin-transform-modules-commonjs");
const h = React.createElement;

async function loadUI() {
  const filename = path.join(root, "dashboard/frontend/src/components/ClubScoutUI.jsx");
  const code = babel.transformSync(await fs.readFile(filename, "utf8"), {
    presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename,
  }).code;
  const stubs = {
    "./Hint.jsx": { Hint: () => null, Term: ({ children }) => children },
    "../services/glossary.js": { explain: () => null },
    react: React,
    "next/link": { __esModule: true, default: ({ children, ...props }) => h("a", props, children) },
    "./Icon.jsx": { __esModule: true, default: () => null },
    "./PhoneFold.jsx": { useCardFold: () => ({ section: {}, head: {}, part: "", button: null, wrap: (c) => c }) },
    "../hooks/FootballContext.jsx": { useFootball: () => null },
    "./PlayerScoutCharts.jsx": { PercentileBar: () => null, toneVar: () => "" },
    "./RankingDialog.jsx": { RankingTrigger: () => null },
    "../services/club-scout.js": { METRICS: {}, SITUATION_LABELS: {}, STYLE_AXES: [], formatMetric: String, rolling: () => [] },
    "../services/club-supported.js": {},
    "../services/format.js": format,
    "./ClubScout.module.css": { __esModule: true, default: new Proxy({}, { get: (_, name) => String(name) }) },
  };
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})", { filename })(
    (name) => {
      if (!(name in stubs)) throw new Error("Unexpected import: " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

const REFERENCE = `https://media.vega.invalid/sha256/${"a".repeat(64)}.png`;

test("the club hero's crest resolves a Vega reference through /api/assets, never its reserved host", async () => {
  const { Crest } = await loadUI();
  const html = renderToStaticMarkup(h(Crest, { club: { name: "Churchill Brothers", imageUrl: REFERENCE } }));
  assert.match(html, /<img/);
  assert.ok(html.includes(`/api/assets?url=${encodeURIComponent(REFERENCE).replaceAll("%", "%")}`.replace(/&/g, "&amp;")), html);
  assert.ok(!html.includes('src="https://media.vega.invalid'), html);
});

test("a provider image goes the same way; a refused source shows the initials", async () => {
  const { Crest, Picture } = await loadUI();
  const pitch = renderToStaticMarkup(h(Crest, { club: { name: "Arsenal", imageUrl: "https://cdn.pitchapi.dev/images/teams/a.png" } }));
  assert.ok(pitch.includes("/api/assets?url=https%3A%2F%2Fcdn.pitchapi.dev%2Fimages%2Fteams%2Fa.png"), pitch);
  for (const url of ["https://evil.example/x.png", "javascript:alert(1)", `${REFERENCE}?x=1`, undefined]) {
    const html = renderToStaticMarkup(h(Picture, { name: "Churchill Brothers", url }));
    assert.doesNotMatch(html, /<img/, String(url));
    assert.match(html, /CB/);
  }
});

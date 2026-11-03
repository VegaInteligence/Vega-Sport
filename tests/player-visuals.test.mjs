import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  observedMinutes,
  trendExtent,
} from "../dashboard/frontend/src/services/trend-chart.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireLocal = createRequire(path.join(root, "dashboard/package.json"));
const React = requireLocal("react");
const { renderToStaticMarkup } = requireLocal("react-dom/server");
const babel = requireLocal("next/dist/compiled/babel/core");
const preset = requireLocal("next/dist/compiled/babel/preset-react");
const commonjs = requireLocal(
  "next/dist/compiled/babel/plugin-transform-modules-commonjs",
);
const h = React.createElement;

async function component(file, stubs) {
  const filename = path.join(root, file);
  const code = babel.transformSync(await fs.readFile(filename, "utf8"), {
    presets: [[preset, { runtime: "classic" }]],
    plugins: [commonjs],
    babelrc: false,
    configFile: false,
    filename,
  }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})", {
    filename,
  })(
    (name) => {
      if (!(name in stubs)) throw new Error("Unexpected import: " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

test("performance identities use the observed club and competition logos", async () => {
  const data = {
    teams: [
      {
        id: "miami",
        name: "Inter Miami CF",
        imageUrl: "https://example.test/miami.webp",
      },
    ],
    competitions: [
      { id: "mls", name: "MLS", imageUrl: "https://example.test/mls.webp" },
    ],
  };
  const mod = await component(
    "dashboard/frontend/src/components/PerformanceContext.jsx",
    {
      react: React,
      "../hooks/FootballContext.jsx": { useFootball: () => ({ data }) },
      "./UI.jsx": { Media: ({ url }) => h("img", { src: url, alt: "" }) },
    },
  );
  const html = renderToStaticMarkup(
    h(mod.default, {
      teamIds: ["miami"],
      leagueIds: ["mls"],
      team: "Inter Miami CF",
      league: "MLS",
    }),
  );
  assert.match(html, /Inter Miami CF/);
  assert.match(html, />MLS</);
  assert.match(html, /miami\.webp/);
  assert.match(html, /mls\.webp/);
  const fallback = renderToStaticMarkup(
    h(mod.default, { teamIds: ["missing"], team: "Club inconnu" }),
  );
  assert.match(fallback, /Club inconnu/);
  assert.doesNotMatch(fallback, /<img/);
  const mixed = renderToStaticMarkup(
    h(mod.default, {
      teamIds: ["miami", "missing"],
      team: "Inter Miami CF · Autre club",
    }),
  );
  assert.match(mixed, /Inter Miami CF/);
  assert.match(mixed, /Autre club/);
});

test("trend scale keeps zero, negative and missing values distinct", () => {
  assert.equal(
    observedMinutes({ matches: 0, minutes: 0, unknownMinutes: 2 }),
    null,
  );
  assert.equal(
    observedMinutes({ matches: 3, minutes: 120, unknownMinutes: 1 }),
    120,
  );
  assert.equal(trendExtent([{ value: null }]), null);
  const positive = trendExtent([{ value: 0 }, { value: 2 }]);
  assert.equal(positive.low, 0);
  assert.ok(positive.high > 2);
  const negative = trendExtent([{ value: -1 }, { value: null }, { value: 1 }]);
  assert.ok(negative.low < -1 && negative.high > 1);
  const rating = trendExtent([{ value: 9.9 }, { value: 10 }], [0, 10]);
  assert.equal(rating.high, 10);
});

test("trend graphs leave a gap for missing observations and offer no export", async () => {
  const isNumber = (value) =>
    typeof value === "number" && Number.isFinite(value);
  const { ResearchTrend } = await component(
    "dashboard/frontend/src/components/ResearchCharts.jsx",
    {
      react: React,
      "../services/format.js": { isNumber, number: (value) => String(value) },
      "../services/trend-chart.js": { trendExtent },
    },
  );
  const html = renderToStaticMarkup(
    h(ResearchTrend, {
      label: "Notes",
      points: [
        { label: "A", value: 6 },
        { label: "B", value: null },
        { label: "C", value: 7 },
      ],
    }),
  );
  assert.match(html, /B : non renseigné/);
  assert.equal((html.match(/<circle/g) || []).length, 2);
  assert.doesNotMatch(html, /stroke="var\(--accent\)"|Exporter SVG/);
  const zero = renderToStaticMarkup(
    h(ResearchTrend, {
      label: "Buts",
      points: [
        { label: "A", value: 0 },
        { label: "B", value: 1 },
      ],
    }),
  );
  assert.equal((zero.match(/<circle/g) || []).length, 2);
  assert.match(zero, /stroke="var\(--accent\)"/);
});

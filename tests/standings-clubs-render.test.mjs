import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "dashboard/package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const babel = require("next/dist/compiled/babel/core");
const preset = require("next/dist/compiled/babel/preset-react");
const commonjs = require("next/dist/compiled/babel/plugin-transform-modules-commonjs");
const e = React.createElement;

test("each standings team links to its matching profile or a source-backed fallback", async () => {
  const rows = [{ name: "AS Monaco" }, { name: "Unknown FC" }];
  const Link = ({ href, children, ...props }) =>
    e("a", { href, ...props }, children);
  const stubs = {
    react: React,
    "next/link": { __esModule: true, default: Link },
    "../hooks/FootballContext.jsx": {
      useFootball: () => ({
        season: "2026/2027",
        manifest: { seasons: [{ id: "2026/2027" }] },
        href: (url, params) =>
          url +
          "?" +
          new URLSearchParams(
            Object.entries(params).filter(([, value]) => value !== ""),
          ),
      }),
    },
    "./UI.jsx": {
      Empty: ({ children }) => e("div", null, children),
      Media: () => null,
    },
    "./NationalFlag.jsx": { __esModule: true, default: () => null },
    "../services/national-flags.js": { nationalFlagCode: () => null },
    "../services/format.js": {
      normalizeText: (value) => String(value).toLowerCase(),
      number: String,
      date: String,
      seasonLabel: String,
    },
    "../services/resources.js": {
      useResource: (key) =>
        key.startsWith("sportscore-") ? { value: { tables: [{ rows }] } } : {},
      json: () => {},
    },
    "../services/sportscore-standings.js":
      await import("../dashboard/frontend/src/services/sportscore-standings.js"),
    "../services/uefa-standings.js":
      await import("../dashboard/frontend/src/services/uefa-standings.js"),
    "../services/standings-clubs.js":
      await import("../dashboard/frontend/src/services/standings-clubs.js"),
    "../services/cup-worker-client.js": {
      cupWorkerSnapshot: async () => ({ tables: [] }),
    },
    "../services/cup-catalog.js": { WORLD_CUP_ID: "l_1XLtP0" },
    "../services/catalog-client.js": { associationRanking: async () => [] },
    "../services/competition-selector.js": {
      FEATURED_EUROPE_IDS: [],
      competitionCountry: () => "",
      isTopFlight: () => false,
    },
    "../data-url.js": { dataUrl: (value) => value },
    "../hooks/ResearchContext.jsx": { useResearch: () => null },
    "../services/standings-zones.js":
      await import("../dashboard/frontend/src/services/standings-zones.js"),
    "../services/competition-standings.js":
      await import("../dashboard/frontend/src/services/competition-standings.js"),
  };
  const filename = path.join(
    root,
    "dashboard/frontend/src/components/CompetitionStandings.jsx",
  );
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
      if (!(name in stubs)) throw new Error("Unexpected import " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  const html = renderToStaticMarkup(
    e(mod.exports.default, {
      competition: { id: "l_3FJFUl", name: "Ligue 1", seasons: ["2026/2027"] },
      season: "2026/2027",
      matches: [{ home_team: { id: "t_monaco", name: "Monaco" } }],
    }),
  );
  assert.match(
    html,
    /<a[^>]*id=t_monaco[^>]*>[^<]*<span>AS Monaco<\/span><\/a>/,
  );
  assert.match(
    html,
    /<a[^>]*clubTeam=Unknown\+FC[^>]*>[^<]*<span>Unknown FC<\/span><\/a>/,
  );
  assert.match(html, /clubSeason=2026%2F2027/);
});

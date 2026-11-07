import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url)),
  requireLocal = createRequire(path.join(root, "dashboard/package.json")),
  React = requireLocal("react"),
  { renderToStaticMarkup } = requireLocal("react-dom/server"),
  babel = requireLocal("next/dist/compiled/babel/core"),
  preset = requireLocal("next/dist/compiled/babel/preset-react"),
  commonjs = requireLocal(
    "next/dist/compiled/babel/plugin-transform-modules-commonjs",
  ),
  e = React.createElement;

test("club facts and ranking do not consume requests before their section approaches the viewport", async () => {
  let visible = false,
    facts = 0,
    rankings = 0;
  const context = { season: "2026/2027", href: (path) => path },
    stubs = {
      react: React,
      "next/link": {
        __esModule: true,
        default: ({ children, href }) => e("a", { href }, children),
      },
      "next/navigation": {},
      "../hooks/FootballContext.jsx": { useFootball: () => context },
      "../hooks/useActorRead.js": {},
      "../hooks/useVisibleIntent.js": {
        __esModule: true,
        default: () => [null, visible],
      },
      "../hooks/useCompactRead.js": {},
      "../services/actor-reads.js": {},
      "../services/compact-reads.js": {},
      "../services/club-analysis.js": {
        upcomingClubMatches: () => [],
        clubMetric: () => ({ value: null, count: 0 }),
      },
      "../services/format.js":
        await import("../dashboard/frontend/src/services/format.js"),
      "./UI.jsx": { Empty: ({ children }) => e("p", null, children) },
      "./Icon.jsx": {},
      "./CompetitionOptions.jsx": {},
      "./MatchLink.jsx": { MatchLink: () => null },
      "./ClubForm.jsx": { __esModule: true, default: () => null },
      "./ClubProfile.jsx": {
        ClubFacts: () => {
          facts++;
          return e("p", null, "Club facts");
        },
      },
      "./ClubRanking.jsx": {
        __esModule: true,
        default: () => {
          rankings++;
          return e("p", null, "Club ranking");
        },
      },
      "./ResearchUI.jsx": {},
      "./ResearchCharts.jsx": {},
    },
    filename = path.join(
      root,
      "dashboard/frontend/src/components/ClubWorkspace.jsx",
    ),
    source = await fs.readFile(filename, "utf8"),
    code = babel.transformSync(source + "\nexport { Overview };\n", {
      presets: [[preset, { runtime: "classic" }]],
      plugins: [commonjs],
      babelrc: false,
      configFile: false,
      filename,
    }).code,
    mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})", {
    filename,
  })(
    (name) => {
      if (!(name in stubs)) throw Error("Unexpected import " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  const render = () =>
    renderToStaticMarkup(
      e(mod.exports.Overview, {
        club: { id: "t_000001" },
        summary: { matches: 0, unscored: 0, forms: [] },
        history: [],
        allHistory: [],
        competitionName: "Ligue 1",
      }),
    );
  const first = render();
  assert.match(first, /Derniers résultats/);
  assert.equal(facts, 0);
  assert.equal(rankings, 0);
  visible = true;
  const scrolled = render();
  assert.match(scrolled, /Club facts/);
  assert.match(scrolled, /Club ranking/);
  assert.equal(facts, 1);
  assert.equal(rankings, 1);
});

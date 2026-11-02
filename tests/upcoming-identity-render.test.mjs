import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

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

test("calendar and home preview render each Premier League with its own logo and country", async () => {
  const fixtures =
    await import("../dashboard/frontend/src/services/fixtures.js");
  const identities =
    await import("../dashboard/frontend/src/services/competition-identity.js");
  const rus = {
    id: "l_2Mh0jT",
    name: "Premier League",
    country: "RUS",
    imageUrl: "russian-logo",
  };
  const eng = {
    id: "l_4WFCIZ",
    name: "Premier League",
    country: "ENG",
    imageUrl: "english-logo",
  };
  const context = {
    data: {
      competitions: [rus, eng],
      fixtures: [
        {
          id: "english-match",
          status: "not_started",
          date: "2026-11-02",
          time_utc: "2026-11-02T20:00:00Z",
          league: { id: eng.id, name: eng.name },
          home_team: { name: "Newcastle" },
          away_team: { name: "Everton" },
        },
        {
          id: "russian-match",
          status: "not_started",
          date: "2026-11-02",
          time_utc: "2026-11-02T15:00:00Z",
          league: { id: rus.id, name: rus.name },
          home_team: { name: "Krylya Sovetov" },
          away_team: { name: "Zenit" },
        },
      ],
    },
    competitions: [rus, eng],
    catalog: [rus, eng],
    filters: { query: "", league: "all" },
    focus: "all",
    season: "2026/2027",
    manifest: { defaultSeason: "2026/2027" },
    preferences: { favoriteLeagueIds: [] },
    href: (url) => url,
  };
  const reactStub = {
    ...React,
    useState: (initial) =>
      React.useState(
        typeof initial === "function"
          ? () => Date.parse("2026-11-02T12:00:00Z")
          : initial,
      ),
  };
  const stubs = {
    react: reactStub,
    "next/link": {
      __esModule: true,
      default: ({ href, children, ...props }) =>
        h("a", { href, ...props }, children),
    },
    "next/navigation": { useSearchParams: () => new URLSearchParams() },
    "../hooks/FootballContext.jsx": { useFootball: () => context },
    "./UI.jsx": {
      Media: ({ url, className }) =>
        h("span", { "data-logo": url || "", className }),
      Pager: () => null,
    },
    "./Icon.jsx": { __esModule: true, default: () => null },
    "../services/fixtures.js": fixtures,
    "../services/competition-identity.js": identities,
  };
  const filename = path.join(
    root,
    "dashboard/frontend/src/components/UpcomingMatches.jsx",
  );
  const source = await fs.readFile(filename, "utf8");
  const compiled = babel.transformSync(source, {
    presets: [[preset, { runtime: "classic" }]],
    plugins: [commonjs],
    babelrc: false,
    configFile: false,
    filename,
  }).code;
  const mod = { exports: {} };
  const run = vm.runInThisContext(
    "(function(require,module,exports){" + compiled + "\n})",
    { filename },
  );
  run(
    (name) => {
      if (!(name in stubs)) throw Error("Unexpected import " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  for (const compact of [false, true]) {
    const html = renderToStaticMarkup(h(mod.exports.default, { compact }));
    assert.match(html, /Russie/);
    assert.match(html, /Angleterre/);
    assert.match(html, /data-logo="russian-logo"/);
    assert.match(html, /data-logo="english-logo"/);
    assert.ok(
      html.indexOf('data-fixture-id="russian-match"') <
        html.indexOf('data-fixture-id="english-match"'),
    );
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
  commonjs = requireLocal(
    "next/dist/compiled/babel/plugin-transform-modules-commonjs",
  );
const e = React.createElement;

test("club cards render coach, attributed photo, stadium and four player lines", async () => {
  const roster =
    await import("../dashboard/frontend/src/services/club-roster.js");
  const format = await import("../dashboard/frontend/src/services/format.js");
  const payload = {
    wiki: {
      sourceUrl: "https://www.wikidata.org/entity/Q1543",
      fetchedAt: "2026-11-02T12:00:00Z",
      stadium: "Stade Giuseppe-Meazza",
      stadiumAlias: "San Siro",
      founded: "1899",
      coach: {
        name: "Rúben Amorim",
        photo: {
          url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/coach.jpg",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:coach.jpg",
          author: "Photographer",
          license: "CC BY 3.0",
        },
      },
    },
    observedCoach: { name: "Ruben Amorim", date: "2026-10-31" },
    observedStadium: null,
  };
  const stubs = {
    react: React,
    "next/link": {
      __esModule: true,
      default: ({ href, children, ...props }) =>
        e("a", { href, ...props }, children),
    },
    "./UI.jsx": {
      Card: ({ title, children, action }) =>
        e("section", null, e("h2", null, title), action, children),
      Media: ({ name, url }) =>
        e("span", null, url ? e("img", { src: url, alt: "" }) : name),
    },
    "../services/resources.js": {
      useResource: () => ({ value: payload, loading: false }),
    },
    "./StadiumDialog.jsx": { __esModule: true, default: () => null },
    "../services/club-facts.js": { loadClubFacts: () => {} },
    "../services/club-roster.js": roster,
    "../services/format.js": format,
  };
  const filename = path.join(
    root,
    "dashboard/frontend/src/components/ClubProfile.jsx",
  );
  const source = await fs.readFile(filename, "utf8");
  const code = babel.transformSync(source, {
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
    (n) => {
      if (!(n in stubs)) throw Error(n);
      return stubs[n];
    },
    mod,
    mod.exports,
  );
  const facts = renderToStaticMarkup(
    e(mod.exports.ClubFacts, { club: { id: "club" }, matches: [] }),
  );
  assert.match(facts, /Rúben Amorim/);
  assert.match(facts, /San Siro/);
  assert.match(facts, /<button[^>]*class="stadium-link"[^>]*>/);
  assert.match(facts, /Photographer/);
  assert.match(facts, /CC BY 3.0/);
  assert.match(facts, /commons.wikimedia.org/);
  const rows = [
    [11, "Gardien"],
    [1, "Défenseur"],
    [2, "Milieu"],
    [3, "Attaquant"],
  ].map(([positionId, name], i) => ({
    teamId: "club",
    playerId: String(i),
    positionId,
    name,
    date: "2026-10-01",
  }));
  const html = renderToStaticMarkup(
    e(mod.exports.ClubRoster, {
      clubId: "club",
      appearances: rows,
      season: "2026/2027",
      href: (url, params) => url + params.id,
    }),
  );
  for (const label of ["Gardiens", "Défenseurs", "Milieux", "Attaquants"])
    assert.match(html, new RegExp(label));
  assert.equal((html.match(/class="roster-player"/g) || []).length, 4);
  assert.match(
    html,
    /l’effectif affiché peut être incomplet/,
  );
});

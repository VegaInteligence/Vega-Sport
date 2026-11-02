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

test("stadium dialog renders sourced dates, capacity and a map only with coordinates", async () => {
  const format = await import("../dashboard/frontend/src/services/format.js");
  let stadium = {
    capacity: 75817,
    capacityAsOf: "2022-09-25",
    opened: "1926-09-19",
    created: "1925-08",
    coordinates: { lat: 45.478, lon: 9.124 },
    sourceUrl: "https://www.wikidata.org/wiki/Q133566",
    fetchedAt: "2026-11-02T12:00:00Z",
  };
  const stubs = {
    react: React,
    "./UI.jsx": {
      Modal: ({ title, children }) =>
        e("section", null, e("h2", null, title), children),
      AsyncState: ({ resource, children }) => children(resource.value),
    },
    "../services/resources.js": {
      useResource: () => ({ value: stadium, loading: false }),
      json: () => {},
    },
    "../services/format.js": format,
    "./StadiumMap.jsx": {
      __esModule: true,
      default: ({ name, coordinates }) =>
        e("div", { "data-map": name, "data-lat": coordinates.lat }),
    },
  };
  const filename = path.join(
    root,
    "dashboard/frontend/src/components/StadiumDialog.jsx",
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
  const render = (id) =>
    renderToStaticMarkup(
      e(mod.exports.default, { name: "San Siro", id, onClose: () => {} }),
    );
  const html = render("Q133566");
  assert.match(html, /75[\s\u202f\u00a0]817/);
  assert.match(html, /19 septembre 1926/);
  assert.match(html, /août 1925/);
  assert.match(html, /data-map="San Siro"/);
  assert.match(
    html,
    /peuvent être simplifiés ou absents|peut ne pas être modélisé en détail/,
  );
  stadium = { ...stadium, capacity: null, coordinates: null };
  const missing = render("Q133566");
  assert.match(missing, /Non renseignée/);
  assert.match(missing, /coordonnées ne sont pas disponibles/);
  assert.doesNotMatch(missing, /data-map=/);
  assert.match(render(null), /pas encore disponibles/);
});

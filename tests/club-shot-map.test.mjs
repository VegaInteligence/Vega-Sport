// The club's shot maps keep a shot's unknown xG unknown (VI-22, the map fallback VI-23 left to its
// consumer). Written before the change to shotProfile in club-scout.js. Expected:
// - a shot without xG is still a point of the map, with xG null (the map draws it small and says
//   « xG indisponible »; its header total is then unknown);
// - a shot whose xG is a known 0 keeps 0, not 0.01;
// - a known xG is kept as it is.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url)),
  requireLocal = createRequire(path.join(root, "dashboard/package.json")),
  React = requireLocal("react"),
  babel = requireLocal("next/dist/compiled/babel/core"),
  preset = requireLocal("next/dist/compiled/babel/preset-react"),
  commonjs = requireLocal("next/dist/compiled/babel/plugin-transform-modules-commonjs");

/** club-scout.js with its real code; React, the football context and the reads stubbed. */
function loadClubScout() {
  const stubs = {
    react: React,
    "../hooks/FootballContext.jsx": { useFootball: () => null },
    "../data-url.js": { apiUrl: (p) => p },
    "./public-api-fetch.js": { publicApiFetch: async () => assert.fail("no read") },
    "./compact-reads.js": { compactGeneration: () => "", compactScope: (ids) => ids.join(","), supportsCompactRead: () => false, readCompact: async () => assert.fail("no read"), readCompactPages: async () => assert.fail("no read") },
  };
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = babel.transformSync(fs.readFileSync(file, "utf8"), { presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename: file }).code;
    vm.runInThisContext("(function(require,module,exports,process){" + code + "\n})", { filename: file })(
      (name) => {
        if (name in stubs && (file.endsWith("club-scout.js") || name === "react")) return stubs[name];
        if (!name.startsWith(".")) return requireLocal(name);
        return load(path.resolve(path.dirname(file), name));
      },
      mod, mod.exports, process,
    );
    return mod.exports;
  };
  return load(path.join(root, "dashboard/frontend/src/services/club-scout.js"));
}

test("a shot without xG stays on the map with an unknown xG, a known zero stays zero", () => {
  const { shotProfile } = loadClubScout();
  assert.equal(typeof shotProfile, "function");
  const shot = (id, xg) => ({ id, teamId: "t_club", x: 95, y: 34, xg, minute: 10, playerName: "P", isGoal: false, isOnTarget: false });
  // A home match of the club against t_other, as the dossier's rows give it.
  const row = {
    side: "home",
    opponent: { id: "t_other", name: "X" },
    match: { date: "2026-11-01", home: { id: "t_club" }, away: { id: "t_other" }, shots: [shot(1, null), shot(2, 0), shot(3, 0.3)] },
  };
  const profile = shotProfile([row], "t_club");
  assert.deepEqual(profile.mapFor.map((s) => [s.id, s.xg]), [[1, null], [2, 0], [3, 0.3]]);
});

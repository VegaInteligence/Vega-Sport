// The European pool of the club and player profiles on the v2 API: read from the base
// (/api/clubs/europe, then one matches read per competition), level = power-ranking Elo.
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

/** club-scout.js with its real helpers; React, the football context and the fetch helpers stubbed. */
function loadClubScout(requests) {
  process.env.NEXT_PUBLIC_API_SCHEMA = "v2";
  const stubs = {
    react: React,
    "../hooks/FootballContext.jsx": { useFootball: () => null },
    "../data-url.js": { apiUrl: (p) => p },
    "./public-api-fetch.js": {
      publicApiFetch: async (url) => {
        requests.push(url);
        const { pathname, searchParams } = new URL(url, "https://site.test");
        const data =
          pathname === "/api/clubs/europe"
            ? POOL
            : { season: "2025/2026", leagueId: searchParams.get("league"), matches: MATCHES.filter((m) => m.leagueId === searchParams.get("league")) };
        return { ok: true, json: async () => ({ data }) };
      },
    },
  };
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = babel.transformSync(fs.readFileSync(file, "utf8"), {
      presets: [[preset, { runtime: "classic" }]],
      plugins: [commonjs],
      babelrc: false,
      configFile: false,
      filename: file,
    }).code;
    vm.runInThisContext("(function(require,module,exports,process){" + code + "\n})", { filename: file })(
      (name) => {
        if (name in stubs && (file.endsWith("club-scout.js") || name === "react")) return stubs[name];
        if (!name.startsWith(".")) return requireLocal(name);
        return load(path.resolve(path.dirname(file), name));
      },
      mod,
      mod.exports,
      process,
    );
    return mod.exports;
  };
  return load(path.join(root, "dashboard/frontend/src/services/club-scout.js"));
}

const LIGUE_1 = { id: "l_3FJFUl", name: "Ligue 1", country: "FRA" };
const club = (id, level, coefficient = null) => ({
  id, name: id, imageUrl: null, country: "FRA", leagueId: LIGUE_1.id, uefaCoefficient: coefficient, level, levelRank: null,
});
const POOL = {
  season: "2025/2026",
  generation: "7",
  builtAt: "2026-05-20T03:00:00.000Z",
  level: { kind: "elo", label: "Elo du classement de puissance", scope: "clubs" },
  leagues: [LIGUE_1],
  uefa: [{ id: "l_0bfbkO", name: "Champions League", country: "UEFA" }],
  clubs: [club("t_aaaaa1", 1640, 60), club("t_aaaaa2", 1500), club("t_aaaaa3", 1380)],
  // Every club ranked in the season: the pool's and a club outside it.
  levels: { t_aaaaa1: 1640, t_aaaaa2: 1500, t_aaaaa3: 1380, t_outsid: 1520 },
};
const match = (id, leagueId, home, away, hs, as, day) => ({
  id, leagueId, date: day, timeUtc: "19:00", status: "finished",
  home: { id: home, name: home, imageUrl: null, score: hs },
  away: { id: away, name: away, imageUrl: null, score: as },
  coverage: { teamStatsReliable: true },
  stats: [{ key: "expected_goals", home: 1.4, away: 0.8 }, { key: "total_shots", home: 14, away: 9 }],
});
const MATCHES = [
  match("m_aaaaa1", LIGUE_1.id, "t_aaaaa1", "t_aaaaa2", 2, 0, "2025-08-16"),
  match("m_aaaaa2", LIGUE_1.id, "t_aaaaa2", "t_aaaaa3", 1, 1, "2025-08-23"),
  match("m_aaaaa3", LIGUE_1.id, "t_aaaaa3", "t_aaaaa1", 0, 3, "2025-08-30"),
  match("m_aaaaa4", "l_0bfbkO", "t_aaaaa1", "t_outsid", 1, 0, "2025-09-17"),
];

test("the pool is read from the v2 base, one read per competition", async () => {
  const requests = [];
  const scout = loadClubScout(requests);
  const data = await scout.readEuropePool({ season: "2025/2026", generation: "7" });
  assert.deepEqual(requests, [
    "/api/clubs/europe?season=2025%2F2026&generation=7",
    "/api/clubs/europe/matches?season=2025%2F2026&generation=7&league=l_3FJFUl",
    "/api/clubs/europe/matches?season=2025%2F2026&generation=7&league=l_0bfbkO",
  ]);
  assert.equal(data.matches.length, 4);
  assert.ok(!requests.some((url) => url.includes("/demo/")));
});

test("a club's level is its Elo, for pool clubs and the others", async () => {
  const scout = loadClubScout([]);
  const pool = scout.buildEuropePool({ ...POOL, matches: MATCHES });
  assert.equal(pool.demo, false);
  assert.deepEqual(
    ["t_aaaaa1", "t_aaaaa2", "t_aaaaa3"].map((id) => pool.strength.get(id).score),
    [1640, 1500, 1380],
  );
  assert.deepEqual(pool.clubs.map((c) => [c.id, c.strength]).sort(), [["t_aaaaa1", 1640], ["t_aaaaa2", 1500], ["t_aaaaa3", 1380]]);
  assert.equal(pool.strength.get("t_aaaaa1").coefficient, 60);
  // A club outside the pool has comparable-level peers through its own Elo.
  const peers = scout.levelPeerClubs(pool, "t_outsid");
  assert.deepEqual([...peers.ids].sort(), ["t_aaaaa1", "t_aaaaa2", "t_aaaaa3", "t_outsid"]);
  assert.equal(peers.clubs[0].id, "t_aaaaa2"); // 1500 is the closest to 1520
  // No hand-set calibration on v2: a club without Elo has no level.
  assert.equal(scout.clubStrength({ id: "t_unknwn", league: LIGUE_1, self: { values: { xg: 2, xga: 0 } } }, pool), null);
  assert.equal(scout.levelPeerClubs(pool, "t_unknwn"), null);
});

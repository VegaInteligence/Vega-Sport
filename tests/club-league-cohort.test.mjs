// A club profile ranks its club against its league: the league's matches come in one read
// (/api/read/league) where each club was read on its own, and the cohort is the same.
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

const LIGUE_1 = { id: "l_3FJFUl", name: "Ligue 1", country: "FRA" };
const CUP = "l_0bfbkO";
const CLUBS = ["t_aaaaa1", "t_aaaaa2", "t_aaaaa3"].map((id) => ({ id, name: id, imageUrl: null, country: "FRA" }));
const match = (id, leagueId, home, away, hs, as, day, xg) => ({
  id, leagueId, date: day, timeUtc: "19:00", status: "finished",
  home: { id: home, name: home, imageUrl: null, score: hs },
  away: { id: away, name: away, imageUrl: null, score: as },
  coverage: { teamStatsReliable: true },
  stats: [{ key: "expected_goals", home: xg[0], away: xg[1] }, { key: "total_shots", home: 14, away: 9 }],
});
const MATCHES = [
  match("m_aaaaa1", LIGUE_1.id, "t_aaaaa1", "t_aaaaa2", 2, 0, "2025-08-16", [1.9, 0.4]),
  match("m_aaaaa2", LIGUE_1.id, "t_aaaaa2", "t_aaaaa3", 1, 1, "2025-08-23", [1.1, 0.9]),
  match("m_aaaaa3", LIGUE_1.id, "t_aaaaa3", "t_aaaaa1", 0, 3, "2025-08-30", [0.3, 2.6]),
  // A club's own read also carries its other competitions: they are not the league's.
  match("m_aaaaa4", CUP, "t_aaaaa1", "t_outsid", 1, 0, "2025-09-17", [1.2, 0.2]),
  { ...match("m_aaaaa5", LIGUE_1.id, "t_aaaaa1", "t_aaaaa3", null, null, "2026-02-01", [null, null]), status: "not_started" },
];
const page = (matches) => ({ pages: [{ matches, fixtures: [], appearances: [], teams: [], competitions: [] }] });

/** club-scout.js with its real code; React, the football context and the reads stubbed. */
function loadClubScout(reads) {
  const stubs = {
    react: React,
    "../hooks/FootballContext.jsx": { useFootball: () => null },
    "../data-url.js": { apiUrl: (p) => p },
    "./public-api-fetch.js": { publicApiFetch: async () => assert.fail("no other read") },
    "./compact-reads.js": {
      compactGeneration: (manifest) => manifest?.publicationVersion || "",
      compactScope: (ids) => ids.join(","),
      supportsCompactRead: (manifest, kind) => manifest?.capabilities?.compactReads?.[kind] === true,
      readCompact: async () => assert.fail("no single read"),
      readCompactPages: async (kind, params) => {
        reads.push([kind, params.team || params.league || params.leagues, params.detail || ""]);
        // The league's clubs are read by name and crest alone: no analysis.
        if (kind === "clubs") return assert.equal(params.analysis, undefined), { pages: [{ clubs: CLUBS }] };
        if (kind === "league")
          return page(MATCHES.filter((m) => m.leagueId === params.league && (!params.played || m.status === "finished")));
        if (kind === "club") return page(MATCHES.filter((m) => m.home.id === params.team || m.away.id === params.team));
        return assert.fail("unexpected read " + kind);
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

test("one read of the league's matches gives the cohort read club by club", async () => {
  const reads = [];
  const scout = loadClubScout(reads);
  const publication = { season: "2025/2026", generation: "7" };
  const byClub = await scout.leagueCohort(LIGUE_1, publication).promise;
  assert.deepEqual(reads, [
    ["clubs", LIGUE_1.id, ""],
    ["club", "t_aaaaa1", "summary"],
    ["club", "t_aaaaa2", "summary"],
    ["club", "t_aaaaa3", "summary"],
  ]);
  reads.length = 0;
  // Another publication: the cohort of a league is kept per publication.
  const whole = await scout.leagueCohort(LIGUE_1, { ...publication, generation: "8", whole: true }).promise;
  assert.deepEqual(reads, [
    ["clubs", LIGUE_1.id, ""],
    ["league", LIGUE_1.id, "summary"],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(whole)), JSON.parse(JSON.stringify(byClub)));
  assert.deepEqual(
    whole.clubs.map((c) => [c.id, c.position, c.record.matches, c.record.points]),
    [["t_aaaaa1", 1, 2, 6], ["t_aaaaa2", 2, 2, 1], ["t_aaaaa3", 3, 2, 1]],
  );
  // The cup match and the match to come count for no club of the league.
  assert.ok(whole.clubs.every((c) => c.rows.every((row) => row.match.leagueId === LIGUE_1.id && row.match.status === "finished")));
});

test("the same publication is read once, whoever asks", async () => {
  const reads = [];
  const scout = loadClubScout(reads);
  const publication = { season: "2025/2026", generation: "9", whole: true };
  const [a, b] = await Promise.all([scout.leagueCohort(LIGUE_1, publication).promise, scout.leagueCohort(LIGUE_1, publication).promise]);
  assert.equal(a, b);
  assert.equal(reads.length, 2);
});

test("the finished matches alone give the same cohort", async () => {
  const reads = [];
  const scout = loadClubScout(reads);
  const all = await scout.leagueCohort(LIGUE_1, { season: "2025/2026", generation: "10", whole: true }).promise;
  const played = await scout.leagueCohort(LIGUE_1, { season: "2025/2026", generation: "11", whole: true, played: true }).promise;
  assert.deepEqual(JSON.parse(JSON.stringify(played)), JSON.parse(JSON.stringify(all)));
});

test("a club's league is its domestic competition with most matches played", () => {
  const scout = loadClubScout([]);
  const competitions = [
    { id: LIGUE_1.id, name: "Ligue 1", country: "FRA", imageUrl: "https://img.example/l1.png" },
    { id: CUP, name: "Champions League", country: "UEFA", imageUrl: null },
  ];
  const data = { matches: MATCHES, fixtures: [], appearances: [], teams: [], competitions };
  const { league, competitions: played } = scout.clubLeagues(data, "t_aaaaa1");
  assert.deepEqual([league.id, league.country, league.imageUrl], [LIGUE_1.id, "FRA", "https://img.example/l1.png"]);
  assert.deepEqual(played.map((c) => c.id), [LIGUE_1.id, CUP]);
  // Without a domestic competition, its first one; without a match, none.
  const european = { ...data, matches: MATCHES.filter((m) => m.leagueId === CUP) };
  assert.equal(scout.clubLeagues(european, "t_aaaaa1").league.id, CUP);
  assert.equal(scout.clubLeagues(data, "t_nobody").league, undefined);
});

// The match page while live (doc "Live"): the feed's goals and cards and its team
// statistics until PitchAPI has them, then nothing more from the feed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireLocal = createRequire(path.join(root, "dashboard/package.json"));
const babel = requireLocal("next/dist/compiled/babel/core"),
  preset = requireLocal("next/dist/compiled/babel/preset-react");

test("the match page compiles with its live timeline and statistics", async () => {
  const source = await fs.readFile(path.join(root, "dashboard/frontend/src/components/MatchDetail.jsx"), "utf8");
  const out = babel.transformSync(source, { filename: "MatchDetail.jsx", babelrc: false, configFile: false, presets: [[preset, { runtime: "automatic" }]] });
  assert.match(out.code, /scoreboard-live-events/);
});

test("the feed's goals and cards and its statistics, until core has them", async () => {
  // The two pure helpers, read out of the component file (it imports the whole site).
  const source = await fs.readFile(path.join(root, "dashboard/frontend/src/components/MatchDetail.jsx"), "utf8");
  const block = source.slice(source.indexOf("const LIVE_EVENTS = {"), source.indexOf("function LiveTimeline("));
  const number = (v) => String(v);
  const { liveTimeline, liveTeamStats } = new Function("number", block.replace(/export function/g, "function") + "return { liveTimeline, liveTeamStats };")(number);
  const match = { home: { id: "t_home01" }, away: { id: "t_away01" } };
  const live = {
    families: { score: "live", events: "live", stats: "live" },
    events: [
      { seq: 1, type: "goal", teamId: "t_home01", cancelled: false },
      { seq: 2, type: "substitution", teamId: "t_home01" },
      { seq: 3, type: "goal", teamId: "t_away01", cancelled: true },
      { seq: 4, type: "red_card", teamId: "t_away01" },
    ],
    stats: [
      { teamId: "t_home01", possessionPct: 58, totalShots: 9, shotsOnTarget: 4 },
      { teamId: "t_away01", possessionPct: 42, totalShots: 5, shotsOnTarget: 1 },
    ],
  };
  assert.deepEqual(liveTimeline(live).map((e) => e.seq), [1, 3, 4]); // no substitutions
  assert.deepEqual(liveTeamStats(live, match).map((s) => [s.label, s.home, s.away]), [
    ["Possession", "58 %", "42 %"], ["Tirs", "9", "5"], ["Tirs cadrés", "4", "1"],
  ]);
  assert.equal(liveTeamStats({ ...live, stats: live.stats.slice(0, 1) }, match), null); // both teams or nothing
  const core = { ...live, families: { score: "core", events: "core", stats: "core" } };
  assert.deepEqual([liveTimeline(core), liveTeamStats(core, match)], [[], null]);
});

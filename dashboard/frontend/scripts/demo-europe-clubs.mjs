/**
 * LOCAL DEMO ONLY — stands in for the server-side European club aggregate.
 *
 * Reads every club of the seven Top 7 Europe leagues (one summary read per
 * club) and keeps their finished league and UEFA matches with the team
 * statistics the club profile ranks, plus each club's UEFA coefficient.
 * Output: public/demo/europe-clubs.json.
 *
 *   node scripts/demo-europe-clubs.mjs [season]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EUROPE_FOCUS } from "../../shared/competition-scope.js";

const API = "https://d317dq37z1tacb.cloudfront.net";
const season = process.argv[2] || "2026/2027";
const LEAGUES = EUROPE_FOCUS.filter((c) => c.country !== "UEFA");
const UEFA = EUROPE_FOCUS.filter((c) => c.country === "UEFA");
const KEEP = new Set([
  "expected_goals",
  "expected_goals_non_penalty",
  "expected_goals_open_play",
  "expected_goals_set_play",
  "expected_goals_on_target",
  "total_shots",
  "ShotsOnTarget",
  "shots_inside_box",
  "shots_outside_box",
  "big_chance",
  "big_chance_missed_title",
  "BallPossesion",
  "passes",
  "accurate_passes",
  "opposition_half_passes",
  "own_half_passes",
  "long_balls_accurate",
  "accurate_crosses",
  "touches_opp_box",
  "dribbles_succeeded",
  "duel_won",
  "ground_duels_won",
  "aerials_won",
  "matchstats.headers.tackles",
  "interceptions",
  "clearances",
  "shot_blocks",
  "fouls",
  "yellow_cards",
  "red_cards",
  "corners",
  "Offsides",
  "keeper_saves",
]);

const query = (o) =>
  new URLSearchParams(
    Object.entries(o).sort(([a], [b]) => a.localeCompare(b)),
  ).toString();
async function read(kind, params) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API}/api/read/${kind}?${query(params)}`);
    if (response.ok) return response.json();
    if (attempt > 3) throw new Error(`${kind} HTTP ${response.status}`);
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
}
async function pool(items, size, task) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await task(items[next++]);
    }),
  );
}

const side = (s) => ({
  id: s.id,
  name: s.name,
  imageUrl: s.imageUrl,
  score: s.score,
});
const scope = new Set([...LEAGUES, ...UEFA].map((c) => c.id));
const matches = new Map();
const clubs = [];
let generation = null;

for (const league of LEAGUES) {
  const list = await read("clubs", {
    season,
    leagues: league.id,
    analysis: 1,
    limit: 100,
  });
  generation ||= list.pagination?.generation;
  const members = list.data.clubs;
  process.stdout.write(`${league.name}: ${members.length} clubs `);
  await pool(members, 6, async (club) => {
    let page = 1,
      pages = 1;
    do {
      const r = await read("club", {
        season,
        team: club.id,
        leagues: "all",
        detail: "summary",
        limit: 100,
        page,
      });
      pages = r.pagination.pages;
      for (const m of r.data.matches || [])
        if (m.status === "finished" && scope.has(m.leagueId))
          matches.set(m.id, {
            id: m.id,
            leagueId: m.leagueId,
            date: m.date,
            timeUtc: m.timeUtc,
            status: m.status,
            home: side(m.home),
            away: side(m.away),
            coverage: { teamStatsReliable: m.coverage?.teamStatsReliable },
            stats: (m.stats || [])
              .filter((s) => KEEP.has(s.key))
              .map((s) => ({ key: s.key, home: s.home, away: s.away })),
          });
      page++;
    } while (page <= pages);
    clubs.push({
      id: club.id,
      name: club.name,
      imageUrl: club.imageUrl,
      country: club.country,
      leagueId: league.id,
    });
    process.stdout.write(".");
  });
  process.stdout.write("\n");
}

// Five-year UEFA club coefficient (current edition), null when unranked.
process.stdout.write("UEFA coefficients ");
await pool(clubs, 6, async (club) => {
  const response = await fetch(`${API}/api/rankings/club?club=${club.id}`);
  const r = response.ok ? await response.json() : {};
  club.uefaCoefficient = r.rows?.[0]?.row?.points ?? null;
  process.stdout.write(".");
});
process.stdout.write("\n");

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "../public/demo/europe-clubs.json",
);
await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  JSON.stringify({
    demo: true,
    season,
    generation,
    builtAt: new Date().toISOString(),
    leagues: LEAGUES,
    uefa: UEFA,
    clubs,
    matches: [...matches.values()],
  }),
);
console.log(`${clubs.length} clubs, ${matches.size} matches → ${out}`);

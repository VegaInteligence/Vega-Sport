/** Ingestion-only supplemental refresh. Never imported by the application. */
import { query, database, canonical } from "./lib/aws-staging.js";
import { dataJson } from "./lib/aws-data-store.js";
import { SPORTSCORE_LEAGUES } from "../frontend/src/services/sportscore-standings.js";
import { NATIONAL_CUP_ARCHIVES } from "../frontend/src/services/cup-archives.js";
import { normalizeText } from "../frontend/src/services/format.js";
const mode = process.argv.includes("--all-clubs") ? "all" : "daily";
let success = 0,
  failed = 0;
async function refresh(name, params) {
  try {
    const { GET } = await import("./source-projections/" + name + ".mjs");
    const response = await GET(
      new Request(
        "http://ingestion/api/" + name + "?" + new URLSearchParams(params),
      ),
    );
    if (!response.ok) {
      failed++;
      return null;
    }
    const body = await response.json();
    // A transient Commons failure must not erase a previously known portrait.
    if (name === "club-wikidata" && body.coach && !body.coach.photo) {
      const [previous] = await query(
        "SELECT body FROM statarena.projections WHERE name=$1 AND params=$2",
        [name, canonical(params)],
      );
      const coach = previous?.body?.coach;
      if (
        coach?.photo &&
        normalizeText(coach.name) === normalizeText(body.coach.name)
      )
        body.coach.photo = coach.photo;
    }
    await query(
      "INSERT INTO statarena.projections(name,params,body) VALUES($1,$2,$3) ON CONFLICT(name,params) DO UPDATE SET body=excluded.body,updated_at=now()",
      [name, canonical(params), body],
    );
    success++;
    return body;
  } catch (e) {
    failed++;
    console.error("Supplemental refresh failed", name, e.name);
    return null;
  }
}
const jobs = [];
for (const id of Object.keys(SPORTSCORE_LEAGUES))
  jobs.push(["standings", { competition: id }]);
for (const season of ["2020", "2024", "2028"])
  jobs.push(["open-cups", { competition: "euro", season }]);
for (const season of [
  "1930",
  "1934",
  "1938",
  "1950",
  "1954",
  "1958",
  "1962",
  "1966",
  "1970",
  "1974",
  "1978",
  "1982",
  "1986",
  "1990",
  "1994",
  "1998",
  "2002",
  "2006",
  "2010",
  "2014",
  "2018",
  "2022",
  "2026",
])
  jobs.push(["open-cups", { competition: "world-cup-history", season }]);
jobs.push(
  ["open-cups", { competition: "club-world-cup", season: "2025" }],
  ["open-cups", { competition: "france-cup", season: "2024/2025" }],
  ["nations-results", { season: "2026/2027" }],
);
for (const item of Object.values(NATIONAL_CUP_ARCHIVES))
  jobs.push(["open-cups", { competition: item.key, season: item.season }]);
for (const [competition, seasons] of Object.entries({
  "nations-league": ["2026/2027"],
  "germany-cup": ["2025/2026", "2026/2027"],
}))
  for (const season of seasons)
    jobs.push(["openligadb", { competition, season }]);
let at = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (at < jobs.length) {
      const [name, params] = jobs[at++];
      await refresh(name, params);
    }
  }),
);
const manifest = await dataJson("computed/dashboard/index.json");
const links = await dataJson("raw/rankings/club-links.json").catch(() => ({
  links: {},
}));
const teams = new Map();
for (const season of manifest.seasons.slice(0, 1))
  for (const chunk of season.chunks) {
    const doc = await dataJson(chunk.path),
      table = doc.tables.teams;
    const keys = table.keys,
      dict = table.dictionaries || {};
    for (const row of table.rows) {
      const team = Object.fromEntries(
        keys.map((k, j) => [
          k,
          dict[j] && row[j] != null ? dict[j][row[j]] : row[j],
        ]),
      );
      const uefa = links.links?.[team.id]?.entityId?.match(/^uefa:(\d+)$/)?.[1];
      const country = manifest.clubCountries?.[team.id];
      if (uefa || country)
        teams.set(team.id, uefa ? { uefa } : { name: team.name, country });
    }
  }
let candidates = [...teams.values()];
const cursor =
  (
    await query(
      "SELECT value FROM statarena.state WHERE name='supplemental_cursor'",
    )
  )[0]?.value || 0;
const limit = mode === "all" ? candidates.length : 40;
for (let n = 0; n < Math.min(limit, candidates.length); n++) {
  const params = candidates[(cursor + n) % candidates.length];
  const club = await refresh("club-wikidata", params);
  if (club?.stadiumId) await refresh("stadium", { id: club.stadiumId });
  if (n % 20 === 0)
    console.log(
      JSON.stringify({
        clubProgress: n,
        clubs: candidates.length,
        success,
        failed,
      }),
    );
}
await query(
  "INSERT INTO statarena.state(name,value) VALUES('supplemental_cursor',$1) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=now()",
  [JSON.stringify((cursor + limit) % Math.max(1, candidates.length))],
);
console.log(
  JSON.stringify({
    sourceRefresh: { success, failed, clubs: candidates.length },
  }),
);
await database().end();

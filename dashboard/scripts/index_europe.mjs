import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const historical = process.argv.includes("--history");
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
  "data",
  "sources",
  "pitchapi",
  "archives",
  historical ? "europe_2021_2026" : "europe_2026_2027",
);
const matchFilename = (id) =>
  historical
    ? `${id}--${Buffer.from(id, "utf8").toString("hex")}.json`
    : `${id}.json`;
const inventory = JSON.parse(
  await fs.readFile(path.join(root, "inventory.json"), "utf8"),
);
const rows = [],
  competitionSummaries = [],
  endpointCounts = {},
  otherEndpointCounts = {};
let missingShots = 0,
  suspectZeroShots = 0,
  playerRows = 0,
  matchesWithPlayers = 0,
  shots = 0,
  knownShotXg = 0,
  knownShotXgot = 0,
  incomplete = 0;
let otherDownloaded = 0,
  otherIncomplete = 0,
  otherLineups = 0,
  otherPredicted = 0,
  otherConfirmed = 0;
const observedNumber = (value) =>
  typeof value === "number"
    ? Number.isFinite(value)
    : typeof value === "string" &&
      value.trim() !== "" &&
      Number.isFinite(Number(value));
function countStatuses(counts, endpoints) {
  for (const [name, value] of Object.entries(endpoints)) {
    const status = String(value.status ?? "failed");
    counts[name] ??= {};
    counts[name][status] = (counts[name][status] || 0) + 1;
  }
}
for (const c of inventory.competitions) {
  let matchFiles = new Set(),
    fixtureFiles = new Set();
  try {
    matchFiles = new Set(await fs.readdir(path.join(root, "matches", c.id)));
  } catch {}
  try {
    fixtureFiles = new Set(await fs.readdir(path.join(root, "fixtures", c.id)));
  } catch {}
  const country =
    c.name === "1. Lig" && c.country_code === "INT" ? "TUR" : c.country_code;
  const summary = {
    id: c.id,
    name: c.name,
    country_code: country,
    provider_country_code: c.country_code,
    season: c.season,
    fixtures: c.matches.length,
    finished: 0,
    downloaded: 0,
    incomplete: 0,
    other_downloaded: 0,
    other_incomplete: 0,
    other_lineups: 0,
    other_predicted: 0,
    other_confirmed: 0,
    missing_shots: 0,
    suspect_zero_shots: 0,
    matches_with_players: 0,
    shots: 0,
    known_shot_xg: 0,
    known_shot_xgot: 0,
    endpoint_statuses: {},
    other_endpoint_statuses: {},
  };
  for (const fixture of c.matches) {
    if (fixture.status !== "finished") {
      const name = matchFilename(fixture.id);
      if (!fixtureFiles.has(name)) continue;
      let record;
      try {
        record = JSON.parse(
          await fs.readFile(path.join(root, "fixtures", c.id, name), "utf8"),
        );
      } catch {
        continue;
      }
      otherDownloaded++;
      summary.other_downloaded++;
      if (!record.complete) {
        otherIncomplete++;
        summary.other_incomplete++;
      }
      countStatuses(otherEndpointCounts, record.endpoints || {});
      countStatuses(summary.other_endpoint_statuses, record.endpoints || {});
      const sides = ["home", "away"]
        .map((side) => record.endpoints?.lineups?.data?.[side])
        .filter(
          (side) => Array.isArray(side?.starters) && side.starters.length,
        );
      if (sides.length) {
        otherLineups++;
        summary.other_lineups++;
      }
      if (sides.some((side) => side.confirmed === false)) {
        otherPredicted++;
        summary.other_predicted++;
      }
      if (sides.some((side) => side.confirmed === true)) {
        otherConfirmed++;
        summary.other_confirmed++;
      }
      continue;
    }
    summary.finished++;
    const name = matchFilename(fixture.id);
    if (!matchFiles.has(name)) continue;
    let record;
    try {
      record = JSON.parse(
        await fs.readFile(path.join(root, "matches", c.id, name), "utf8"),
      );
    } catch {
      continue;
    }
    summary.downloaded++;
    if (!record.complete) {
      incomplete++;
      summary.incomplete++;
    }
    const endpoints = record.endpoints || {};
    countStatuses(endpointCounts, endpoints);
    countStatuses(summary.endpoint_statuses, endpoints);
    const periods = endpoints.shots?.data?.periods;
    const shotRows = Array.isArray(periods)
      ? periods.flatMap((p) => (Array.isArray(p?.shots) ? p.shots : []))
      : [];
    const missing = !Array.isArray(periods);
    const totalGoals =
      Number(fixture.score_home || 0) + Number(fixture.score_away || 0);
    const statPeriods = endpoints.stats?.data?.periods;
    const allStats = Array.isArray(statPeriods)
      ? statPeriods.find((p) => p?.period === "All")
      : null;
    const groups = Array.isArray(allStats?.groups) ? allStats.groups : [];
    const teamShots = groups
      .flatMap((g) => (Array.isArray(g?.items) ? g.items : []))
      .find((s) => s?.key === "total_shots");
    const reportedShots = [teamShots?.home, teamShots?.away].some(
      (value) => Number.parseFloat(value) > 0,
    );
    const suspect =
      missing || (shotRows.length === 0 && (totalGoals > 0 || reportedShots));
    const players = Array.isArray(endpoints.players?.data)
      ? endpoints.players.data.length
      : 0;
    if (players) {
      matchesWithPlayers++;
      summary.matches_with_players++;
    }
    if (missing) {
      missingShots++;
      summary.missing_shots++;
    }
    if (suspect) {
      suspectZeroShots++;
      summary.suspect_zero_shots++;
    }
    const xg = shotRows.filter((s) => observedNumber(s?.expected_goals)).length;
    const xgot = shotRows.filter((s) =>
      observedNumber(s?.expected_goals_on_target),
    ).length;
    knownShotXg += xg;
    knownShotXgot += xgot;
    summary.shots += shotRows.length;
    summary.known_shot_xg += xg;
    summary.known_shot_xgot += xgot;
    playerRows += players;
    shots += shotRows.length;
    rows.push({
      competition_id: c.id,
      league: c.name,
      country,
      season: c.season,
      match: fixture,
      players,
      shots: shotRows.length,
      shots_missing: missing,
      shots_suspect: suspect,
      complete: record.complete,
    });
  }
  competitionSummaries.push(summary);
}
rows.sort((a, b) =>
  (b.match.time_utc || b.match.date || "").localeCompare(
    a.match.time_utc || a.match.date || "",
  ),
);
let collection;
try {
  collection = JSON.parse(
    await fs.readFile(path.join(root, "collection.json"), "utf8"),
  );
} catch {}
const partialProfiles = { provisional: true };
for (const kind of ["leagues", "teams", "players"]) {
  try {
    partialProfiles[kind] = (
      await fs.readdir(path.join(root, "profiles", kind))
    ).filter((name) => name.endsWith(".json")).length;
  } catch {
    partialProfiles[kind] = 0;
  }
}
const summary = {
  generated_at_utc: new Date().toISOString(),
  inventory_at_utc: inventory.retrieved_at_utc,
  competitions: inventory.competitions.length,
  fixtures: inventory.competitions.reduce((n, c) => n + c.matches.length, 0),
  finished: competitionSummaries.reduce((n, c) => n + c.finished, 0),
  downloaded: rows.length,
  incomplete,
  other_fixtures_downloaded: otherDownloaded,
  other_fixtures_incomplete: otherIncomplete,
  other_fixtures_with_lineups: otherLineups,
  other_fixtures_with_predicted_lineups: otherPredicted,
  other_fixtures_with_confirmed_lineups: otherConfirmed,
  player_rows: playerRows,
  matches_with_players: matchesWithPlayers,
  shots,
  known_shot_xg: knownShotXg,
  known_shot_xgot: knownShotXgot,
  missing_shots: missingShots,
  suspect_zero_shots: suspectZeroShots,
  endpoint_statuses: endpointCounts,
  other_endpoint_statuses: otherEndpointCounts,
  profiles: collection?.profiles ?? partialProfiles,
  competition_summaries: competitionSummaries,
  matches: rows,
};
const tmp = path.join(root, `index.json.${process.pid}.tmp`);
await fs.writeFile(tmp, JSON.stringify(summary));
await fs.rename(tmp, path.join(root, "index.json"));
console.log(
  JSON.stringify(
    { ...summary, competition_summaries: undefined, matches: undefined },
    null,
    2,
  ),
);

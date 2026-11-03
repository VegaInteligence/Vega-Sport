/** Discover portraits for coaches observed in match lineups, during ingestion. */
import { pathToFileURL } from "node:url";
import { normalizeText } from "../frontend/src/services/format.js";
import { findCoachPortraitBatch } from "./coach-portrait-source.mjs";

export function recentLineupIds(fixtures, maxPerClub = 2) {
  const counts = new Map(),
    ids = new Set();
  for (const fixture of fixtures) {
    const match = fixture.body || fixture;
    if (!match?.id) continue;
    let wanted = false;
    for (const team of [
      match.home_team || match.home,
      match.away_team || match.away,
    ]) {
      if (!team?.id || (counts.get(team.id) || 0) >= maxPerClub) continue;
      counts.set(team.id, (counts.get(team.id) || 0) + 1);
      wanted = true;
    }
    if (wanted) ids.add(match.id);
  }
  return [...ids];
}

export function lineupCoaches(data) {
  return [data?.home?.coach?.name, data?.away?.coach?.name]
    .filter(
      (name) =>
        typeof name === "string" &&
        name.trim().length >= 3 &&
        name.length <= 100,
    )
    .map((name) => name.trim());
}

async function main() {
  const { query, database, canonical } =
    await import("../backend/services/neon.js");
  const { savedResource, archivedResource } =
    await import("../backend/services/database.js");
  const arg = process.argv.indexOf("--name");
  const specific = arg >= 0 ? process.argv[arg + 1] : null;
  const all = process.argv.includes("--all");
  const names = new Map();
  const add = (name) => {
    if (typeof name !== "string" || name.trim().length < 3 || name.length > 100)
      return;
    const clean = name.trim();
    if (!names.has(normalizeText(clean)))
      names.set(normalizeText(clean), clean);
  };
  if (specific) add(specific);
  else {
    const existingClubs = await query(
      "SELECT body FROM statarena.projections WHERE name='club-wikidata'",
    );
    for (const { body } of existingClubs)
      if (!body?.coach?.photo) add(body?.coach?.name);
    const fixtures = await query(
      "SELECT body FROM statarena.fixtures WHERE status='finished' ORDER BY day DESC NULLS LAST LIMIT 12000",
    );
    let ids = recentLineupIds(fixtures);
    if (!all) ids = ids.slice(0, 150);
    console.log(JSON.stringify({ lineupFixtures: ids.length }));
    let cursor = 0,
      complete = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (cursor < ids.length) {
          const id = ids[cursor++],
            endpoint = `/matches/${id}/lineups`;
          try {
            const response =
              (await savedResource(endpoint)) ||
              (await archivedResource(endpoint));
            if (response?.status === 200)
              for (const name of lineupCoaches(response.data)) add(name);
          } catch (error) {
            console.error("Lineup read failed", error.name);
          }
          complete++;
          if (complete % 150 === 0)
            console.log(
              JSON.stringify({ lineupsRead: complete, names: names.size }),
            );
        }
      }),
    );
  }
  const previous = new Map(
    (
      await query(
        "SELECT params,body,updated_at FROM statarena.projections WHERE name='coach-portrait'",
      )
    ).map((row) => [JSON.parse(row.params).name, row]),
  );
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let candidates = [...names.values()].filter((name) => {
    const row = previous.get(name);
    return (
      specific ||
      !row ||
      (!row.body?.photo &&
        (row.body?.lookupVersion !== 3 || Date.parse(row.updated_at) < cutoff))
    );
  });
  if (!all && !specific) candidates = candidates.slice(0, 75);
  let updated = 0,
    unavailable = 0,
    failed = 0;
  let consecutiveFailures = 0;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let start = 0; start < candidates.length; start += 20) {
    const batch = candidates.slice(start, start + 20);
    try {
      let portraits;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          portraits = await findCoachPortraitBatch(batch);
          break;
        } catch (error) {
          if (attempt === 3) throw error;
          await wait(2000 * 2 ** attempt);
        }
      }
      consecutiveFailures = 0;
      for (const name of batch) {
        const photo = portraits.get(name);
        await query(
          "INSERT INTO statarena.projections(name,params,body) VALUES('coach-portrait',$1,$2::jsonb) ON CONFLICT(name,params) DO UPDATE SET body=excluded.body,updated_at=now()",
          [
            canonical({ name }),
            JSON.stringify({ name, photo, lookupVersion: 3 }),
          ],
        );
        if (photo) updated++;
        else unavailable++;
      }
    } catch (error) {
      failed += batch.length;
      consecutiveFailures++;
      console.error("Portrait batch failed", error.message);
      if (consecutiveFailures >= 3) break;
    }
    console.log(
      JSON.stringify({
        checked: updated + unavailable + failed,
        updated,
        unavailable,
        failed,
        total: candidates.length,
      }),
    );
    await wait(300);
  }
  console.log(
    JSON.stringify({
      observedCoachPortraits: {
        candidates: candidates.length,
        updated,
        unavailable,
        failed,
      },
    }),
  );
  await database().end();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();

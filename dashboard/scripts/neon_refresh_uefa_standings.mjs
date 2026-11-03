/** Refresh official historical UEFA tables into the existing Neon projections. */
import {
  UEFA_STANDINGS_COMPETITIONS,
  normalizeUefaStandings,
  uefaSeasonYear,
} from "../frontend/src/services/uefa-standings.js";

const headers = {
  "User-Agent": "STATARENA/1.0 (https://github.com/OrionQuantPlatform/STATARENA)",
  Origin: "https://www.uefa.com",
  Referer: "https://www.uefa.com/",
};

async function collect(competition, season, clubIds = {}) {
  const url = new URL("https://standings.uefa.com/v1/standings");
  url.searchParams.set("competitionId", UEFA_STANDINGS_COMPETITIONS[competition].id);
  url.searchParams.set("seasonYear", String(uefaSeasonYear(season)));
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (response.ok || ![403, 429, 500, 502, 503, 504].includes(response.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  if (!response.ok) throw new Error(`UEFA HTTP ${response.status}`);
  const result = normalizeUefaStandings(await response.json(), competition, season, clubIds);
  if (!result) throw new Error("UEFA returned an incomplete or mismatched table");
  return { ...result, fetchedAt: new Date().toISOString() };
}

if (process.argv.includes("--check-source")) {
  for (const season of ["2023/2024", "2025/2026"]) {
    const result = await collect("l_0bfbkO", season);
    console.log(JSON.stringify({ season, groups: result.tables.length, teams: result.tables.reduce((n, group) => n + group.rows.length, 0), first: result.tables[0].rows[0].name }));
  }
} else {
  const { query, database, canonical } = await import("../backend/services/neon.js");
  const { dataJson } = await import("../backend/services/data-store.js");
  const links = await dataJson("raw/rankings/club-links.json").catch(() => ({ links: {} }));
  const clubIds = {};
  for (const [pitchId, link] of Object.entries(links.links || {})) {
    const uefaId = /^uefa:(\d+)$/.exec(link?.entityId || "")?.[1];
    if (uefaId) clubIds[uefaId] = uefaId in clubIds ? null : pitchId;
  }
  const now = new Date();
  const currentStart = now.getUTCFullYear() - (now.getUTCMonth() < 6 ? 1 : 0);
  let success = 0, failed = 0;
  try {
    for (const competition of Object.keys(UEFA_STANDINGS_COMPETITIONS)) {
      for (let start = 2021; start < currentStart; start++) {
        const season = `${start}/${start + 1}`;
        try {
          const body = await collect(competition, season, clubIds);
          await query(
            "INSERT INTO statarena.projections(name,params,body) VALUES('standings',$1,$2) ON CONFLICT(name,params) DO UPDATE SET body=excluded.body,updated_at=now()",
            [canonical({ competition, season }), body],
          );
          success++;
          console.log(JSON.stringify({ competition, season, groups: body.tables.length, teams: body.tables.reduce((n, table) => n + table.rows.length, 0) }));
        } catch (error) {
          failed++;
          console.error(JSON.stringify({ competition, season, error: error.message }));
        }
      }
    }
  } finally {
    await database().end();
  }
  console.log(JSON.stringify({ uefaStandings: { success, failed } }));
  if (failed) process.exitCode = 1;
}

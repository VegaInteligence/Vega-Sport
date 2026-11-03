/**
 * Refresh the promotion and relegation places of each league.
 *
 * The site computes its zones itself from shared/league-rules.json: for each
 * league, how many clubs go up or down directly and through a play-off. This
 * script reads the zones of the current standings once per league and keeps
 * only the counts, so the site depends on no source at display time.
 * A play-off zone wider than three rows describes a split league (Scotland's
 * bottom six), not a play-off, and is left out.
 *
 *   node scripts/refresh_league_rules.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SPORTSCORE_LEAGUES } from "../frontend/src/services/sportscore-standings.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "shared/league-rules.json");
const zone = (name) => {
  const value = String(name || "").toLowerCase();
  const playoff = /play-?offs?/.test(value);
  if (/relegation/.test(value))
    return playoff ? "relegationPlayoff" : "relegation";
  if (/upgrade|promotion/.test(value))
    return playoff ? "promotionPlayoff" : "promotion";
  return null;
};

let previous = {};
try {
  previous = JSON.parse(await fs.readFile(output, "utf8")).leagues || {};
} catch {}
const leagues = {};
const skipped = [];
for (const [id, slug] of Object.entries(SPORTSCORE_LEAGUES)) {
  try {
    const url = new URL("https://sportscore.com/api/widget/standings/");
    url.searchParams.set("sport", "football");
    url.searchParams.set("slug", slug);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const tables = (await response.json()).tables || [];
    if (tables.length !== 1) throw new Error(`${tables.length} tables`);
    const rows = tables[0].rows || [];
    const counts = {
      teams: rows.length,
      promotion: 0,
      promotionPlayoff: 0,
      relegationPlayoff: 0,
      relegation: 0,
    };
    for (const row of rows) {
      const key = zone(row.promo_name);
      if (key) counts[key]++;
    }
    if (counts.relegationPlayoff > 3) counts.relegationPlayoff = 0;
    if (counts.promotionPlayoff > 8) counts.promotionPlayoff = 0;
    leagues[id] = counts;
  } catch (error) {
    skipped.push(`${id} (${slug}): ${error.message}`);
    if (previous[id]) leagues[id] = previous[id];
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
await fs.writeFile(
  output,
  JSON.stringify({ retrievedAt: new Date().toISOString(), leagues }, null, 2) +
    "\n",
);
console.log(
  `${Object.keys(leagues).length} leagues written to ${path.relative(root, output)}`,
);
if (skipped.length) console.warn("Skipped:\n  " + skipped.join("\n  "));

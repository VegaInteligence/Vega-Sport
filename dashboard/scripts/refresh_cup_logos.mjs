/**
 * Refresh the cup logos shown in the competition directory.
 *
 * PitchAPI has no national cups; SportScore, already the standings source,
 * exposes each competition logo next to its table. The mapping below is
 * explicit (no name matching) and the result is written to
 * shared/cup-logos.json.
 *
 *   node scripts/refresh_cup_logos.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "shared/cup-logos.json");
const SLUGS = {
  l_1XLtP0: "fifa-world-cup",
  "open-cup:world-cup-history": "fifa-world-cup",
  "open-cup:club-world-cup": "fifa-club-world-cup",
  "open-cup:euro": "uefa-european-championship",
  "openligadb:nations-league": "uefa-nations-league",
  "open-cup:france-cup": "coupe-de-france",
  "open-matchday:AUT_CUP_ofb-cup": "austrian-cup",
  "open-matchday:ENG_CUP_efl-cup": "english-football-league-cup",
  "open-matchday:ENG_CUP_fa-cup": "fa-cup",
  "open-matchday:ESP_CUP_copa-del-rey": "copa-del-rey",
  "open-matchday:GER_CUP_dfb-pokal": "dfb-pokal",
  "open-matchday:ITA_CUP_coppa-italia": "coppa-italia",
  "open-matchday:NED_CUP_knvb-beker": "netherlands-knvb-cup",
  "open-matchday:POR_CUP_taca-de-portugal": "portuguese-cup",
  "open-matchday:SCO_CUP_league-cup": "scottish-league-cup",
  "open-matchday:SCO_CUP_scottish-cup": "scottish-cup",
  "open-matchday:SUI_CUP_swiss-cup": "switzerland-cup",
};
const LOGO =
  /^https:\/\/img\.thesports\.com\/football\/competition\/[a-z0-9]+\.(?:png|webp|jpe?g)$/i;

let previous = {};
try {
  previous = JSON.parse(await fs.readFile(output, "utf8")).logos || {};
} catch {}
const logos = {};
const failures = [];
for (const [id, slug] of Object.entries(SLUGS)) {
  try {
    const url = new URL("https://sportscore.com/api/widget/standings/");
    url.searchParams.set("sport", "football");
    url.searchParams.set("slug", slug);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (!LOGO.test(body.competition_logo || "")) throw new Error("no logo");
    const image = await fetch(body.competition_logo, {
      method: "HEAD",
      signal: AbortSignal.timeout(15000),
    });
    if (!image.ok) throw new Error(`logo HTTP ${image.status}`);
    logos[id] = {
      imageUrl: body.competition_logo,
      source: "SportScore",
      slug,
      name: body.competition,
    };
  } catch (error) {
    failures.push(`${id} (${slug}): ${error.message}`);
    if (previous[id]) logos[id] = previous[id];
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
await fs.writeFile(
  output,
  JSON.stringify({ retrievedAt: new Date().toISOString(), logos }, null, 2) +
    "\n",
);
console.log(
  `${Object.keys(logos).length}/${Object.keys(SLUGS).length} cup logos written to ${path.relative(root, output)}`,
);
if (failures.length) console.warn("Unavailable:\n  " + failures.join("\n  "));

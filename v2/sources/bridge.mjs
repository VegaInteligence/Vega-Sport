#!/usr/bin/env node
/**
 * main's own Wikidata and Commons readers (frontend/src/services, scripts), run as they
 * are for the v2 adapters (vega_v2/sources/wikidata.py), which read the JSON printed
 * here and write typed rows. Nothing is stored by this script.
 *
 *   node v2/sources/bridge.mjs club <uefa id|Q id>
 *   node v2/sources/bridge.mjs identity <name> <country>
 *   node v2/sources/bridge.mjs stadium <Q id>
 *   node v2/sources/bridge.mjs portraits '<json array of names>'
 *   node v2/sources/bridge.mjs plans
 *   node v2/sources/bridge.mjs projection <open-cups|openligadb|nations-results> '<query string>'
 *     main's own source projection (scripts/source-projections), which fetches its source
 *     and normalizes it: prints {status, body}.
 */
import { readFileSync } from "node:fs";
import { fetchWikidataClub } from "../../dashboard/frontend/src/services/wikidata-club.js";
import { resolveClubIdentity } from "../../dashboard/frontend/src/services/wikidata-club-identity.js";
import { fetchWikidataStadium } from "../../dashboard/frontend/src/services/wikidata-stadium.js";
import { stadiumPlans } from "../../dashboard/frontend/src/services/stadium-plans.js";
import { findCoachPortraitBatch } from "../../dashboard/scripts/coach-portrait-source.mjs";

const [command, ...args] = process.argv.slice(2);
let out;
if (command === "club") out = await fetchWikidataClub(args[0]);
else if (command === "identity") out = await resolveClubIdentity(args[0], args[1]);
else if (command === "stadium") out = await fetchWikidataStadium(args[0]);
else if (command === "portraits") out = Object.fromEntries(await findCoachPortraitBatch(JSON.parse(args[0])));
else if (command === "plans") {
  const source = readFileSync(new URL("../../dashboard/frontend/src/services/stadium-plans.js", import.meta.url), "utf8");
  out = Object.fromEntries([...new Set(source.match(/\bQ[1-9]\d{0,11}(?=:)/g) || [])].map((id) => [id, stadiumPlans(id)]));
} else if (command === "projection") {
  if (!["open-cups", "openligadb", "nations-results"].includes(args[0])) process.exit(2);
  const { GET } = await import(`../../dashboard/scripts/source-projections/${args[0]}.mjs`);
  const response = await GET(new Request(`http://bridge/api/${args[0]}?${args[1] || ""}`));
  out = { status: response.status, body: await response.json().catch(() => null) };
} else {
  console.error("unknown command");
  process.exit(2);
}
process.stdout.write(JSON.stringify(out ?? null));

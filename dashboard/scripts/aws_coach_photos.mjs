/** Ingestion-only repair of coach photos in existing club projections. */
import { pathToFileURL } from "node:url";
import { commonsPhoto } from "../frontend/src/services/wikidata-club.js";
import { normalizeText } from "../frontend/src/services/format.js";

// These clubs are processed first so the most visited profiles recover promptly.
const PRIORITY = new Set([
  "52747",
  "50058",
  "52817",
  "52280",
  "50139",
  "52914",
  "7889",
  "52919",
  "1652",
  "50137",
  "50037",
  "50051",
  "50056",
  "50043",
  "50080",
  "50138",
]);

export async function refreshCoachPortraits(
  rows,
  { loadPhoto, loadClub, save },
  concurrency = 2,
) {
  let cursor = 0,
    processed = 0,
    updated = 0,
    unavailable = 0,
    failed = 0;
  const candidates = rows.filter((row) => row.body?.coach?.name);
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < candidates.length) {
        const row = candidates[cursor++];
        const coach = row.body.coach;
        try {
          let photo;
          if (coach.photo?.sourceUrl) {
            photo = await loadPhoto(coach.photo.sourceUrl);
          } else {
            const club = await loadClub(JSON.parse(row.params));
            if (
              club?.coach?.name &&
              normalizeText(club.coach.name) === normalizeText(coach.name)
            )
              photo = club.coach.photo;
          }
          if (!photo?.url) {
            unavailable++;
          } else if (await save(row.params, coach.name, photo)) updated++;
        } catch (error) {
          failed++;
          console.error("Coach portrait refresh failed", error.name);
        }
        processed++;
        if (processed && processed % 20 === 0)
          console.log(
            JSON.stringify({
              processed,
              updated,
              unavailable,
              failed,
              total: candidates.length,
            }),
          );
      }
    }),
  );
  return { total: candidates.length, updated, unavailable, failed };
}

async function main() {
  const { query, database } = await import("./lib/aws-staging.js");
  const { GET: clubFacts } =
    await import("./source-projections/club-wikidata.mjs");
  const all = await query(
    "SELECT params,body FROM statarena.projections WHERE name='club-wikidata'",
  );
  const priorityOnly = process.argv.includes("--priority-only");
  const remainingOnly = process.argv.includes("--remaining-only");
  const rows = all.filter((row) => {
    const priority = PRIORITY.has(JSON.parse(row.params).uefa);
    return priorityOnly ? priority : remainingOnly ? !priority : true;
  });
  const result = await refreshCoachPortraits(rows, {
    loadPhoto: (url) => commonsPhoto(url),
    loadClub: async (params) => {
      const response = await clubFacts(
        new Request(
          "http://ingestion/api/club-wikidata?" + new URLSearchParams(params),
        ),
      );
      return response.ok ? response.json() : null;
    },
    save: async (params, coachName, photo) => {
      const rows = await query(
        "UPDATE statarena.projections SET body=jsonb_set(body,'{coach,photo}',$1::jsonb,true),updated_at=now() WHERE name='club-wikidata' AND params=$2 AND body #>> '{coach,name}'=$3 AND body #> '{coach,photo}' IS DISTINCT FROM $1::jsonb RETURNING 1",
        [JSON.stringify(photo), params, coachName],
      );
      return rows.length > 0;
    },
  });
  console.log(JSON.stringify({ coachPortraitRefresh: result }));
  await database().end();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();

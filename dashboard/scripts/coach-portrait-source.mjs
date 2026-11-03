import { commonsPhoto } from "../frontend/src/services/wikidata-club.js";
import { normalizeText } from "../frontend/src/services/format.js";

const identity = (value) => normalizeText(value).trim().replace(/\s+/g, " ");
const endpoint = "https://www.wikidata.org/w/api.php";
const options = () => ({
  headers: {
    "User-Agent":
      "StatArena/1.0 (https://github.com/OrionQuantPlatform/STATARENA)",
  },
  signal: AbortSignal.timeout(10000),
});
async function wikidata(params, fetcher) {
  const response = await fetcher(
    `${endpoint}?${new URLSearchParams(params)}`,
    options(),
  );
  if (!response.ok) throw new Error(`Portrait source HTTP ${response.status}`);
  return response.json();
}

/** Resolve an exact, unique football-manager identity before using its photo. */
export async function findCoachPortrait(name, fetcher = fetch) {
  if (typeof name !== "string" || name.trim().length < 3 || name.length > 100)
    return null;
  const search = await wikidata(
    {
      action: "wbsearchentities",
      search: name,
      language: "en",
      format: "json",
      type: "item",
      limit: "50",
    },
    fetcher,
  );
  if ((search.search || []).length >= 50) return null;
  const candidates = [
    ...new Set(
      (search.search || [])
        .filter(
          (row) =>
            /^Q[1-9]\d*$/.test(row.id || "") &&
            identity(row.match?.text) === identity(name),
        )
        .map((row) => row.id),
    ),
  ];
  if (!candidates.length) return null;
  const result = await wikidata(
    {
      action: "wbgetentities",
      ids: candidates.join("|"),
      props: "claims",
      format: "json",
    },
    fetcher,
  );
  const managers = candidates.filter((id) =>
    (result.entities?.[id]?.claims?.P106 || []).some(
      (claim) =>
        claim.rank !== "deprecated" &&
        claim.mainsnak?.datavalue?.value?.id === "Q628099",
    ),
  );
  if (managers.length !== 1) return null;
  const claims = result.entities[managers[0]]?.claims?.P18 || [];
  const filename = claims.find(
    (claim) =>
      claim.rank !== "deprecated" &&
      typeof claim.mainsnak?.datavalue?.value === "string",
  )?.mainsnak.datavalue.value;
  if (!filename) return null;
  return commonsPhoto(
    `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`,
    fetcher,
  );
}

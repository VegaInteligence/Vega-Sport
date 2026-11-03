import {
  commonsPhoto,
  commonsPhotoFromInfo,
} from "../frontend/src/services/wikidata-club.js";
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
    async (...args) => {
      const response = await fetcher(...args);
      if (!response.ok)
        throw new Error(`Portrait image source HTTP ${response.status}`);
      return response;
    },
  );
}

/** Resolve many exact names together to avoid one search request per coach. */
export async function findCoachPortraitBatch(names, fetcher = fetch) {
  const requested = [
    ...new Set(
      names.filter(
        (name) =>
          typeof name === "string" &&
          name.trim().length >= 3 &&
          name.length <= 100,
      ),
    ),
  ];
  const result = new Map(requested.map((name) => [name, null]));
  if (!requested.length) return result;
  const labels = requested
    .flatMap((name) => [
      `${JSON.stringify(name)}@en`,
      `${JSON.stringify(name)}@fr`,
    ])
    .join(" ");
  const query = `SELECT ?label ?person ?image WHERE { VALUES ?label { ${labels} } { ?person rdfs:label ?label } UNION { ?person skos:altLabel ?label } ?person wdt:P106 wd:Q628099. OPTIONAL { ?person wdt:P18 ?image. } }`;
  const response = await fetcher("https://query.wikidata.org/sparql", {
    ...options(),
    method: "POST",
    headers: {
      ...options().headers,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/sparql-results+json",
    },
    body: new URLSearchParams({ query, format: "json" }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Portrait source HTTP ${response.status}`);
  const entities = new Map();
  for (const row of (await response.json()).results?.bindings || []) {
    const name = identity(row.label?.value),
      id = row.person?.value;
    if (
      !name ||
      !/^https?:\/\/www\.wikidata\.org\/entity\/Q[1-9]\d*$/.test(id || "")
    )
      continue;
    if (!entities.has(name)) entities.set(name, new Map());
    const persons = entities.get(name);
    if (!persons.has(id)) persons.set(id, new Set());
    if (row.image?.value) persons.get(id).add(row.image.value);
  }
  const files = new Map();
  for (const name of requested) {
    const people = entities.get(identity(name));
    if (people?.size !== 1) continue;
    const path = [...people.values()][0].values().next().value;
    if (!path) continue;
    try {
      const url = new URL(path),
        prefix = "/wiki/Special:FilePath/";
      if (
        url.hostname !== "commons.wikimedia.org" ||
        !url.pathname.startsWith(prefix)
      )
        continue;
      files.set(name, decodeURIComponent(url.pathname.slice(prefix.length)));
    } catch {
      /* Skip malformed file references. */
    }
  }
  if (!files.size) return result;
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "320",
    titles: [...new Set(files.values())]
      .map((file) => `File:${file}`)
      .join("|"),
  });
  const commons = await fetcher(
    `https://commons.wikimedia.org/w/api.php?${params}`,
    options(),
  );
  if (!commons.ok)
    throw new Error(`Portrait image source HTTP ${commons.status}`);
  const fileKey = (file) =>
    identity(file.replace(/^File:/i, "").replaceAll("_", " "));
  const photos = new Map();
  for (const page of Object.values((await commons.json()).query?.pages || {})) {
    const photo = commonsPhotoFromInfo(page?.imageinfo?.[0]);
    if (photo && page.title) photos.set(fileKey(page.title), photo);
  }
  for (const [name, file] of files)
    result.set(name, photos.get(fileKey(file)) || null);
  return result;
}

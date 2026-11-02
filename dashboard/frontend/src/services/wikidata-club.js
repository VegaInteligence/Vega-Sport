const SPARQL = "https://query.wikidata.org/sparql";
const COMMONS = "https://commons.wikimedia.org/w/api.php";

function values(bindings, key, idKey, startKey) {
  const found = new Map();
  for (const row of bindings) {
    const id = row[idKey]?.value;
    const name = row[key]?.value;
    if (!id || !name || /^Q\d+$/.test(name)) continue;
    const start = row[startKey]?.value || "";
    const old = found.get(id);
    if (!old || start > old.start)
      found.set(id, { id, name, start, image: row.image?.value || null });
  }
  return [...found.values()];
}

// Multiple undated or equally recent statements do not identify one coach.
function currentStatement(items) {
  if (items.length === 1) return items[0];
  if (!items.length || items.some((item) => !item.start)) return null;
  items.sort((a, b) => b.start.localeCompare(a.start));
  return items[0].start > items[1].start ? items[0] : null;
}

const plainText = (value) =>
  String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

async function commonsPhoto(filePath, fetcher) {
  if (!filePath) return null;
  let name;
  try {
    const url = new URL(filePath);
    if (
      url.hostname !== "commons.wikimedia.org" ||
      !url.pathname.startsWith("/wiki/Special:FilePath/")
    )
      return null;
    name = decodeURIComponent(
      url.pathname.slice("/wiki/Special:FilePath/".length),
    );
  } catch {
    return null;
  }
  const url = new URL(COMMONS);
  for (const [key, value] of Object.entries({
    action: "query",
    format: "json",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    titles: `File:${name}`,
  }))
    url.searchParams.set(key, value);
  const response = await fetcher(url.href, {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const page = Object.values((await response.json()).query?.pages || {})[0];
  const info = page?.imageinfo?.[0],
    metadata = info?.extmetadata || {};
  if (
    !/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//.test(
      info?.url || "",
    ) ||
    !/^https:\/\/commons\.wikimedia\.org\//.test(info?.descriptionurl || "")
  )
    return null;
  return {
    url: info.url,
    sourceUrl: info.descriptionurl,
    author: plainText(metadata.Artist?.value),
    license: plainText(metadata.LicenseShortName?.value),
  };
}

/** Match through the published UEFA identity, never through a club name. */
export async function fetchWikidataClub(
  uefaId,
  { fetcher = fetch, now = () => new Date() } = {},
) {
  const ref = String(uefaId);
  if (!/^(?:\d{1,12}|Q[1-9]\d{0,11})$/.test(ref))
    throw new Error("Invalid club identity");
  const identityClause = ref.startsWith("Q")
    ? `VALUES ?club { wd:${ref} }`
    : `?club wdt:P7361 "${ref}".`;
  const query = `SELECT ?club ?stadium ?stadiumLabel ?stadiumAlias ?groundStart ?coach ?coachLabel ?coachStart ?image ?founded WHERE {
    ${identityClause}
    OPTIONAL {
      ?club p:P115 ?groundStatement. ?groundStatement ps:P115 ?stadium; wikibase:rank ?groundRank.
      FILTER(?groundRank != wikibase:DeprecatedRank)
      OPTIONAL { ?groundStatement pq:P580 ?groundStart. }
      OPTIONAL { ?stadium skos:altLabel ?stadiumAlias. FILTER(LANG(?stadiumAlias) = "fr") }
      FILTER(!BOUND(?groundStart) || ?groundStart <= NOW())
      FILTER NOT EXISTS { ?groundStatement pq:P582 ?groundEnd. FILTER(?groundEnd < NOW()) }
    }
    OPTIONAL {
      ?club p:P286 ?coachStatement. ?coachStatement ps:P286 ?coach; wikibase:rank ?coachRank.
      FILTER(?coachRank != wikibase:DeprecatedRank)
      OPTIONAL { ?coachStatement pq:P580 ?coachStart. }
      FILTER(!BOUND(?coachStart) || ?coachStart <= NOW())
      FILTER NOT EXISTS { ?coachStatement pq:P582 ?coachEnd. FILTER(?coachEnd < NOW()) }
      OPTIONAL { ?coach wdt:P18 ?image. }
    }
    OPTIONAL { ?club wdt:P571 ?founded. }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
  }`;
  const url = new URL(SPARQL);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  const response = await fetcher(url.href, {
    headers: {
      Accept: "application/sparql-results+json",
      "User-Agent":
        "StatArena/1.0 (https://github.com/OrionQuantPlatform/STATARENA)",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
  const rows = (await response.json()).results?.bindings || [];
  const clubs = [
    ...new Set(rows.map((row) => row.club?.value).filter(Boolean)),
  ];
  if (clubs.length !== 1) return null;
  const coach = currentStatement(
    values(rows, "coachLabel", "coach", "coachStart"),
  );
  const stadium = currentStatement(
    values(rows, "stadiumLabel", "stadium", "groundStart"),
  );
  let photo = null;
  try {
    photo = await commonsPhoto(coach?.image, fetcher);
  } catch {
    /* The name remains useful without a picture. */
  }
  const founded =
    rows
      .map((row) => row.founded?.value?.slice(0, 4))
      .filter((year) => /^\d{4}$/.test(year || ""))
      .sort()[0] || null;
  return {
    sourceUrl: clubs[0].replace(/^http:/, "https:"),
    fetchedAt: now().toISOString(),
    stadium: stadium?.name || null,
    stadiumId:
      stadium?.id?.match(
        /^https?:\/\/www\.wikidata\.org\/entity\/(Q[1-9]\d*)$/,
      )?.[1] || null,
    stadiumAlias:
      stadium?.id === "http://www.wikidata.org/entity/Q133566" &&
      rows.some((row) => row.stadiumAlias?.value === "San Siro")
        ? "San Siro"
        : null,
    coach: coach ? { name: coach.name, photo } : null,
    founded,
  };
}

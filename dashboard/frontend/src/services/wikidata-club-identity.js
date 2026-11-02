const COUNTRIES = {
  FRA: "Q142",
  ITA: "Q38",
  ESP: "Q29",
  GER: "Q183",
  POR: "Q45",
  NED: "Q55",
  BEL: "Q31",
  AUT: "Q40",
  SUI: "Q39",
  TUR: "Q43",
  GRE: "Q41",
  DEN: "Q35",
  SWE: "Q34",
  NOR: "Q20",
  FIN: "Q33",
  CRO: "Q224",
  ROU: "Q218",
  POL: "Q36",
  CZE: "Q213",
  SVK: "Q214",
  SVN: "Q215",
  HUN: "Q28",
  SRB: "Q403",
  UKR: "Q212",
  IRL: "Q27",
  ISL: "Q189",
  LVA: "Q211",
  LTU: "Q37",
  EST: "Q191",
  BUL: "Q219",
  CYP: "Q229",
  ISR: "Q801",
  USA: "Q30",
  BRA: "Q155",
  ARG: "Q414",
  JPN: "Q17",
  KOR: "Q884",
  SAU: "Q851",
  AUS: "Q408",
  MEX: "Q96",
  ENG: "Q21",
  SCO: "Q22",
};
const normal = (text) =>
  String(text || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("fr")
    .replace(/\s+/g, " ");
const ids = (entity, property) =>
  (entity.claims?.[property] || [])
    .filter((claim) => claim.rank !== "deprecated")
    .map((claim) => claim.mainsnak?.datavalue?.value?.id);

/** Exact name and country, only for an unambiguous football-club item. */
export async function resolveClubIdentity(name, country, fetcher = fetch) {
  const countryId = COUNTRIES[country];
  if (
    !countryId ||
    typeof name !== "string" ||
    name.length < 2 ||
    name.length > 100
  )
    return null;
  const url = new URL("https://www.wikidata.org/w/api.php");
  for (const [key, value] of Object.entries({
    action: "wbsearchentities",
    search: name,
    language: "en",
    format: "json",
    type: "item",
    limit: "50",
  }))
    url.searchParams.set(key, value);
  const response = await fetcher(url.href, {
    headers: {
      "User-Agent":
        "StatArena/1.0 (https://github.com/OrionQuantPlatform/STATARENA)",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const results = (await response.json()).search || [];
  if (results.length >= 50) return null;
  const candidates = [
    ...new Set(
      results
        .filter(
          (item) =>
            normal(item.match?.text) === normal(name) &&
            /^Q[1-9]\d*$/.test(item.id || ""),
        )
        .map((item) => item.id),
    ),
  ];
  if (!candidates.length) return null;
  const entitiesUrl = new URL("https://www.wikidata.org/w/api.php");
  for (const [key, value] of Object.entries({
    action: "wbgetentities",
    ids: candidates.join("|"),
    props: "claims",
    format: "json",
  }))
    entitiesUrl.searchParams.set(key, value);
  const entitiesResponse = await fetcher(entitiesUrl.href, {
    headers: {
      "User-Agent":
        "StatArena/1.0 (https://github.com/OrionQuantPlatform/STATARENA)",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!entitiesResponse.ok) return null;
  const entities = (await entitiesResponse.json()).entities || {};
  const matches = candidates.filter(
    (id) =>
      ids(entities[id] || {}, "P31").includes("Q476028") &&
      ids(entities[id] || {}, "P17").includes(countryId),
  );
  return matches.length === 1 ? matches[0] : null;
}

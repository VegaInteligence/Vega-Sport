const API = "https://www.wikidata.org/w/api.php";

const value = (claim) => claim?.mainsnak?.datavalue?.value;
const qualify = (claim, property) =>
  claim?.qualifiers?.[property]?.[0]?.datavalue?.value;
const dateValue = (item) => {
  const match = /^\+(\d{4})-(\d{2})-(\d{2})/.exec(item?.time || "");
  if (!match || item.precision < 9) return null;
  const [, year, month, day] = match;
  if (item.precision >= 11 && month !== "00" && day !== "00")
    return `${year}-${month}-${day}`;
  if (item.precision >= 10 && month !== "00") return `${year}-${month}`;
  return year;
};
const usable = (claims) =>
  (claims || []).filter(
    (claim) => claim.rank !== "deprecated" && value(claim) != null,
  );
const preferred = (claims) => {
  const list = usable(claims),
    best = list.filter((claim) => claim.rank === "preferred");
  return best.length ? best : list;
};
const firstDate = (claims) =>
  preferred(claims)
    .map((claim) => dateValue(value(claim)))
    .filter(Boolean)
    .sort()[0] || null;
const lowerBound = (date) =>
  date.length === 4 ? date + "-01-01" : date.length === 7 ? date + "-01" : date;
const upperBound = (date) => {
  if (date.length === 4) return date + "-12-31";
  if (date.length === 7) {
    const [year, month] = date.split("-").map(Number);
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }
  return date;
};

export function extractStadium(entity, id, now = new Date()) {
  const claims = entity?.claims || {},
    today = now.toISOString().slice(0, 10);
  let capacities = usable(claims.P1083).flatMap((claim) => {
    const amount = Number(value(claim)?.amount);
    const start = dateValue(qualify(claim, "P580")),
      end = dateValue(qualify(claim, "P582"));
    const observed = dateValue(qualify(claim, "P585"));
    if (
      value(claim)?.unit !== "1" ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      (start && lowerBound(start) > today) ||
      (end && upperBound(end) < today) ||
      (observed && lowerBound(observed) > today)
    )
      return [];
    return [{ amount, observed: observed || start || null, rank: claim.rank }];
  });
  if (capacities.some((entry) => entry.rank === "preferred"))
    capacities = capacities.filter((entry) => entry.rank === "preferred");
  capacities.sort((a, b) => (b.observed || "").localeCompare(a.observed || ""));
  const first = capacities[0],
    second = capacities[1];
  const capacity =
    first &&
    (!second ||
      first.amount === second.amount ||
      (first.observed && first.observed > (second.observed || "")))
      ? first
      : null;
  const point = preferred(claims.P625)
    .map(value)
    .find(
      (p) =>
        p?.globe === "http://www.wikidata.org/entity/Q2" &&
        Number.isFinite(p.latitude) &&
        Number.isFinite(p.longitude) &&
        Math.abs(p.latitude) <= 90 &&
        Math.abs(p.longitude) <= 180,
    );
  return {
    id,
    sourceUrl: `https://www.wikidata.org/wiki/${id}`,
    fetchedAt: now.toISOString(),
    capacity: capacity?.amount || null,
    capacityAsOf: capacity?.observed || null,
    opened: firstDate(claims.P1619),
    created: firstDate(claims.P571),
    coordinates: point ? { lat: point.latitude, lon: point.longitude } : null,
  };
}

export async function fetchWikidataStadium(
  id,
  { fetcher = fetch, now = () => new Date() } = {},
) {
  if (!/^Q[1-9]\d{0,11}$/.test(id || ""))
    throw new Error("Invalid stadium identity");
  const url = new URL(API);
  for (const [key, val] of Object.entries({
    action: "wbgetentities",
    ids: id,
    props: "claims",
    format: "json",
  }))
    url.searchParams.set(key, val);
  const response = await fetcher(url.href, {
    headers: {
      "User-Agent":
        "StatArena/1.0 (https://github.com/OrionQuantPlatform/STATARENA)",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
  const entity = (await response.json()).entities?.[id];
  return entity && !Object.hasOwn(entity, "missing")
    ? extractStadium(entity, id, now())
    : null;
}

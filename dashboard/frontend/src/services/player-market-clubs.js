import { searchIdentities } from "./global-search-client.js";

const normalized = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
const affixes = new Set(["fc", "cf", "afc", "sc", "ac"]);
function withoutAffixes(value) {
  const words = normalized(value).split(" ").filter(Boolean);
  while (words.length > 1 && affixes.has(words[0])) words.shift();
  while (words.length > 1 && affixes.has(words.at(-1))) words.pop();
  return words.join(" ");
}
const barcaReserve = new Set([
  "fc barcelona b",
  "barcelona b",
  "barca b",
  "fc barcelona athletic",
  "barcelona athletic",
  "barca athletic",
  "fc barcelona atletic",
  "barcelona atletic",
  "barca atletic",
]);

function uniqueMatch(teams, predicate) {
  const matches = (teams || []).filter(
    (team) => team?.name && predicate(team.name),
  );
  const unique = new Map();
  for (const team of matches) {
    const key = team.id || `name:${normalized(team.name)}`;
    if (!unique.get(key)) unique.set(key, team.imageUrl || "");
  }
  return unique.size === 1 ? [...unique.values()][0] : "";
}

function barcaFallback(teams) {
  const reserve = (teams || []).filter((team) =>
    barcaReserve.has(normalized(team?.name)),
  );
  if (reserve.length) {
    const reserveCrest = uniqueMatch(reserve, () => true);
    if (
      reserveCrest ||
      new Set(reserve.map((team) => team.id || normalized(team.name))).size !==
        1
    )
      return reserveCrest;
  }
  return uniqueMatch(
    teams,
    (teamName) => withoutAffixes(teamName) === "barcelona",
  );
}

/** Return a source URL only when the observed club identity is unambiguous. */
export function marketClubCrest(name, teams) {
  const key = normalized(name);
  if (!key) return "";
  const exact = (teams || []).filter((team) => normalized(team?.name) === key);
  if (exact.length) {
    const exactCrest = uniqueMatch(exact, () => true);
    if (
      exactCrest ||
      !barcaReserve.has(key) ||
      new Set(exact.map((team) => team.id || normalized(team.name))).size !== 1
    )
      return exactCrest;
    return barcaFallback(teams);
  }
  const core = withoutAffixes(name);
  const variants = (teams || []).filter(
    (team) => withoutAffixes(team?.name) === core,
  );
  if (variants.length) {
    const variantCrest = uniqueMatch(variants, () => true);
    if (
      variantCrest ||
      !barcaReserve.has(key) ||
      new Set(variants.map((team) => team.id || normalized(team.name))).size !==
        1
    )
      return variantCrest;
    return barcaFallback(teams);
  }
  if (barcaReserve.has(key)) {
    return barcaFallback(teams);
  }
  return "";
}

/** Bounded, independently recoverable reads through Vega's own identity search. */
export async function loadMarketClubCrests(names, season, { signal } = {}) {
  const result = new Map();
  const requests = new Map();
  const pending = [
    ...new Set(
      (names || []).filter((name) => typeof name === "string" && name.trim()),
    ),
  ];
  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      signal?.throwIfAborted();
      const name = pending[cursor++];
      const query = barcaReserve.has(normalized(name))
        ? "barcelona"
        : withoutAffixes(name);
      try {
        if (!requests.has(query)) {
          requests.set(query, searchIdentities(query, season, { signal }));
        }
        const matches = await requests.get(query);
        signal?.throwIfAborted();
        result.set(
          name,
          matches.clubsHasMore ? "" : marketClubCrest(name, matches.clubs),
        );
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
        result.set(name, "");
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(2, pending.length) }, worker),
  );
  return Object.fromEntries(result);
}

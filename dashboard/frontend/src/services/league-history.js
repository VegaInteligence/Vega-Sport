// The archived seasons of the five big leagues (2010/11–2020/21) on the competition page: before PitchAPI's first
// season, the base holds their results; GET /api/league-history serves one season (backend/api/src/routes/league-history.mjs).
import { useResource, json } from "./resources.js";

export const HISTORY_LEAGUE_IDS = new Set(["l_4WFCIZ", "l_0ErfuF", "l_1Isor4", "l_0ALvwF", "l_3FJFUl"]);
const FIRST = 2010, LAST = 2020;
export const HISTORY_SEASONS = Array.from({ length: LAST - FIRST + 1 }, (_, i) => `${LAST - i}/${LAST - i + 1}`);

/** An archived season of one of the five leagues. */
export const isHistorySeason = (id, season) => HISTORY_LEAGUE_IDS.has(id) && HISTORY_SEASONS.includes(String(season || ""));

/** The league's seasons, its archived ones after its own (none added for another competition). */
export function withHistorySeasons(competition) {
  const seasons = competition?.seasons || [];
  if (!competition || !HISTORY_LEAGUE_IDS.has(competition.id)) return seasons;
  const held = new Set(seasons.map(String));
  return [...seasons, ...HISTORY_SEASONS.filter((s) => !held.has(s))];
}

export function useLeagueHistory(id, season) {
  return useResource(
    `league-history:${id}:${season}`,
    () => json(`/api/league-history?${new URLSearchParams({ competition: id, season })}`).then((body) => body?.data ?? null),
    isHistorySeason(id, season),
  );
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** A matchday's label: « 1ʳᵉ journée », « 38ᵉ journée », or the month for a season the archive gives no round. */
export function matchdayLabel(group) {
  if (group.number != null) return `${group.number}${group.number === 1 ? "ʳᵉ" : "ᵉ"} journée`;
  const [year, month] = String(group.month || "").split("-");
  const name = MONTHS[Number(month) - 1];
  return name ? `${name[0].toUpperCase()}${name.slice(1)} ${year}` : "";
}

/** A club's short name in the season's summary line (« Reims, Ajaccio, Troyes »): the archive's prefixes dropped. */
export const shortClub = (name) => String(name || "").replace(/^(?:Stade de |ESTAC |Gazélec FC |AC |AS |SC |FC |SM |EA |OGC |US |CF |RCD |UD |SD |CD )/, "").replace(/ (?:FC|CF|SC|AC|Calcio|1846|1907|1909|96|98|04|05)$/, "") || name;

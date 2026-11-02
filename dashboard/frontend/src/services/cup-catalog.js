import { normalizeText } from "../model.js";
import { NATIONAL_CUP_ARCHIVES, GERMAN_CUP_FOLDER, GERMAN_CUP_SEASONS } from "./cup-archives.js";

export const WORLD_CUP_ID = "l_1XLtP0";
export const WORLD_CUP_FALLBACK = { id: WORLD_CUP_ID, name: "Coupe du monde", country: "INT", seasons: ["2026", "2022"] };
export const OPEN_CUP_CATALOG = [
  { id: "open-cup:france-cup", name: "Coupe de France", country: "FRA", source: "openfootball", sourceKey: "france-cup", seasons: ["2024/2025"], defaultSeason: "2024/2025", aliases: ["French Cup"], coverage: "Archive 2024/2025" },
  { id: "openligadb:nations-league", name: "Ligue des Nations", country: "UEFA", source: "openligadb", sourceKey: "nations-league", seasons: ["2026/2027"], defaultSeason: "2026/2027", aliases: ["UEFA Nations League", "Nations League"], coverage: "Ligues A à D · 2026/2027" },
  { id: "open-cup:euro", name: "Euro", country: "UEFA", source: "openfootball", sourceKey: "euro", seasons: ["2028", "2024", "2020"], defaultSeason: "2024", aliases: ["Championnat d’Europe", "European Championship"] },
  { id: "open-cup:club-world-cup", name: "Coupe du monde des clubs", country: "INT", source: "openfootball", sourceKey: "club-world-cup", seasons: ["2025"], defaultSeason: "2025", aliases: ["Club World Cup"] },
  { id: "open-cup:world-cup-history", name: "Coupe du monde — archives", country: "INT", source: "openfootball", sourceKey: "world-cup-history", seasons: ["2018", "2014", "2010", "2006", "2002", "1998", "1994", "1990", "1986", "1982", "1978", "1974", "1970", "1966", "1962", "1958", "1954", "1950", "1938", "1934", "1930"], defaultSeason: "2018", aliases: ["World Cup", "Mondial"] },
];
const CUP_LABELS = {
  "ESP_CUP_copa-del-rey": ["Coupe du Roi", "Copa del Rey"],
  "ENG_CUP_efl-cup": ["Coupe de la Ligue anglaise", "EFL Cup", "Carabao Cup"],
  "ENG_CUP_fa-cup": ["FA Cup", "Coupe d’Angleterre"],
  "GER_CUP_dfb-pokal": ["Coupe d’Allemagne", "DFB-Pokal"],
  "ITA_CUP_coppa-italia": ["Coupe d’Italie", "Coppa Italia"],
  "AUT_CUP_ofb-cup": ["Coupe d’Autriche", "OFB Cup"],
  "NED_CUP_knvb-beker": ["Coupe des Pays-Bas", "KNVB Beker"],
  "POR_CUP_taca-de-portugal": ["Coupe du Portugal", "Taça de Portugal"],
  "SCO_CUP_league-cup": ["Coupe de la Ligue écossaise", "Scottish League Cup"],
  "SCO_CUP_scottish-cup": ["Coupe d’Écosse", "Scottish Cup"],
  "SUI_CUP_swiss-cup": ["Coupe de Suisse", "Swiss Cup"],
};

/** Only promote actual cup datasets with at least one collected match. */
export function supplementalCupCatalog(index) {
  if (!Array.isArray(index?.competitions)) return [];
  return index.competitions.flatMap((item) => {
    if (!/^[A-Z]{3}_CUP_[a-z0-9-]+$/i.test(item.folder || "")) return [];
    if (!(Number(item.tables?.results?.rows) > 0 || Number(item.tables?.fixtures?.rows) > 0)) return [];
    const ref = item.tables?.results?.path || item.tables?.fixtures?.path || "";
    const seasonParts = ref.match(/^raw\/seasons\/(\d{4})-(\d{4})\//);
    if (!seasonParts) return [];
    const season = seasonParts[1] + "/" + seasonParts[2];
    const labels = CUP_LABELS[item.folder] || [item.name || item.folder];
    const archive = NATIONAL_CUP_ARCHIVES[item.folder];
    const editions = [season, ...(archive ? [archive.season] : []), ...(item.folder === GERMAN_CUP_FOLDER ? GERMAN_CUP_SEASONS : [])];
    return [{ id: "open-matchday:" + item.folder, name: labels[0], country: item.country_code || "", source: "open-matchday", folder: item.folder, seasons: [...new Set(editions)].sort().reverse(), defaultSeason: season, aliases: [...labels.slice(1), item.name || ""], tables: item.tables, sourceDate: index.meta?.source_generated_at_utc || index.meta?.retrieved_at_utc || null }];
  });
}

export const normalizeCompetitionQuery = (value) => normalizeText(value).replace(/[’‘]/g, "'");

export function competitionSearchText(competition, countryName = "") {
  const aliases = competition.id === WORLD_CUP_ID ? ["Coupe du monde", "World Cup", "Mondial"] : competition.aliases || [];
  return normalizeCompetitionQuery([competition.name, competition.country, countryName, ...aliases].filter(Boolean).join(" "));
}

/** Native provider IDs remain authoritative; no two sources are merged by name. */
export function mergeCupCatalog(nativeCompetitions, supplementalIndex) {
  const native = nativeCompetitions.map((competition) => competition.id === WORLD_CUP_ID ? { ...competition, name: "Coupe du monde", seasons: [...new Set([...(competition.seasons || []), ...WORLD_CUP_FALLBACK.seasons])].sort().reverse() } : competition);
  const ids = new Set(native.map((competition) => competition.id));
  const world = ids.has(WORLD_CUP_ID) ? [] : [WORLD_CUP_FALLBACK];
  const extras = supplementalCupCatalog(supplementalIndex);
  return [...native, ...world, ...OPEN_CUP_CATALOG, ...extras.filter((cup) => !ids.has(cup.id))];
}

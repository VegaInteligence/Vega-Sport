import { normalizeText } from "../model.js";
import { NATIONAL_CUP_ARCHIVES, GERMAN_CUP_FOLDER, GERMAN_CUP_SEASONS } from "./cup-archives.js";
import cupLogos from "../../../shared/cup-logos.json" with { type: "json" };
import { familyArtworkUrl, WORLD_CUP_ARCHIVE_ID, WORLD_CUP_ID } from "./competition-artwork.js";

export { WORLD_CUP_ARCHIVE_ID, WORLD_CUP_ID } from "./competition-artwork.js";

/** Cup logos refreshed by the previous pipeline's refresh_cup_logos.mjs. */
const CUP_LOGOS = cupLogos.logos || {};
function withLogo(competition) {
  const imageUrl = familyArtworkUrl(competition.id, competition.imageUrl || CUP_LOGOS[competition.id]?.imageUrl);
  return imageUrl === competition.imageUrl ? competition : { ...competition, imageUrl };
}

export const WORLD_CUP_FALLBACK = { id: WORLD_CUP_ID, name: "Coupe du monde", country: "INT", seasons: ["2026", "2022"] };
// The World Cup's archive (WORLD_CUP_ARCHIVE_ID) is the same competition on the site, one selector: it also reads the
// collected editions (2026, 2022), whose page stays the collected World Cup's.
export const OPEN_CUP_CATALOG = [
  { id: "open-cup:france-cup", name: "Coupe de France", country: "FRA", source: "openfootball", sourceKey: "france-cup", seasons: ["2024/2025"], defaultSeason: "2024/2025", aliases: ["French Cup"], coverage: "Archive 2024/2025" },
  { id: "openligadb:nations-league", name: "Ligue des Nations", country: "UEFA", source: "openligadb", sourceKey: "nations-league", seasons: ["2026/2027"], defaultSeason: "2026/2027", aliases: ["UEFA Nations League", "Nations League"], coverage: "Ligues A à D · 2026/2027" },
  { id: "open-cup:euro", name: "Euro", country: "UEFA", source: "openfootball", sourceKey: "euro", seasons: ["2028", "2024", "2020"], defaultSeason: "2024", aliases: ["Championnat d’Europe", "European Championship"] },
  { id: "open-cup:club-world-cup", name: "Coupe du monde des clubs", country: "INT", source: "openfootball", sourceKey: "club-world-cup", seasons: ["2025", "2023", "2022", "2021"], defaultSeason: "2025", aliases: ["Club World Cup"] },
  // The other confederations' club competitions (OpenFootball, CC0) and national-team tournaments (International Results, CC0).
  { id: "open-cup:copa-libertadores", name: "Copa Libertadores", country: "CONMEBOL", source: "openfootball", sourceKey: "copa-libertadores", seasons: ["2026", "2025", "2024", "2023", "2022", "2021"], defaultSeason: "2026", aliases: ["Libertadores", "CONMEBOL Libertadores"] },
  { id: "open-cup:copa-sudamericana", name: "Copa Sudamericana", country: "CONMEBOL", source: "openfootball", sourceKey: "copa-sudamericana", seasons: ["2025", "2024", "2023", "2022", "2021"], defaultSeason: "2025", aliases: ["Sudamericana", "CONMEBOL Sudamericana"] },
  { id: "open-cup:concacaf-champions", name: "Coupe des champions de la CONCACAF", country: "CONCACAF", source: "openfootball", sourceKey: "concacaf-champions", seasons: ["2025", "2024", "2023", "2022", "2021"], defaultSeason: "2025", aliases: ["CONCACAF Champions Cup", "CONCACAF Champions League"] },
  { id: "open-cup:caf-champions-league", name: "Ligue des champions de la CAF", country: "CAF", source: "openfootball", sourceKey: "caf-champions-league", seasons: ["2024/2025", "2023/2024"], defaultSeason: "2024/2025", aliases: ["CAF Champions League"] },
  { id: "nations-results:afcon", name: "Coupe d’Afrique des nations", country: "CAF", source: "nations-results", sourceKey: "afcon", seasons: ["2025", "2023", "2021"], defaultSeason: "2025", aliases: ["CAN", "AFCON", "Africa Cup of Nations"], coverage: "Résultats" },
  { id: "nations-results:copa-america", name: "Copa América", country: "CONMEBOL", source: "nations-results", sourceKey: "copa-america", seasons: ["2024"], defaultSeason: "2024", aliases: ["Copa America"], coverage: "Résultats" },
  { id: "nations-results:asian-cup", name: "Coupe d’Asie des nations", country: "AFC", source: "nations-results", sourceKey: "asian-cup", seasons: ["2023"], defaultSeason: "2023", aliases: ["AFC Asian Cup", "Asian Cup"], coverage: "Résultats" },
  { id: "nations-results:gold-cup", name: "Gold Cup", country: "CONCACAF", source: "nations-results", sourceKey: "gold-cup", seasons: ["2025", "2023"], defaultSeason: "2025", aliases: ["CONCACAF Gold Cup"], coverage: "Résultats" },
  { id: WORLD_CUP_ARCHIVE_ID, name: "Coupe du monde — archives", country: "INT", source: "openfootball", sourceKey: "world-cup-history", seasons: ["2026", "2022", "2018", "2014", "2010", "2006", "2002", "1998", "1994", "1990", "1986", "1982", "1978", "1974", "1970", "1966", "1962", "1958", "1954", "1950", "1938", "1934", "1930"], defaultSeason: "2018", aliases: ["World Cup", "Mondial"] },
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

/** The verified logo the API gives for the edition's own competition (its FK), never another's (FAILURE_MODES.md §22). */
const ownLogo = (item) => (typeof item.image_url === "string" && item.image_url ? { imageUrl: item.image_url } : {});
/** A Vega competition id (PitchAPI's key, else l_v and seven digits), as /api/cups/index publishes it. */
const COMPETITION_ID = /^l_(?:[A-Za-z0-9]{6}|v\d{7})$/;
/** The edition's competition by its canonical id (the API's `competition_id`, the edition's FK), never by a name (VI-30). */
const ownIdentity = (item) => (typeof item.competition_id === "string" && COMPETITION_ID.test(item.competition_id) ? { canonicalId: item.competition_id } : {});

/** The entry a page asks for: by its own id, else by the canonical id it answers to (FAILURE_MODES_VI30.md V12). */
export function findCompetition(catalog, id) {
  if (!id) return undefined;
  return catalog.find((c) => c.id === id) || catalog.find((c) => c.canonicalId === id);
}

/** Whether an id not found yet may still come with the supplemental index (its source key or a canonical l_v id). */
export const awaitsCupIndex = (id) => typeof id === "string" && (id.startsWith("open-matchday:") || /^l_v\d{7}$/.test(id));

/** Only promote actual cup datasets with at least one collected match. */
export function supplementalCupCatalog(index) {
  if (!Array.isArray(index?.competitions)) return [];
  return index.competitions.flatMap((item) => {
    if (!/^[A-Z]{3}_CUP_[a-z0-9-]+$/i.test(item.folder || "")) return [];
    if (!(Number(item.tables?.results?.rows) > 0 || Number(item.tables?.fixtures?.rows) > 0) && !item.discovered) return [];
    const season = /^\d{4}\/\d{4}$/.test(item.season || "") ? item.season : "";
    if (!season) return [];
    const labels = CUP_LABELS[item.folder] || [item.name || item.folder];
    const archive = NATIONAL_CUP_ARCHIVES[item.folder];
    const editions = [season, ...Object.keys(item.editions || {}).filter((value) => /^\d{4}\/\d{4}$/.test(value)), ...(archive ? [archive.season] : []), ...(item.folder === GERMAN_CUP_FOLDER ? GERMAN_CUP_SEASONS : [])];
    return [{ id: "open-matchday:" + item.folder, name: labels[0], country: item.country_code || "", source: "open-matchday", folder: item.folder, seasons: [...new Set(editions)].sort().reverse(), defaultSeason: season, aliases: [...labels.slice(1), item.name || ""], tables: item.tables, editions: item.editions || null, sourceDate: index.meta?.source_generated_at_utc || index.meta?.retrieved_at_utc || null, ...ownLogo(item), ...ownIdentity(item) }];
  });
}

export const normalizeCompetitionQuery = (value) => normalizeText(value).replace(/[’‘]/g, "'");

export function competitionSearchText(competition, countryName = "") {
  const aliases = competition.id === WORLD_CUP_ID ? ["Coupe du monde", "World Cup", "Mondial"] : competition.aliases || [];
  return normalizeCompetitionQuery([competition.name, competition.country, countryName, ...aliases].filter(Boolean).join(" "));
}

// The complementary leagues (open-matchday's leagues PitchAPI has not), by folder: their name on the site, then other names.
const LEAGUE_LABELS = {
  "BEL_U21_pro-league": ["Pro League U21", "Belgian Pro League U21"],
  "CYP_1_first-division": ["Championnat de Chypre", "Cyprus League", "Cypriot First Division"],
  "ENG_5_national-league": ["National League", "Vanarama National League"],
  "ENG_6_national-league-north": ["National League North"],
  "ENG_6_national-league-south": ["National League South"],
  "ENG_7_northern-premier-league": ["Northern Premier League"],
  "IRE_2_first-division": ["First Division irlandaise", "League of Ireland First Division"],
  "IRE_3_national-league": ["National League irlandaise", "League of Ireland National League"],
  "KAZ_1_premier-league": ["Premier League du Kazakhstan", "Kazakhstan Premier League"],
  "POL_2_division-1": ["I Liga", "Pologne deuxième division"],
  "POL_3_division-2": ["II Liga", "Pologne troisième division"],
  "SCO_2_championship": ["Championship écossais", "Scottish Championship"],
  "SCO_3_league-one": ["League One écossaise", "Scottish League One"],
  "SCO_4_league-two": ["League Two écossaise", "Scottish League Two"],
  "SVN_1_prva-liga": ["Prva Liga", "Championnat de Slovénie"],
  "UKR_1_premier-league": ["Premier League ukrainienne", "Ukrainian Premier League"],
  "WAL_1_cymru-premier": ["Cymru Premier", "Championnat du pays de Galles"],
  "WAL_2_cymru-north": ["Cymru North"],
  "WAL_3_cymru-south": ["Cymru South"],
};
// The source's country codes the site names otherwise (Ireland).
const COUNTRY_CODES = { IRE: "IRL" };

/**
 * The complementary leagues (VI-19, the user on 17 Nov 2026): every league folder of open-matchday with a match
 * collected, a page of its own like the cups. A league the main source already lists (same name, same country: a copy)
 * is left out, never listed twice.
 */
export function supplementalLeagueCatalog(index, native = []) {
  if (!Array.isArray(index?.competitions)) return [];
  const held = new Set((native || []).map((c) => normalizeText(c.name || "") + "|" + (c.country || "")));
  const heldIds = new Set((native || []).map((c) => c.id));
  return index.competitions.flatMap((item) => {
    if (!/^[A-Z]{3}_[A-Z0-9]+_[a-z0-9-]+$/i.test(item.folder || "") || /_CUP_/i.test(item.folder)) return [];
    if (!(Number(item.tables?.results?.rows) > 0 || Number(item.tables?.fixtures?.rows) > 0)) return [];
    const season = /^\d{4}\/\d{4}$/.test(item.season || "") ? item.season : "";
    if (!season) return [];
    // The main source's own competition (the same canonical id, VI-30), then a copy by its name and country.
    if (ownIdentity(item).canonicalId && heldIds.has(item.competition_id)) return [];
    const code = item.country_code || item.folder.split("_")[0];
    const country = COUNTRY_CODES[code] || code;
    if (held.has(normalizeText(item.name || "") + "|" + country) || held.has(normalizeText(item.name || "") + "|" + code)) return [];
    const labels = LEAGUE_LABELS[item.folder] || [item.name || item.folder];
    const editions = [season, ...Object.keys(item.editions || {}).filter((value) => /^\d{4}\/\d{4}$/.test(value))];
    return [{ id: "open-matchday:" + item.folder, name: labels[0], country, source: "open-matchday", kind: "league", folder: item.folder,
      seasons: [...new Set(editions)].sort().reverse(), defaultSeason: season, aliases: [...new Set([...labels.slice(1), item.name || ""])].filter(Boolean),
      tables: item.tables, editions: item.editions || null, sourceDate: index.meta?.source_generated_at_utc || index.meta?.retrieved_at_utc || null, ...ownLogo(item), ...ownIdentity(item) }];
  });
}

/** Native provider IDs remain authoritative; no two sources are merged by name. */
export function mergeCupCatalog(nativeCompetitions, supplementalIndex, workerNative = []) {
  const pending = new Map((workerNative || []).filter((item) => /^l_[A-Za-z0-9]{6}$/.test(item.id || "")).map((item) => [item.id, item]));
  const native = nativeCompetitions.map((competition) => {
    const saved = pending.get(competition.id); pending.delete(competition.id);
    const seasons = [...new Set([...(competition.seasons || []), ...(saved?.seasons || []), ...(competition.id === WORLD_CUP_ID ? WORLD_CUP_FALLBACK.seasons : [])])].sort().reverse();
    return { ...competition, ...(saved ? { cupWorker: true } : {}), ...(competition.id === WORLD_CUP_ID ? { name: "Coupe du monde" } : {}), seasons };
  });
  native.push(...[...pending.values()].map((competition) => ({ ...competition, cupWorker: true })));
  const ids = new Set(native.map((competition) => competition.id));
  const world = ids.has(WORLD_CUP_ID) ? [] : [WORLD_CUP_FALLBACK];
  const extras = [...supplementalCupCatalog(supplementalIndex), ...supplementalLeagueCatalog(supplementalIndex, nativeCompetitions)];
  // An entry whose canonical id is a native competition's is that competition: listed once, as the native one.
  return [...native, ...world, ...OPEN_CUP_CATALOG, ...extras.filter((cup) => !ids.has(cup.id) && !ids.has(cup.canonicalId))].map(withLogo);
}

// The cup key the nations' API gives a major tournament, when the catalogue names it otherwise.
const TOURNAMENT_KEYS = { "world-cup": "world-cup-history" };

/**
 * The page of a major tournament's edition ({ id, edition }), for a nation's run (/api/nations: its tournament key and
 * year): the World Cup's archive up to its last edition, the collected World Cup after it, the Euro and the other
 * confederations' tournaments by their editions. Null when the site has no page for that year.
 */
export function tournamentEdition(tournament, year) {
  const edition = /^\d{4}$/.test(String(year ?? "")) ? String(year) : "";
  const cup = OPEN_CUP_CATALOG.find((item) => item.sourceKey === (TOURNAMENT_KEYS[tournament] || tournament));
  if (!edition || !cup) return null;
  // The archive's own editions: not the collected World Cup's, which the archive also reads.
  const seasons = cup.id === WORLD_CUP_ARCHIVE_ID ? cup.seasons.filter((season) => !WORLD_CUP_FALLBACK.seasons.includes(season)) : cup.seasons;
  if (seasons.includes(edition)) return { id: cup.id, edition };
  return tournament === "world-cup" && edition > seasons[0] ? { id: WORLD_CUP_ID, edition } : null;
}

/**
 * The editions a competition's page offers, latest first, each with the competition that holds it: the World Cup's
 * collected editions and its archive under one selector, any other competition's own seasons.
 */
export function competitionEditions(competition, catalog = []) {
  if (!competition) return [];
  const own = (item) => (item?.seasons || []).map((season) => ({ season: String(season), id: item.id }));
  if (competition.id !== WORLD_CUP_ID && competition.id !== WORLD_CUP_ARCHIVE_ID) return own(competition);
  const of = (id) => (competition.id === id ? competition : catalog.find((item) => item.id === id));
  const seen = new Set();
  return [...own(of(WORLD_CUP_ID)), ...own(of(WORLD_CUP_ARCHIVE_ID))]
    .filter((edition) => !seen.has(edition.season) && seen.add(edition.season))
    .sort((a, b) => b.season.localeCompare(a.season));
}

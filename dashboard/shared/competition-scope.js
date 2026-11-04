/** Explicit first divisions: a country filter would also include lower tiers. */
export const EUROPE_FOCUS = [
  { id: "l_4WFCIZ", name: "Premier League", country: "ENG" },
  { id: "l_0ErfuF", name: "LaLiga", country: "ESP" },
  { id: "l_1Isor4", name: "Bundesliga", country: "GER" },
  { id: "l_0ALvwF", name: "Serie A", country: "ITA" },
  { id: "l_3FJFUl", name: "Ligue 1", country: "FRA" },
  { id: "l_4QexZg", name: "Liga Portugal", country: "POR" },
  { id: "l_4H43wr", name: "Eredivisie", country: "NED" },
  { id: "l_0bfbkO", name: "Champions League", country: "UEFA" },
  { id: "l_38d9HA", name: "Europa League", country: "UEFA" },
  { id: "l_2WZ2tt", name: "Conference League", country: "UEFA" },
];
export const EUROPE_FOCUS_IDS = new Set(EUROPE_FOCUS.map((c) => c.id));
/** The seven countries whose top-flight leagues lead the selection. */
export const EUROPE_FOCUS_COUNTRIES = new Set(
  EUROPE_FOCUS.filter((c) => c.country !== "UEFA").map((c) => c.country),
);
// Domestic knock-out and super cups (Coupe de France, DFB-Pokal, FA Cup,
// EFL Cup, Supercopa, Trophée des champions…), matched on any of their names.
const CUP_NAME =
  /\b(cup|coupe|copa|coppa|pokal|beker|ta[cç]a|super ?cup|supercopa|supercoppa|supercoupe|superta[cç]a|community shield|troph[ée]e des champions|johan cruijff schaal)\b/i;
const SUPER_CUP_NAME = /\b(super ?cup|supercoupe|supercopa|supercoppa)\b/i;
const competitionNames = (competition) =>
  [competition.name, competition.folder, ...(competition.aliases || [])]
    .filter(Boolean)
    .join(" ");
/**
 * Top 7 Europe + UEFA: the seven leagues, every national cup and super cup of
 * their countries, and the UEFA club competitions (Champions League, Europa
 * League, Conference League, Super Cup). Lower divisions and national-team
 * tournaments stay outside.
 */
/** League ids of the manifest chunks that belong to Top 7 Europe + UEFA. */
export function europeFocusIds(manifest) {
  const ids = new Set(EUROPE_FOCUS_IDS);
  for (const competition of manifest?.competitions || [])
    if (inEuropeFocus(competition)) ids.add(competition.id);
  for (const season of manifest?.seasons || [])
    for (const chunk of season.chunks || [])
      if ((chunk.competitions || []).some(inEuropeFocus))
        ids.add(chunk.leagueId);
  return ids;
}
export function inEuropeFocus(competition) {
  if (!competition) return false;
  if (EUROPE_FOCUS_IDS.has(competition.id)) return true;
  const folder =
    competition.folder ||
    (String(competition.id || "").match(/^open-matchday:(.+)$/) || [])[1] ||
    "";
  const country =
    competition.country ||
    competition.country_code ||
    competition.countryCode ||
    (folder.match(/^([A-Z]{3})_CUP_/) || [])[1];
  const names = competitionNames(competition);
  if (EUROPE_FOCUS_COUNTRIES.has(country))
    return /_CUP_/.test(folder) || CUP_NAME.test(names);
  return (
    ["UEFA", "INT", "INT-2"].includes(country) &&
    SUPER_CUP_NAME.test(names) &&
    /uefa/i.test(names + " " + country)
  );
}
export const PREFERENCES_KEY = "orion.preferences.v1";

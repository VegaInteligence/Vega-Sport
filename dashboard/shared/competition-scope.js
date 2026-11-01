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
export const PREFERENCES_KEY = "orion.preferences.v1";

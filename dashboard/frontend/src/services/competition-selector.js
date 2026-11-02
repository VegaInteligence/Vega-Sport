import { EUROPE_FOCUS } from "../../../shared/competition-scope.js";

export const FEATURED_LEAGUE_IDS = EUROPE_FOCUS.slice(0, 7).map(
  (item) => item.id,
);
export const FEATURED_EUROPE_IDS = EUROPE_FOCUS.slice(7).map((item) => item.id);
export const COUNTRY_NAMES = {
  ARG: "Argentine",
  AUS: "Australie",
  AUT: "Autriche",
  BEL: "Belgique",
  BOL: "Bolivie",
  BRA: "Brésil",
  CAN: "Canada",
  CHI: "Chili",
  CHN: "Chine",
  COL: "Colombie",
  CRO: "Croatie",
  CZE: "Tchéquie",
  DEN: "Danemark",
  ECU: "Équateur",
  EGY: "Égypte",
  ENG: "Angleterre",
  ESP: "Espagne",
  FIN: "Finlande",
  FRA: "France",
  GER: "Allemagne",
  GRE: "Grèce",
  IND: "Inde",
  INT: "International",
  "INT-2": "Europe",
  IRL: "Irlande",
  ISL: "Islande",
  ISR: "Israël",
  ITA: "Italie",
  JPN: "Japon",
  KOR: "Corée du Sud",
  KSA: "Arabie saoudite",
  LVA: "Lettonie",
  MEX: "Mexique",
  NED: "Pays-Bas",
  NOR: "Norvège",
  PAR: "Paraguay",
  PER: "Pérou",
  POL: "Pologne",
  POR: "Portugal",
  QAT: "Qatar",
  ROU: "Roumanie",
  RSA: "Afrique du Sud",
  RUS: "Russie",
  SCO: "Écosse",
  SRB: "Serbie",
  SUI: "Suisse",
  SVK: "Slovaquie",
  SWE: "Suède",
  THA: "Thaïlande",
  TUR: "Turquie",
  UAE: "Émirats arabes unis",
  USA: "États-Unis",
  VEN: "Venezuela",
  UEFA: "Europe",
};
export const countryLabel = (country) =>
  COUNTRY_NAMES[country] || country || "International";
export function orderedFeatured(catalog, ids = FEATURED_LEAGUE_IDS) {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// Keep international competitions together, then order countries by their
// French display name. Known league pyramids are listed from top to bottom.
const INTERNATIONAL_COUNTRIES = new Set(["INT", "INT-2", "UEFA"]);
const frenchOrder = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
const LEAGUE_ORDER = {
  INT: ["Champions League", "Europa League", "Conference League", "World Cup"],
  ENG: ["Premier League", "Championship", "League One", "League Two"],
  GER: ["Bundesliga", "2. Bundesliga", "3. Liga"],
  FRA: ["Ligue 1", "Ligue 2"],
  ESP: ["LaLiga", "LaLiga2"],
  ITA: ["Serie A", "Serie B"],
  NED: ["Eredivisie", "Eerste Divisie"],
  BEL: ["First Division A", "Challenger Pro League"],
  SUI: ["Super League", "Challenge League"],
  DEN: ["Superligaen", "1. Division"],
  TUR: ["Super Lig", "1. Lig"],
  BRA: ["Serie A", "Serie B", "Paulista A1"],
  JPN: ["J. League", "J3 League"],
  KOR: ["K League 1", "K League 2"],
  KSA: ["Saudi Pro League", "Saudi First Division"],
  USA: ["MLS", "USL Championship", "USL League One", "MLS Next Pro"],
};

function countryRank(country) {
  return INTERNATIONAL_COUNTRIES.has(country) ? 0 : country ? 1 : 2;
}

/** Country options use their visible French labels, not provider codes. */
export function orderedCountryCodes(catalog) {
  return [...new Set(catalog.map((item) => item.country).filter(Boolean))].sort(
    (a, b) => countryRank(a) - countryRank(b) || frenchOrder.compare(countryLabel(a), countryLabel(b)) || frenchOrder.compare(a, b),
  );
}

/** Group an already-filtered catalogue; limit preserves first-paint ordering. */
export function competitionGroups(catalog, limit = Infinity) {
  const groups = new Map();
  for (const competition of catalog) {
    const country = competition.country || "";
    const key = INTERNATIONAL_COUNTRIES.has(country) ? "international" : country || "unknown";
    if (!groups.has(key)) groups.set(key, {
      key, country: key === "international" ? "INT" : country,
      label: key === "international" ? "International" : country ? countryLabel(country) : "Autres compétitions",
      competitions: [],
    });
    groups.get(key).competitions.push(competition);
  }
  const ordered = [...groups.values()].sort((a, b) =>
    countryRank(a.country) - countryRank(b.country) || frenchOrder.compare(a.label, b.label) || frenchOrder.compare(a.key, b.key),
  );
  let remaining = Math.max(0, limit);
  return ordered.flatMap((group) => {
    const priorities = LEAGUE_ORDER[group.country] || [];
    function rank(competition) {
      const index = priorities.findIndex((name) => frenchOrder.compare(name, competition.name || "") === 0);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    }
    group.competitions.sort((a, b) => rank(a) - rank(b) || frenchOrder.compare(a.name || "", b.name || "") || frenchOrder.compare(a.id || "", b.id || ""));
    const visible = group.competitions.slice(0, remaining);
    remaining -= visible.length;
    return visible.length ? [{ ...group, competitions: visible }] : [];
  });
}

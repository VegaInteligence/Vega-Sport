import { EUROPE_FOCUS } from "../../../shared/competition-scope.js";
import { seasonLabel } from "./format.js";

// A calendar-year season and its archive bucket describe the same edition.
// Keep the provider's season identifier for fixture requests.
export function mergeCompetitionSeasons(provider = [], archived = []) {
  const represented = new Set(provider.map(seasonLabel));
  return [
    ...new Set([
      ...provider,
      ...archived.filter((season) => !represented.has(seasonLabel(season))),
    ]),
  ]
    .sort()
    .reverse();
}

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
  CYP: "Chypre",
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
  IRE: "Irlande",
  ISL: "Islande",
  ISR: "Israël",
  ITA: "Italie",
  JPN: "Japon",
  KAZ: "Kazakhstan",
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
  SVN: "Slovénie",
  SWE: "Suède",
  THA: "Thaïlande",
  TUR: "Turquie",
  UAE: "Émirats arabes unis",
  UKR: "Ukraine",
  USA: "États-Unis",
  VEN: "Venezuela",
  WAL: "Pays de Galles",
  UEFA: "Europe",
};
export const countryLabel = (country) =>
  COUNTRY_NAMES[country] || country || "International";
export const competitionCountry = (competition) =>
  FEATURED_EUROPE_IDS.includes(competition.id)
    ? "UEFA"
    : competition.country ||
      competition.country_code ||
      competition.countryCode ||
      "";
export const competitionCountryLabel = (competition) =>
  countryLabel(competitionCountry(competition));
export const competitionLabel = (competition) =>
  `${competition.name} · ${competitionCountryLabel(competition)}`;
const countryOrder = new Intl.Collator("fr", {
  sensitivity: "base",
  numeric: true,
});
/** Shared by native filters, the home picker and both archive catalogues. */
export function orderedCompetitions(competitions) {
  return [...competitions].sort(
    (a, b) =>
      countryOrder.compare(
        competitionCountryLabel(a),
        competitionCountryLabel(b),
      ) ||
      countryOrder.compare(a.name || "", b.name || "") ||
      countryOrder.compare(a.id || a.folder || "", b.id || b.folder || ""),
  );
}
export function orderedFeatured(catalog, ids = FEATURED_LEAGUE_IDS) {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// Keep the grouped catalogue and league pyramids, with the same country A-Z
// order used by competition selectors.
const frenchOrder = new Intl.Collator("fr", {
  sensitivity: "base",
  numeric: true,
});
const LEAGUE_ORDER = {
  INT: ["World Cup"],
  UEFA: ["Champions League", "Europa League", "Conference League"],
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

/**
 * Whether a league is its country's top flight: the head of the known league
 * pyramid, or the country's only league in the catalogue.
 */
export function isTopFlight(competition, catalog = []) {
  if (!competition || competition.source || competition.cupWorker) return false;
  const country = competitionCountry(competition);
  if (!country || ["UEFA", "INT", "INT-2", "FIFA"].includes(country))
    return false;
  const pyramid = LEAGUE_ORDER[country];
  if (pyramid)
    return frenchOrder.compare(pyramid[0], competition.name || "") === 0;
  const leagues = catalog.filter(
    (item) =>
      competitionCountry(item) === country && !item.source && !item.cupWorker,
  );
  return leagues.length === 1 && leagues[0].id === competition.id;
}

/** Country options use their visible French labels, not provider codes. */
export function orderedCountryCodes(catalog) {
  return [...new Set(catalog.map(competitionCountry).filter(Boolean))].sort(
    (a, b) =>
      frenchOrder.compare(countryLabel(a), countryLabel(b)) ||
      frenchOrder.compare(a, b),
  );
}

/** Group an already-filtered catalogue; limit preserves first-paint ordering. */
export function competitionGroups(catalog, limit = Infinity) {
  const groups = new Map();
  for (const competition of catalog) {
    const country = competitionCountry(competition);
    const key = country || "unknown";
    if (!groups.has(key))
      groups.set(key, {
        key,
        country,
        label: country ? countryLabel(country) : "Autres compétitions",
        competitions: [],
      });
    groups.get(key).competitions.push(competition);
  }
  const ordered = [...groups.values()].sort(
    (a, b) =>
      frenchOrder.compare(a.label, b.label) ||
      frenchOrder.compare(a.key, b.key),
  );
  let remaining = Math.max(0, limit);
  return ordered.flatMap((group) => {
    const priorities = LEAGUE_ORDER[group.country] || [];
    function rank(competition) {
      const index = priorities.findIndex(
        (name) => frenchOrder.compare(name, competition.name || "") === 0,
      );
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    }
    group.competitions.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        frenchOrder.compare(a.name || "", b.name || "") ||
        frenchOrder.compare(a.id || "", b.id || ""),
    );
    const visible = group.competitions.slice(0, remaining);
    remaining -= visible.length;
    return visible.length ? [{ ...group, competitions: visible }] : [];
  });
}

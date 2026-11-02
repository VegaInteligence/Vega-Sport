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

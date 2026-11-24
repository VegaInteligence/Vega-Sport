/**
 * « Chez vous » (VI-48, #69; doc "Accueil", « Coin d'un pays »): which country the home's strip shows.
 * A manual choice (preferences.homeCountry, saved with the other preferences and mirrored in the
 * home cookie) beats the country the hosting detects (x-vercel-ip-country, ISO-2), which beats
 * nothing. « Ne rien afficher » is the choice "none". The base names a country by its own
 * three-letter code (FRA, ENG, GER…), never ISO-2: the table below maps one to the other for the
 * countries of the manifest, and for a flag. Pseudo codes (INT, INT-2, UEFA, the confederations)
 * are no country and stay out.
 */
import { countryLabel } from "./competition-selector.js";

export const HOME_COUNTRY_NONE = "none";

// Base code → the hosting's ISO-2 code (none: no hosting code names it) and the flag (flag-icons).
const COUNTRIES = {
  ARG: ["AR", "ar"],
  AUS: ["AU", "au"],
  AUT: ["AT", "at"],
  BEL: ["BE", "be"],
  BOL: ["BO", "bo"],
  BRA: ["BR", "br"],
  CAN: ["CA", "ca"],
  CHI: ["CL", "cl"],
  CHN: ["CN", "cn"],
  COL: ["CO", "co"],
  CRO: ["HR", "hr"],
  CYP: ["CY", "cy"],
  CZE: ["CZ", "cz"],
  DEN: ["DK", "dk"],
  ECU: ["EC", "ec"],
  EGY: ["EG", "eg"],
  ENG: ["GB", "gb-eng"],
  ESP: ["ES", "es"],
  FIN: ["FI", "fi"],
  FRA: ["FR", "fr"],
  GER: ["DE", "de"],
  GRE: ["GR", "gr"],
  IND: ["IN", "in"],
  IRL: ["IE", "ie"],
  ISL: ["IS", "is"],
  ISR: ["IL", "il"],
  ITA: ["IT", "it"],
  JPN: ["JP", "jp"],
  KAZ: ["KZ", "kz"],
  KOR: ["KR", "kr"],
  KSA: ["SA", "sa"],
  LVA: ["LV", "lv"],
  MEX: ["MX", "mx"],
  NED: ["NL", "nl"],
  NOR: ["NO", "no"],
  PAR: ["PY", "py"],
  PER: ["PE", "pe"],
  POL: ["PL", "pl"],
  POR: ["PT", "pt"],
  QAT: ["QA", "qa"],
  ROU: ["RO", "ro"],
  RSA: ["ZA", "za"],
  RUS: ["RU", "ru"],
  SCO: [null, "gb-sct"],
  SRB: ["RS", "rs"],
  SUI: ["CH", "ch"],
  SVK: ["SK", "sk"],
  SVN: ["SI", "si"],
  SWE: ["SE", "se"],
  THA: ["TH", "th"],
  TUR: ["TR", "tr"],
  UAE: ["AE", "ae"],
  UKR: ["UA", "ua"],
  USA: ["US", "us"],
  VEN: ["VE", "ve"],
  WAL: [null, "gb-wls"],
};
const FROM_ISO = Object.fromEntries(
  Object.entries(COUNTRIES)
    .filter(([, [iso]]) => iso)
    .map(([code, [iso]]) => [iso, code]),
);

/** The base's code of a hosting's ISO-2 country code (GB → ENG), or null. */
export function countryFromIso(value) {
  if (typeof value !== "string" || !/^[A-Za-z]{2}$/.test(value)) return null;
  return FROM_ISO[value.toUpperCase()] || null;
}

/** A stored choice: a country of the table, "none", or "" (no choice). */
export function homeCountryChoice(value) {
  return value === HOME_COUNTRY_NONE ||
    (typeof value === "string" && Object.hasOwn(COUNTRIES, value))
    ? value
    : "";
}

/** The strip's country: the manual choice, else the detected one, else null. */
export function resolveHomeCountry(choice, detectedIso) {
  const chosen = homeCountryChoice(choice);
  if (chosen === HOME_COUNTRY_NONE) return null;
  return chosen || countryFromIso(detectedIso);
}

export const countryFlag = (code) => COUNTRIES[code]?.[1] || null;
export const homeCountryName = (code) => countryLabel(code);

const frenchOrder = new Intl.Collator("fr", { sensitivity: "base" });
/** The menu: each country of these competitions once, by French name. */
export function menuCountries(competitions = []) {
  const codes = new Set(
    competitions
      .map((c) => c?.country || c?.country_code || c?.providerCountry)
      .filter((code) => Object.hasOwn(COUNTRIES, code || "")),
  );
  return [...codes]
    .map((code) => ({
      code,
      name: homeCountryName(code),
      flag: countryFlag(code),
    }))
    .sort(
      (a, b) =>
        frenchOrder.compare(a.name, b.name) || a.code.localeCompare(b.code),
    );
}

// « Course au titre » opened on Ligue 1 before VI-48: still the default.
const DEFAULT_TITLE_RACE = "l_3FJFUl";
/** The title race's first tab: the visitor's country's league when it is among the tables. */
export function initialTitleRace(
  tables = [],
  competitions = new Map(),
  country = null,
) {
  const local =
    country &&
    tables.find((t) => competitions.get(t.leagueId)?.country === country);
  if (local) return local.leagueId;
  return tables.some((t) => t.leagueId === DEFAULT_TITLE_RACE)
    ? DEFAULT_TITLE_RACE
    : tables[0]?.leagueId;
}

/** The strip's days in the API's order, each day's matches by kick-off (the API's selection unchanged). */
export function stripDays(matches = []) {
  const days = [];
  for (const match of matches) {
    const last = days.at(-1);
    if (last?.day === match.day) last.matches.push(match);
    else days.push({ day: match.day, matches: [match] });
  }
  for (const day of days)
    day.matches.sort(
      (a, b) =>
        a.time - b.time ||
        String(a.fixture?.id).localeCompare(String(b.fixture?.id)),
    );
  return days;
}

/**
 * "matches": the strip; "empty": a country chosen by hand without match keeps its head and one
 * line (the way back stays on the page); "hidden": no country, no answer, or a detected country
 * without match.
 */
export function stripMode({ choice, country, data }) {
  if (!country || !data) return "hidden";
  if (data.matches?.length) return "matches";
  return homeCountryChoice(choice) === country ? "empty" : "hidden";
}

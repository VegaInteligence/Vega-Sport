import countries from "flag-icons/country.json" with { type: "json" };
import { normalizeText } from "../model.js";

const key = (value) =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const names = new Map();
const add = (name, code) => {
  const value = key(name);
  if (value) names.set(value, code);
};

// The source uses English names; also accept the browser's French and English
// country names without confusing a club with a national team.
const displays =
  typeof Intl.DisplayNames === "function"
    ? [
        new Intl.DisplayNames(["en"], { type: "region" }),
        new Intl.DisplayNames(["fr"], { type: "region" }),
      ]
    : [];
for (const country of countries) {
  if (
    !country.iso &&
    !["gb-eng", "gb-sct", "gb-wls", "gb-nir", "xk"].includes(country.code)
  )
    continue;
  add(country.name, country.code);
  if (/^[a-z]{2}$/.test(country.code)) {
    for (const display of displays)
      add(display.of(country.code.toUpperCase()), country.code);
  }
}
for (const [name, code] of Object.entries({
  Turkey: "tr",
  Turkiye: "tr",
  Czechia: "cz",
  "Czech Republic": "cz",
  "Republic of Ireland": "ie",
  "Northern Ireland": "gb-nir",
  "Bosnia-Herzegovina": "ba",
  "Bosnia & Herzegovina": "ba",
  "Cape Verde": "cv",
  "Ivory Coast": "ci",
  "DR Congo": "cd",
  "Congo DR": "cd",
  "Congo Republic": "cg",
  USA: "us",
  "United States": "us",
  "IR Iran": "ir",
  "Korea Republic": "kr",
  "Korea DPR": "kp",
  "North Macedonia": "mk",
  // The home nations by their French names (the Nations League's lists).
  Angleterre: "gb-eng",
  "Écosse": "gb-sct",
  "Pays de Galles": "gb-wls",
  "Irlande du Nord": "gb-nir",
}))
  add(name, code);

// The teams of the past and the flag they played under: West Germany's and Czechoslovakia's are their successors', the
// Dutch East Indies played under the Netherlands'; the Soviet Union, East Germany and Zaire are drawn in the site's
// own style (competition-selector.css), the flag library having none.
const PAST_FLAGS = Object.fromEntries(
  Object.entries({
    "West Germany": "de",
    Czechoslovakia: "cz",
    "Dutch East Indies": "nl",
    "Soviet Union": "su",
    "East Germany": "dd",
    Zaire: "zr",
  }).map(([name, code]) => [key(name), code]),
);
const YUGOSLAVIA = ["yugoslavia", "yougoslavie"];
const SERBIA_MONTENEGRO = ["serbia and montenegro", "serbie et montenegro"];

/**
 * A national team's flag in an edition (the user, 18 November 2026: every edition has its flags, the old ones too): a
 * country of today has its flag whatever the year, a team of the past the one it played under. Yugoslavia has the
 * kingdom's plain tricolour before 1946, the star until 1991, the plain tricolour again until 2006 (Serbia and
 * Montenegro's too) and none after, nor without a year. An unknown slot is left blank rather than guessed.
 */
export function nationalFlagCode(name, season) {
  const year = /(?:19|20)\d{2}/.exec(String(season || ""));
  const normalized = key(name);
  if (YUGOSLAVIA.includes(normalized) || SERBIA_MONTENEGRO.includes(normalized)) {
    if (!year || Number(year[0]) > 2006) return null;
    return YUGOSLAVIA.includes(normalized) && Number(year[0]) >= 1946 && Number(year[0]) <= 1991 ? "yu-1946" : "yu-1992";
  }
  return PAST_FLAGS[normalized] || names.get(normalized) || null;
}

export function nationalTeamName(name, season) {
  // A team of the past keeps its own name: its flag's code is its successor's (West Germany's is Germany's).
  if (PAST_TEAMS[key(name)]) return PAST_TEAMS[key(name)];
  const code = nationalFlagCode(name, season);
  return code?.length === 2
    ? displays[1]?.of(code.toUpperCase()) || name
    : name;
}

// The home nations have no country code of their own; two countries the browser names by their capital.
const LABELS = { "gb-eng": "Angleterre", "gb-sct": "Écosse", "gb-wls": "Pays de Galles", "gb-nir": "Irlande du Nord", cd: "RD Congo", cg: "Congo" };
// The teams of the past (the World Cup's archives): a name, no flag.
const PAST_TEAMS = Object.fromEntries(
  Object.entries({
    "West Germany": "Allemagne de l’Ouest",
    "East Germany": "Allemagne de l’Est",
    "Soviet Union": "URSS",
    Czechoslovakia: "Tchécoslovaquie",
    Yugoslavia: "Yougoslavie",
    "Serbia and Montenegro": "Serbie-et-Monténégro",
    Zaire: "Zaïre",
    "Dutch East Indies": "Indes néerlandaises",
  }).map(([name, label]) => [key(name), label]),
);

/**
 * A national team's name in French whatever the edition's year, including the
 * home nations and the teams of the past included. A name no country answers to (a fixture's « Winner Match 45 ») is
 * left as it is.
 */
export function nationalTeamLabel(name) {
  const normalized = key(name);
  if (PAST_TEAMS[normalized]) return PAST_TEAMS[normalized];
  const code = names.get(normalized);
  if (!code) return name;
  return LABELS[code] || (code.length === 2 ? displays[1]?.of(code.toUpperCase()) : null) || name;
}

/** The same national team under two spellings (« Italy », « Italie »); two names no country answers to, as text. */
export function sameNationalTeam(a, b) {
  const first = key(a), second = key(b);
  if (!first || !second) return false;
  if (first === second) return true;
  const code = names.get(first);
  return Boolean(code) && !PAST_TEAMS[first] && !PAST_TEAMS[second] && code === names.get(second);
}

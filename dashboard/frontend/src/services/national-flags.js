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
}))
  add(name, code);

/** Unknown slots and old editions are left blank rather than guessed. */
export function nationalFlagCode(name, season) {
  const year = /(?:19|20)\d{2}/.exec(String(season || ""));
  if (year && Number(year[0]) < 1994) return null;
  return names.get(key(name)) || null;
}

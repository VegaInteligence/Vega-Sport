// « Chez vous » (VI-48, #69): which country the home shows, the menu's countries, and the title race's first tab.
// Written before src/services/home-country.js.
//
// Failure modes and expected outcomes:
//  C1 The hosting's ISO-2 code is taken for the base's code (FR ≠ FRA, GB ≠ ENG) → a small table maps it: FR → FRA,
//     BR → BRA, DE → GER, CH → SUI, NL → NED, GB → ENG; lower case accepted.
//  C2 A code that names no country (XX, T1, empty, "FRA", null) or one the table does not cover → null, never a guess.
//  C3 The pseudo codes of the base (INT, INT-2, UEFA, the confederations) are taken for a country → never one: not
//     in the table, never in the menu.
//  C4 Order: a manual choice beats the detected country; « Ne rien afficher » (none) beats it too and gives null; no
//     choice and nothing detected → null.
//  C5 A malformed stored choice (lower case, ISO-2, an object) changes the result → treated as no choice.
//  C6 The menu: each country of the manifest's competitions once, by its French name in French order (Allemagne,
//     Angleterre, Brésil, … ), with its flag; pseudo codes and unknown codes left out.
//  C7 « Course au titre » opens on the visitor's country's league when it is among the tables (the first of that
//     country in the tables' order), else on today's default (Ligue 1 when present, else the first table).
import test from "node:test";
import assert from "node:assert/strict";
import {
  HOME_COUNTRY_NONE,
  countryFromIso,
  homeCountryChoice,
  initialTitleRace,
  menuCountries,
  resolveHomeCountry,
} from "../dashboard/frontend/src/services/home-country.js";

test("C1–C3 the hosting's ISO-2 code maps to the base's code, and only to a real country", () => {
  assert.equal(countryFromIso("FR"), "FRA");
  assert.equal(countryFromIso("fr"), "FRA");
  assert.equal(countryFromIso("BR"), "BRA");
  assert.equal(countryFromIso("GB"), "ENG");
  assert.equal(countryFromIso("DE"), "GER");
  assert.equal(countryFromIso("CH"), "SUI");
  assert.equal(countryFromIso("NL"), "NED");
  assert.equal(countryFromIso("SA"), "KSA");
  assert.equal(countryFromIso("US"), "USA");
  for (const value of ["XX", "T1", "", null, undefined, "FRA", "F", "ZZ", 42]) assert.equal(countryFromIso(value), null, String(value));
});

test("C4–C5 manual choice, then detection, then nothing", () => {
  assert.equal(resolveHomeCountry("BRA", "FR"), "BRA");
  assert.equal(resolveHomeCountry("", "FR"), "FRA");
  assert.equal(resolveHomeCountry(undefined, "BR"), "BRA");
  assert.equal(resolveHomeCountry(HOME_COUNTRY_NONE, "FR"), null);
  assert.equal(resolveHomeCountry("", null), null);
  assert.equal(resolveHomeCountry("", "XX"), null);
  for (const bad of ["bra", "BR", { code: "BRA" }, "INT", "INT-2"]) {
    assert.equal(homeCountryChoice(bad), "", JSON.stringify(bad));
    assert.equal(resolveHomeCountry(bad, "FR"), "FRA", JSON.stringify(bad));
  }
  assert.equal(homeCountryChoice("BRA"), "BRA");
  assert.equal(homeCountryChoice(HOME_COUNTRY_NONE), HOME_COUNTRY_NONE);
});

test("C6 the menu: the manifest's countries once, French names in French order, no pseudo code", () => {
  const competitions = [
    { id: "a", country: "GER" }, { id: "b", country: "BRA" }, { id: "c", country: "ENG" }, { id: "d", country: "ENG" },
    { id: "e", country: "INT" }, { id: "f", country: "INT-2" }, { id: "g", country: "UEFA" }, { id: "h", country: "ZZZ" },
    { id: "i", country: "FRA" }, { id: "j", country: "ESP" }, { id: "k" },
  ];
  const menu = menuCountries(competitions);
  assert.deepEqual(menu.map((c) => c.code), ["GER", "ENG", "BRA", "ESP", "FRA"]);
  assert.deepEqual(menu.map((c) => c.name), ["Allemagne", "Angleterre", "Brésil", "Espagne", "France"]);
  assert.equal(menu.find((c) => c.code === "ENG").flag, "gb-eng");
  assert.equal(menu.find((c) => c.code === "FRA").flag, "fr");
});

test("C7 the title race opens on the country's league when it is among the tables", () => {
  const tables = [{ leagueId: "l_4WFCIZ" }, { leagueId: "l_0ErfuF" }, { leagueId: "l_3FJFUl" }, { leagueId: "l_4QexZg" }];
  const competitions = new Map([
    ["l_4WFCIZ", { country: "ENG" }], ["l_0ErfuF", { country: "ESP" }], ["l_3FJFUl", { country: "FRA" }], ["l_4QexZg", { country: "POR" }],
  ]);
  assert.equal(initialTitleRace(tables, competitions, "POR"), "l_4QexZg");
  assert.equal(initialTitleRace(tables, competitions, "ENG"), "l_4WFCIZ");
  assert.equal(initialTitleRace(tables, competitions, "BRA"), "l_3FJFUl"); // not among the tables: today's default
  assert.equal(initialTitleRace(tables, competitions, null), "l_3FJFUl");
  assert.equal(initialTitleRace(tables.filter((t) => t.leagueId !== "l_3FJFUl"), competitions, null), "l_4WFCIZ");
  assert.equal(initialTitleRace([], competitions, "FRA"), undefined);
});

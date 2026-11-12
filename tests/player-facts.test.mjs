import assert from "node:assert/strict";
import test from "node:test";
import { playerFacts } from "../dashboard/frontend/src/services/player-bio.js";

const today = new Date("2026-11-12T12:00:00Z");

test("a player's published birth date and height become his age and size", () => {
  const { facts } = playerFacts({ name: "Kylian Mbappé", birth_date: "1998-12-20", height_cm: 178 }, today);
  assert.deepEqual(facts, [
    { label: "Âge", value: "27 ans", note: "20/12/1998" },
    { label: "Taille", value: "1,78 m" },
  ]);
  // The birthday of the year has not come yet on 12 November.
  assert.equal(playerFacts({ birth_date: "2007-07-13" }, today).facts[0].value, "19 ans");
  assert.equal(playerFacts({ birth_date: "2005-12-01" }, today).facts[0].value, "20 ans");
});

test("a profile without these facts publishes none", () => {
  assert.deepEqual(playerFacts({ name: "Sans Faits" }, today).facts, []);
  assert.deepEqual(playerFacts({ birth_date: "1998", height_cm: 0 }, today).facts, []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { playerContractFact, playerFacts } from "../dashboard/frontend/src/services/player-bio.js";

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

test("a dated expiry is identified as an observation and a confirmed contract takes precedence", () => {
  const observed = {
    observed_contract_until: "2027-06-30",
    observed_contract_team: "Former Club",
    observed_contract_on: "2026-07-06",
  };
  assert.deepEqual(playerContractFact(observed), {
    label: "Fin de contrat",
    value: "30/06/2027",
    note: "Former Club · Relevé du 06/07/2026",
    summary: "30/06/2027 · Former Club · Relevé du 06/07/2026",
  });
  assert.deepEqual(
    playerContractFact({ ...observed, contract_until: "2031-06-30", contract_team: "Barcelona" }),
    { label: "Fin de contrat", value: "06/2031", note: "30/06/2031 · Barcelona", summary: "30/06/2031 · Barcelona" },
  );
  assert.equal(playerContractFact({ observed_contract_until: observed.observed_contract_until }), null);
});

test("a confirmed MLS season wins over a separately dated observation", () => {
  assert.deepEqual(playerContractFact({
    contract_until_season: 2028, contract_season_competition: "MLS", contract_team: "Inter Miami CF",
    observed_contract_until: "2028-12-31", observed_contract_on: "2026-07-06",
    observed_contract_team: "Inter Miami CF",
  }), {
    label: "Fin de contrat", value: "Saison MLS 2028", note: "Inter Miami CF",
    summary: "Saison MLS 2028 · Inter Miami CF",
  });
  assert.equal(playerFacts({ market_value_eur: 0 }, today).value.amount, "0 €");
});

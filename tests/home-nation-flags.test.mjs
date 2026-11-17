// The home nations' flags under their French names too (« toutes les coupes ont le même design », 17 Nov 2026): the
// Nations League's list names England « Angleterre » and Wales « Pays de Galles », and showed them without a flag.
import test from "node:test";
import assert from "node:assert/strict";
import { nationalFlagCode } from "../dashboard/frontend/src/services/national-flags.js";

test("the four home nations have their flag in French as in English", () => {
  for (const [names, code] of [[["England", "Angleterre"], "gb-eng"], [["Scotland", "Écosse"], "gb-sct"], [["Wales", "Pays de Galles"], "gb-wls"], [["Northern Ireland", "Irlande du Nord"], "gb-nir"]])
    for (const name of names) assert.equal(nationalFlagCode(name, "2026/2027"), code, name);
});

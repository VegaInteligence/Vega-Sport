import test from "node:test";
import assert from "node:assert/strict";
import { playerBio } from "../dashboard/frontend/src/services/player-bio.js";
test("identity uses only explicitly named internal fields", () => {
  assert.deepEqual(
    playerBio({ name: "Lamine Yamal", country_code: "ESP", position_id: 103 }),
    [],
  );
  assert.deepEqual(
    playerBio({
      full_name: "Ada Exemple",
      height_cm: 172,
      nationality: "France",
      preferred_foot: "Gauche",
      position_label: "Défenseure",
    }),
    [
      { label: "Nom complet", value: "Ada Exemple" },
      { label: "Taille", value: "172 cm" },
      { label: "Nationalité", value: "France" },
      { label: "Pied fort", value: "Gauche" },
      { label: "Poste", value: "Défenseure" },
    ],
  );
  assert.deepEqual(playerBio(null), []);
});

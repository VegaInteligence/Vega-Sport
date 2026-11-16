// Every value shown with an « i » has its sentence: the player's statistics, the club's main
// figures and the physical ones; a « / match » name takes its base's sentence.
import test from "node:test";
import assert from "node:assert/strict";
import { explain } from "../dashboard/frontend/src/services/glossary.js";
import { SEASON_METRICS } from "../dashboard/frontend/src/services/season-player.js";

test("every player statistic is explained", () => {
  const missing = Object.values(SEASON_METRICS).map((m) => m.label).filter((label) => !explain(label));
  assert.deepEqual(missing, []);
});

test("the pages' main figures are explained, briefly and without formulas", () => {
  const labels = [
    "Matchs", "Minutes", "Note Vega", "Indice Vega", "Valeur marchande", "Disponibilité", "Postes occupés",
    "Classement", "Bilan", "xPts", "Forme", "Indice Vega club", "Valeur estimée", "Âge moyen", "Âge pondéré",
    "Distance parcourue", "Vitesse de pointe", "Repos médian", "Enchaînements courts", "Pts", "J", "BP", "BC", "Diff.",
    "Possession", "PPDA (approx.)", "Territoire (field tilt)", "Min / B+PD", "Médiane / 90",
  ];
  for (const label of labels) {
    const text = explain(label);
    assert.ok(text, label);
    assert.ok(text.length <= 160, `${label} : ${text.length} caractères`);
    assert.doesNotMatch(text, /[=×∑Σ]/, label);
  }
});

test("a name per match takes its base's sentence; an unknown name has none", () => {
  assert.equal(explain("Tirs / match"), "Tirs tentés, cadrés ou non. En moyenne par match.");
  assert.equal(explain("  possession "), explain("Possession"));
  assert.equal(explain("Contexte d’équipe"), explain("Contexte d'équipe"));
  assert.equal(explain("Adversaire"), null);
  assert.equal(explain(""), null);
});

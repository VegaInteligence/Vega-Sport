// Injuries are read in English: every label shows in French.
import test from "node:test";
import assert from "node:assert/strict";
import { injuryLabel } from "../dashboard/frontend/src/services/injury-labels.js";

// Every label of the first injuries read in production (16 Nov 2026), with its kind.
const READ = [
  ["unknown injury", "injury"], ["Muscle injury", "injury"], ["Hamstring injury", "injury"], ["Knee injury", "injury"],
  ["Ankle injury", "injury"], ["Ill", "illness"], ["Knock", "injury"], ["Cruciate ligament tear", "injury"],
  ["Knee problems", "injury"], ["Torn muscle fiber", "injury"], ["Calf injury", "injury"], ["muscular problems", "injury"],
  ["Corona virus", "illness"], ["Fitness", null], ["Shoulder injury", "injury"], ["minor knock", "injury"], ["Rest", null],
  ["bruise", "injury"], ["Back injury", "injury"], ["Foot injury", "injury"], ["Ankle sprain", "injury"],
  ["Thigh problems", "injury"], ["Achilles tendon problems", "injury"], ["Groin injury", "injury"], ["Adductor pain", "injury"],
  ["Tendon rupture", "injury"], ["Ankle problems", "injury"], ["Back problems", "injury"], ["strain", "injury"],
  ["Torn thigh muscle", "injury"], ["muscle stiffness", "injury"], ["Hip injury", "injury"], ["Bruised knee", "injury"],
  ["Ankle surgery", "injury"], ["Toe injury", "injury"], ["Muscle strain", "injury"], ["Groin surgery", "injury"],
  ["Sore muscles", "injury"], ["Bone edema", null], ["Adductor injury", "injury"], ["Syndesmosis ligament tear", "injury"],
  ["Broken leg", "injury"], ["Groin problems", "injury"], ["Tear of the lateral meniscus", "injury"],
  ["Collateral ligament injury", "injury"], ["Tibial head contusion", "injury"], ["Bone inflammation", "injury"],
  ["Abdominal muscle strain", "injury"], ["Partial muscle tear", "injury"], ["Hand injury", "injury"],
  ["Inflammation of ligaments in the knee", "injury"], ["Cruciate ligament surgery", "injury"], ["Torn ankle ligaments", "injury"],
  ["Dental surgery", "injury"], ["Broken collarbone", "injury"], ["Meniscus irritation", "injury"], ["Edema in the knee", null],
  ["Inflammation of pubic bone", "injury"], ["Food poisoning", null], ["Bruise on the ankle joint", "injury"],
  ["Elbow injury", "injury"], ["Partial damage to the cruciate ligament", "injury"], ["Knee bruise", "injury"],
  ["Hairline fracture in the muscles", "injury"], ["Elbow fracture", "injury"], ["Inflammation in the spine", "injury"],
  ["Calf muscle tear", "injury"], ["Tendonitis", "injury"], ["concussion", "injury"], ["flu", "illness"],
  ["Stomach flu", "illness"], ["Heel injury", "injury"], ["Meniscus tear", "injury"], ["Broken cheekbone", "injury"],
  ["Lung contusion", "injury"], ["Injury to the ankle", "injury"], ["Inflammation in the knee", "injury"],
  ["Head injury", "injury"], ["Bruised ribs", "injury"], ["cold", "illness"], ["Injury to abdominal muscles", "injury"],
  ["Hamstring strain", "injury"], ["Fever", "illness"], ["Torn muscle bundle", "injury"], ["Metatarsal fracture", "injury"],
  ["Pelvic injury", "injury"],
];

const ENGLISH = /\b(injury|problems?|torn|tear|broken|bruise[ds]?|surgery|knee|ankle|hamstring|muscle|strain|sprain|knock|ill|virus|rest|fitness|pain|the|of|on|in)\b/i;

test("every label read so far is named in French, none by its kind alone", () => {
  for (const [label, kind] of READ) {
    const text = injuryLabel(label, kind);
    assert.doesNotMatch(text, ENGLISH, `${label} → ${text}`);
    assert.match(text, /^[A-ZÉÈÀÔŒ]/, `${label} → ${text}`);
    if (!/^unknown injury$/i.test(label)) assert.notEqual(text, kind === "illness" ? "Maladie" : "Blessure", label);
  }
});

test("a body part takes its article", () => {
  assert.equal(injuryLabel("Knee injury", "injury"), "Blessure au genou");
  assert.equal(injuryLabel("Ankle surgery", "injury"), "Opération de la cheville");
  assert.equal(injuryLabel("Groin surgery", "injury"), "Opération de l’aine");
  assert.equal(injuryLabel("Hamstring strain", "injury"), "Élongation aux ischio-jambiers");
  assert.equal(injuryLabel("Achilles tendon problems", "injury"), "Douleurs au tendon d’Achille");
  assert.equal(injuryLabel("Broken leg", "injury"), "Fracture de la jambe");
  assert.equal(injuryLabel("Injury to the ankle", "injury"), "Blessure à la cheville");
  assert.equal(injuryLabel("Bruise on the ankle joint", "injury"), "Contusion à la cheville");
  assert.equal(injuryLabel("Torn thigh muscle", "injury"), "Déchirure à la cuisse");
  assert.equal(injuryLabel("Lower back pain", "injury"), "Douleurs au bas du dos");
});

test("an unknown label is named by its kind, never shown in English", () => {
  assert.equal(injuryLabel("Zygomatic arch issue", "injury"), "Blessure");
  assert.equal(injuryLabel("Some rare disease", "illness"), "Maladie");
  assert.equal(injuryLabel(null, null), "Blessure");
  assert.equal(injuryLabel("  KNOCK ", "injury"), "Coup");
});

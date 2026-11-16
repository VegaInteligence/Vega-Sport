// The rules that turn the squad, physical and style reads into the pages' sentences: a zone,
// a foot or an age is only given when the numbers clearly say so (docs/calculs 08 § 8).
import test from "node:test";
import assert from "node:assert/strict";
import {
  boxReading,
  euros,
  footReading,
  passReading,
  physicalValue,
  speedZones,
  weightedAge,
  zoneReading,
} from "../dashboard/frontend/src/services/profile-blocks.js";
import { previousSeason, seasonShort } from "../dashboard/frontend/src/services/previous-season.js";

const plain = (text) => text.replace(/ | /g, " ");

test("a squad value reads in billions, millions or thousands", () => {
  assert.equal(plain(euros(1300000000)), "1,30 Md€");
  assert.equal(plain(euros(485000000)), "485 M€");
  assert.equal(plain(euros(12500000)), "12,5 M€");
  assert.equal(plain(euros(900000)), "900 k€");
  assert.equal(euros(null), "—");
});

test("a zone is named only when it clearly leads", () => {
  const winger = zoneReading({ matches: 12, actions: 1000, thirds: [100, 300, 600], sides: [700, 200, 100] });
  assert.equal(winger.title, "Surtout le dernier tiers, côté droit");
  assert.match(plain(winger.text), /^60 % de ses actions dans le dernier tiers, 70 % côté droit, 10 % côté gauche$/);
  // 47 % against 40 %: under ten points ahead, so spread.
  assert.equal(zoneReading({ matches: 12, actions: 100, thirds: [13, 47, 40], sides: [34, 33, 33] }).title, "Présence répartie");
  assert.equal(zoneReading({ matches: 4, actions: 100, thirds: [0, 0, 100], sides: [100, 0, 0] }), null);
  assert.equal(zoneReading(null), null);
});

test("the foot he shoots with, from ten shots, penalties left out", () => {
  assert.equal(footReading({ shots: 40, rightFoot: 6, leftFoot: 30, header: 4, other: 0, insideBox: 30 }).title, "Frappe surtout du pied gauche");
  assert.equal(footReading({ shots: 20, rightFoot: 10, leftFoot: 8, header: 2, other: 0, insideBox: 12 }).title, "Frappe des deux pieds");
  assert.equal(footReading({ shots: 12, rightFoot: 0, leftFoot: 0, header: 12, other: 0, insideBox: 12 }).title, "Frappe surtout de la tête");
  assert.match(plain(footReading({ shots: 40, rightFoot: 6, leftFoot: 30, header: 4, other: 0, insideBox: 30 }).text), /17 % de ses frappes du pied droit, 83 % du gauche, 10 % de la tête \(40 tirs hors penalty\)/);
  assert.equal(footReading({ shots: 9, rightFoot: 9, leftFoot: 0, header: 0, other: 0, insideBox: 9 }), null);
  assert.equal(boxReading({ shots: 40, insideBox: 34 }).title, "Tire de près");
  assert.equal(boxReading({ shots: 40, insideBox: 18 }).title, "Tire souvent de loin");
  assert.equal(boxReading({ shots: 40, insideBox: 26 }).title, "Tire de près comme de loin");
});

test("his share of the passes says among whom it is placed", () => {
  const reading = passReading({ competition: "Ligue 1", networks: 12, share: 14.2, percentile: 88, cohort: { label: "milieux centraux" } });
  assert.equal(plain(reading.text), "Reçoit 14,2 % des passes de son équipe");
  assert.equal(plain(reading.rank), "plus que 88 % des milieux centraux de Ligue 1");
  assert.equal(passReading({ competition: "Ligue 1", networks: 6, share: 9, percentile: null, cohort: null }).rank, null);
  assert.equal(passReading(null), null);
});

test("the weighted age needs nine tenths of the minutes and five full matches", () => {
  const ages = [{ age: 24, minutes: 3000 }, { age: 28, minutes: 2000 }, { age: null, minutes: 100 }];
  const value = weightedAge(ages);
  assert.equal(Math.round(value.age * 10) / 10, 26.1);
  assert.equal(weightedAge([{ age: 24, minutes: 3000 }, { age: null, minutes: 2000 }]), null);
  assert.equal(weightedAge([{ age: 24, minutes: 900 }]), null);
});

test("the distance split by pace keeps the rest at zero or more", () => {
  const metrics = [{ key: "distance", value: 10500 }, { key: "running", value: 1900 }, { key: "sprinting", value: 230 }];
  assert.deepEqual(speedZones(metrics).map((z) => [z.label, z.value]), [["Sprint", 230], ["Course", 1900], ["Reste de la distance", 8370]]);
  assert.equal(speedZones([{ key: "distance", value: 100 }, { key: "running", value: 90 }, { key: "sprinting", value: 20 }])[2].value, 0);
  assert.equal(speedZones([{ key: "distance", value: 100 }]), null);
  assert.equal(plain(physicalValue("distance", 10560)), "10,6");
  assert.equal(physicalValue("sprints", null), "—");
});

test("the previous season is the one before, when the site publishes it", () => {
  assert.equal(previousSeason("2025/2026", ["2026/2027", "2025/2026", "2024/2025"]), "2024/2025");
  assert.equal(previousSeason("2024/2025", ["2025/2026", "2024/2025"]), null);
  assert.equal(previousSeason("2026", ["2025"]), null);
  assert.equal(seasonShort("2024/2025"), "2024/25");
});

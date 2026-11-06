import test from "node:test";
import assert from "node:assert/strict";
import {
  playerBio,
  playerDiscipline,
} from "../dashboard/frontend/src/services/player-bio.js";
test("identity and discipline are restricted to an attributed, verified player", () => {
  assert.equal(playerBio("p_2e0FPo").fullName, "Lamine Yamal Nasraoui Ebana");
  assert.equal(playerBio("p_2e0FPo").nationality, "Espagne");
  assert.equal(playerBio("p_unknown"), null);
  const cards = playerDiscipline("p_2e0FPo");
  assert.deepEqual(
    cards.competitions.map(({ matches, yellow, directRed, secondYellow }) => [
      matches,
      yellow,
      directRed,
      secondYellow,
    ]),
    [
      [11, 2, 0, 0],
      [4, 0, 0, 0],
    ],
  );
  assert.equal(playerDiscipline("p_unknown"), null);
});

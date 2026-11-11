import test from "node:test";
import assert from "node:assert/strict";
import {
  SHOTS,
  goals,
  takePenalty,
} from "../dashboard/frontend/src/services/penalty-shootout.js";

/** Replays fixed draws: 3 for the ball's x, 3 for its y, then the keeper's. */
const draws = (...values) => {
  let index = 0;
  return () => values[index++ % values.length];
};
const straight = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];

test("a shot away from the keeper's side is a goal", () => {
  // No read (0.9), the keeper goes left (0.1) and low (0.2).
  const { ball, keeper, outcome } = takePenalty(
    { x: 0.8, y: 0.4 },
    draws(...straight, 0.9, 0.1, 0.2),
  );
  assert.deepEqual(ball, { x: 0.8, y: 0.4 });
  assert.deepEqual(keeper, { x: 0.16, y: 0.3 });
  assert.equal(outcome, "goal");
});

test("the keeper saves a shot on the side he chose, or one he reads", () => {
  assert.equal(
    takePenalty({ x: 0.8, y: 0.4 }, draws(...straight, 0.9, 0.9, 0.2)).outcome,
    "saved",
  );
  // Read (0.1): he follows the ball wherever it goes inside his reach.
  const read = takePenalty(
    { x: 0.2, y: 0.5 },
    draws(...straight, 0.1, 0.5, 0.5),
  );
  assert.deepEqual(read.keeper, { x: 0.2, y: 0.5 });
  assert.equal(read.outcome, "saved");
});

test("aiming at the frame can miss the goal, and never does in the middle", () => {
  const far = [1, 1, 1],
    still = [0.5, 0.5, 0.5],
    keeper = [0.9, 0.1, 0.2];
  assert.equal(
    takePenalty({ x: 1, y: 0.4 }, draws(...far, ...still, ...keeper)).outcome,
    "wide",
  );
  assert.equal(
    takePenalty({ x: 0.8, y: 1 }, draws(...still, ...far, ...keeper)).outcome,
    "over",
  );
  assert.equal(
    takePenalty({ x: 1, y: 0.4 }, draws(...straight, ...keeper)).outcome,
    "post",
  );
  assert.equal(
    takePenalty({ x: 0.8, y: 1 }, draws(...straight, ...keeper)).outcome,
    "bar",
  );
  // The widest possible spread from the centre still lands inside the posts.
  for (const draw of [0, 1]) {
    const { ball } = takePenalty(
      { x: 0.5, y: 0 },
      draws(draw, draw, draw, 0.5, 0.5, 0.5, ...keeper),
    );
    assert.ok(ball.x > 0.4 && ball.x < 0.6, String(ball.x));
  }
});

test("every penalty has one known outcome and stays playable", () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const outcomes = [];
  for (let index = 0; index < 4000; index++) {
    const { ball, keeper, outcome } = takePenalty(
      { x: random() * 1.4 - 0.2, y: random() * 1.4 - 0.2 },
      random,
    );
    assert.ok(
      ["goal", "saved", "post", "bar", "wide", "over"].includes(outcome),
    );
    assert.ok(ball.y >= 0 && keeper.x >= 0.12 && keeper.x <= 0.88);
    outcomes.push(outcome);
  }
  // Neither a formality nor a wall: between a third and three quarters go in.
  const rate = goals(outcomes) / outcomes.length;
  assert.ok(rate > 0.33 && rate < 0.75, String(rate));
  assert.equal(SHOTS, 5);
});

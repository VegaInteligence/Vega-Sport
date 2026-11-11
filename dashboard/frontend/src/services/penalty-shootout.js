/** Rules of the 404 page's penalty shoot-out, kept apart from its drawing. */
export const SHOTS = 5;
// Half the frame's thickness, in goal units (the goal is wider than tall).
const POST = 0.02,
  BAR = 0.04;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// Three uniform draws: close to a bell curve of mean 0 and deviation 1.
const spread = (random) => (random() + random() + random() - 1.5) * 2;

/**
 * Plays one penalty. Positions are in goal units: x from the left post (0)
 * to the right post (1), y from the ground (0) to the crossbar (1).
 *
 * The ball lands near the aim, further from it the closer the aim is to the
 * frame: corners beat the keeper more often and miss the goal more often.
 * The keeper commits to a side, and now and then reads the shot.
 */
export function takePenalty(aim, random = Math.random) {
  const x = clamp(aim.x, 0, 1),
    y = clamp(aim.y, 0, 1),
    side = Math.abs(x - 0.5) * 2;
  const ball = {
    x: x + spread(random) * (0.02 + 0.07 * side * side),
    y: Math.max(0, y + spread(random) * (0.03 + 0.09 * y * y)),
  };
  const keeper =
    random() < 0.2
      ? {
          x: clamp(ball.x + (random() - 0.5) * 0.4, 0.12, 0.88),
          y: clamp(ball.y + (random() - 0.5) * 0.3, 0.25, 0.62),
        }
      : {
          x: [0.16, 0.5, 0.84][Math.floor(random() * 3)],
          y: random() < 0.5 ? 0.3 : 0.58,
        };
  const outcome =
    ball.x < -POST || ball.x > 1 + POST
      ? "wide"
      : ball.y > 1 + BAR
        ? "over"
        : ball.x <= POST || ball.x >= 1 - POST
          ? "post"
          : ball.y >= 1 - BAR
            ? "bar"
            : Math.abs(ball.x - keeper.x) <= 0.15 &&
                Math.abs(ball.y - keeper.y) <= 0.3
              ? "saved"
              : "goal";
  return { ball, keeper, outcome };
}

export const goals = (outcomes) =>
  outcomes.filter((outcome) => outcome === "goal").length;

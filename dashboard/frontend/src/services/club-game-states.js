/**
 * What a club does with the score, read from each match's goal timeline: time spent
 * leading, reactions, leads lost, and the goals of each half. Kept in its own module so
 * it can be read without the page's components.
 */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const pointsOf = (diff) => (diff > 0 ? 3 : diff === 0 ? 1 : 0);

/** Goal timeline per match, kept only when it reproduces the final score. */
export function gameStates(rows, clubId) {
  const out = {
    matches: 0,
    // Goals of each half over the same matches, and the points the half-time scores would give.
    halves: {
      first: { gf: 0, ga: 0 },
      second: { gf: 0, ga: 0 },
      halfTimePoints: 0,
      points: 0,
    },
    scoredFirst: { matches: 0, points: 0, w: 0, d: 0, l: 0 },
    concededFirst: { matches: 0, points: 0, w: 0, d: 0, l: 0 },
    goalless: 0,
    pointsFromBehind: 0,
    pointsDropped: 0,
    minutes: { lead: 0, level: 0, behind: 0 },
    comebacks: [],
    collapses: [],
  };
  for (const row of rows) {
    const goals = (row.match.shots || [])
      .filter((s) => s.isGoal || s.isOwnGoal)
      .map((s) => ({
        minute: (num(s.minute) || 0) + (num(s.minuteAdded) || 0) / 100,
        mine: s.isOwnGoal ? s.teamId !== clubId : s.teamId === clubId,
        // The source's period when it gives one, else the minute (45+3 is still the first half).
        half:
          s.period === "first_half" || s.period === "second_half"
            ? s.period
            : s.period
              ? null
              : (num(s.minute) || 0) <= 45
                ? "first_half"
                : (num(s.minute) || 0) <= 90
                  ? "second_half"
                  : null,
      }))
      .sort((a, b) => a.minute - b.minute);
    if (
      goals.filter((g) => g.mine).length !== row.gf ||
      goals.filter((g) => !g.mine).length !== row.ga
    )
      continue;
    out.matches++;
    let pause = 0;
    for (const goal of goals) {
      const half = goal.half === "first_half" ? out.halves.first : goal.half === "second_half" ? out.halves.second : null;
      if (half) half[goal.mine ? "gf" : "ga"]++;
      if (goal.half === "first_half") pause += goal.mine ? 1 : -1;
    }
    out.halves.halfTimePoints += pointsOf(pause);
    out.halves.points += row.points;
    let diff = 0,
      last = 0,
      led = false,
      trailed = false;
    const end = Math.max(93, ...goals.map((g) => g.minute + 1));
    for (const goal of goals) {
      const span = goal.minute - last;
      out.minutes[diff > 0 ? "lead" : diff < 0 ? "behind" : "level"] += span;
      last = goal.minute;
      diff += goal.mine ? 1 : -1;
      if (diff > 0) led = true;
      if (diff < 0) trailed = true;
    }
    out.minutes[diff > 0 ? "lead" : diff < 0 ? "behind" : "level"] +=
      end - last;
    if (!goals.length) out.goalless++;
    else {
      const bucket = goals[0].mine ? out.scoredFirst : out.concededFirst;
      bucket.matches++;
      bucket.points += row.points;
      bucket[row.result === "V" ? "w" : row.result === "N" ? "d" : "l"]++;
    }
    if (trailed && row.points) {
      out.pointsFromBehind += row.points;
      out.comebacks.push(row);
    }
    if (led && row.points < 3) {
      out.pointsDropped += 3 - row.points;
      out.collapses.push(row);
    }
  }
  return out;
}

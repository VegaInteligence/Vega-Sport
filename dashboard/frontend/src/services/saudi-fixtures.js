export const SAUDI_PRO_LEAGUE = "l_0Lpz1f";

/** Group duplicate upcoming Saudi fixtures without deciding which source ID is right. */
export function reconcileSaudiFixtures(matches) {
  const groups = new Map(),
    result = [];
  for (const match of matches || []) {
    const home = match.home_team?.id,
      away = match.away_team?.id;
    if (
      match.status !== "not_started" ||
      !match.id ||
      !match.date ||
      !home ||
      !away
    ) {
      result.push(match);
      continue;
    }
    const key = [match.season, match.date, home, away].join("|");
    if (!groups.has(key)) {
      const group = [];
      groups.set(key, group);
      result.push(group);
    }
    const group = groups.get(key);
    if (!group.some((item) => item.id === match.id)) group.push(match);
  }
  return result.map((item) => {
    if (!Array.isArray(item)) return item;
    if (item.length === 1) return item[0];
    const sourceIds = item.map((match) => match.id).sort();
    const representative = item.find((match) => match.id === sourceIds[0]);
    const times = new Set(
      item.map((match) => match.time_utc || match.timeUtc || ""),
    );
    return {
      ...representative,
      ...(times.size > 1 ? { time_utc: null, timeUtc: null } : {}),
      fixtureIdentityUncertain: true,
      fixtureAlternatives: sourceIds,
    };
  });
}

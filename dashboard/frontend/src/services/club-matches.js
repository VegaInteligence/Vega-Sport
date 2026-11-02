function normalizedMatch(match) {
  if (match.home && match.away) return match;
  const home = match.home_team || {};
  const away = match.away_team || {};
  return {
    ...match,
    leagueId: match.league?.id || match.leagueId,
    league:
      typeof match.league === "string" ? match.league : match.league?.name,
    home: {
      ...home,
      imageUrl: home.image_url || home.imageUrl,
      score: match.score_home,
    },
    away: {
      ...away,
      imageUrl: away.image_url || away.imageUrl,
      score: match.score_away,
    },
    timeUtc: match.time_utc || match.timeUtc,
  };
}

function timeOf(match) {
  const value = match.timeUtc || match.time_utc || match.date;
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
}

function belongsTo(match, clubId) {
  return match.home?.id === clubId || match.away?.id === clubId;
}

function isFinished(match) {
  return (
    match.status === "finished" || (!match.status && match.finished === true)
  );
}

/** Use all recorded results, including fixtures without a detailed match file. */
export function clubMatchHistory(matches, fixtures, clubId) {
  if (!clubId) return [];
  const byId = new Map();
  for (const item of matches || []) {
    const match = normalizedMatch(item);
    if (match.id && belongsTo(match, clubId)) byId.set(match.id, match);
  }
  for (const item of fixtures || []) {
    const match = normalizedMatch(item);
    if (!match.id || !belongsTo(match, clubId) || !isFinished(match)) continue;
    const previous = byId.get(match.id);
    if (!previous) {
      byId.set(match.id, match);
    } else {
      // Preserve detailed data while taking any available score from the
      // season's fixture list, which is refreshed with the latest results.
      byId.set(match.id, {
        ...previous,
        home: {
          ...previous.home,
          score: Number.isFinite(match.home?.score)
            ? match.home.score
            : previous.home?.score,
        },
        away: {
          ...previous.away,
          score: Number.isFinite(match.away?.score)
            ? match.away.score
            : previous.away?.score,
        },
      });
    }
  }
  return [...byId.values()].sort(
    (a, b) =>
      (timeOf(b) ?? -Infinity) - (timeOf(a) ?? -Infinity) ||
      String(b.id).localeCompare(String(a.id)),
  );
}

/** Return up to five completed results, oldest first and most recent on the right. */
export function clubForm(matches, clubId, limit = 5) {
  return (matches || [])
    .filter(
      (match) =>
        belongsTo(match, clubId) && isFinished(match) && timeOf(match) !== null,
    )
    .sort(
      (a, b) =>
        timeOf(b) - timeOf(a) || String(b.id).localeCompare(String(a.id)),
    )
    .slice(0, limit)
    .map((match) => {
      const home = match.home?.score;
      const away = match.away?.score;
      let result = "?";
      if (
        Number.isInteger(home) &&
        home >= 0 &&
        Number.isInteger(away) &&
        away >= 0
      ) {
        const own = match.home.id === clubId ? home : away;
        const opponent = match.home.id === clubId ? away : home;
        result = own > opponent ? "V" : own < opponent ? "D" : "N";
      }
      return { match, result };
    })
    .reverse();
}

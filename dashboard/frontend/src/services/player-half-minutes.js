/** Recover a duration only from an unambiguous pair of regulation periods. */
export function playerHalfMinutes(data, matchId, playerId, teamId) {
  if (data?.match_id !== matchId || !Array.isArray(data.players)) return null;
  const players = data.players.filter((row) => row?.player?.id === playerId);
  if (players.length !== 1 || players[0].team_id !== teamId) return null;
  const periods = players[0].periods;
  if (!Array.isArray(periods) || periods.length !== 2) return null;
  const values = new Map();
  for (const period of periods) {
    if (
      !["FirstHalf", "SecondHalf"].includes(period?.period) ||
      values.has(period.period) ||
      !Array.isArray(period.stats)
    )
      return null;
    const metrics = period.stats
      .flatMap((group) => Object.values(group?.stats || {}))
      .filter((metric) => metric?.key === "minutes_played");
    if (metrics.length !== 1) return null;
    const minutes = metrics[0]?.stat?.value;
    if (
      typeof minutes !== "number" ||
      !Number.isFinite(minutes) ||
      minutes < 0 ||
      minutes > 45
    )
      return null;
    values.set(period.period, minutes);
  }
  if (!values.has("FirstHalf") || !values.has("SecondHalf")) return null;
  return values.get("FirstHalf") + values.get("SecondHalf");
}

const AT_ONCE = 3;

/**
 * Reuse the match-family cache, three reads at a time: one at a time, each match
 * waited for the one before it, and the playing time for all of them.
 */
export async function loadPlayerHalfMinutes(
  client,
  matches,
  playerId,
  teamId,
  signal,
) {
  const unique = [],
    seen = new Set();
  for (const match of matches || []) {
    if (!match?.id || seen.has(match.id)) continue;
    seen.add(match.id);
    unique.push(match);
  }
  const minutes = new Array(unique.length).fill(null);
  let next = 0;
  const read = async () => {
    while (next < unique.length) {
      signal?.throwIfAborted();
      const index = next++,
        match = unique[index];
      try {
        const response = await client.ensureEndpoint(
          match,
          "players/halves",
          false,
          { signal },
        );
        signal?.throwIfAborted();
        minutes[index] = playerHalfMinutes(
          response?.data,
          match.id,
          playerId,
          teamId,
        );
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, unique.length) }, read),
  );
  // In the matches' order, whatever order the reads ended in.
  const result = new Map();
  unique.forEach((match, index) => {
    if (minutes[index] != null) result.set(match.id, minutes[index]);
  });
  return result;
}

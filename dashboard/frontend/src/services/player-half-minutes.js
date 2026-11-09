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

/** Reuse the match-family cache, with bounded sequential reads. */
export async function loadPlayerHalfMinutes(
  client,
  matches,
  playerId,
  teamId,
  signal,
) {
  const result = new Map();
  const seen = new Set();
  for (const match of matches || []) {
    signal?.throwIfAborted();
    if (!match?.id || seen.has(match.id)) continue;
    seen.add(match.id);
    try {
      const response = await client.ensureEndpoint(
        match,
        "players/halves",
        false,
        { signal },
      );
      signal?.throwIfAborted();
      const minutes = playerHalfMinutes(
        response?.data,
        match.id,
        playerId,
        teamId,
      );
      if (minutes != null) result.set(match.id, minutes);
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
    }
  }
  return result;
}

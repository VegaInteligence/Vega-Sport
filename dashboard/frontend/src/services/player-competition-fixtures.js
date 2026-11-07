import { actorReadParams } from "./actor-reads.js";
import {
  mergeActorPages,
  readCompactPages,
  supportsCompactRead,
} from "./compact-reads.js";

/** Fetch exact competition fixtures for teams actually observed in player entries. */
export async function loadPlayerCompetitionFixtures(
  manifest,
  entries,
  playerId,
  competitionId,
  { client, signal, fetcher = fetch } = {},
) {
  if (!/^l_[A-Za-z0-9]{6}$/.test(competitionId || "")) return [];
  if (!supportsCompactRead(manifest, "club"))
    throw new Error("Rencontres d’équipe indisponibles.");
  const scopes = new Map();
  for (const entry of entries || [])
    for (const row of entry.data?.appearances || []) {
      if (
        row.playerId !== playerId ||
        row.leagueId !== competitionId ||
        !row.teamId ||
        !entry.season
      )
        continue;
      scopes.set(JSON.stringify([entry.season, row.teamId]), {
        season: entry.season,
        teamId: row.teamId,
      });
    }
  const candidates = new Map();
  for (const { season, teamId } of scopes.values()) {
    signal?.throwIfAborted();
    const data = mergeActorPages(
      await readCompactPages(
        "club",
        actorReadParams(manifest, "club", {
          id: teamId,
          season,
          leagues: competitionId,
          include: "appearances",
        }),
        { signal, fetcher },
      ),
      manifest,
      season,
    );
    const appearances = new Map(
      (data.appearances || [])
        .filter(
          (row) =>
            row.playerId === playerId &&
            row.teamId === teamId &&
            row.leagueId === competitionId,
        )
        .map((row) => [row.matchId, row]),
    );
    const matches = new Map(
      [...(data.fixtures || []), ...(data.matches || [])].map((match) => [
        match.id,
        match,
      ]),
    );
    for (const match of matches.values()) {
      const league = match.leagueId || match.league?.id;
      if (league && league !== competitionId) continue;
      const key = JSON.stringify([season, teamId, match.id]);
      candidates.set(key, {
        match,
        season,
        teamId,
        appearance: appearances.get(match.id) || null,
        lineup: null,
      });
    }
  }
  const rows = [...candidates.values()];
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      signal?.throwIfAborted();
      const row = rows[cursor++];
      if (
        row.appearance ||
        row.match.status !== "finished" ||
        !client ||
        !/^m_[A-Za-z0-9]{6}$/.test(row.match.id)
      )
        continue;
      try {
        const result = await client.ensureEndpoint(
          row.match,
          "lineups",
          false,
          { signal },
        );
        signal?.throwIfAborted();
        const data = result?.data;
        const side =
          data?.home_team?.id === row.teamId
            ? data.home
            : data?.away_team?.id === row.teamId
              ? data.away
              : null;
        if (
          side &&
          (Array.isArray(side.starters) || Array.isArray(side.subs))
        ) {
          const valid = (list) =>
            (Array.isArray(list) ? list : [])
              .map((player) => player?.player_id)
              .filter(
                (id) => typeof id === "string" && /^p_[A-Za-z0-9]{6}$/.test(id),
              );
          const starters = valid(side.starters),
            subs = valid(side.subs);
          row.lineup = {
            confirmed: side.confirmed === true,
            complete:
              side.confirmed === true &&
              Array.isArray(side.starters) &&
              Array.isArray(side.subs) &&
              starters.length === 11 &&
              new Set(starters).size === 11 &&
              starters.length === side.starters.length &&
              subs.length === side.subs.length &&
              new Set([...starters, ...subs]).size ===
                starters.length + subs.length,
            starters,
            subs,
          };
        }
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, rows.length) }, worker));
  return rows;
}

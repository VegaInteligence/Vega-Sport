/* The match page's previous / next and its round picker: the competition season's fixtures,
 * grouped by round in kick-off order. One read of the season's fixtures (paged by 50); the
 * published round names only when a fixture row does not carry its own. */
import { completeFixtures } from "./fixture-pages.js";
import { json } from "./resources.js";
import { matchdayGroups } from "./competition-matchdays.js";

const side = (team, score) => ({
  id: team?.id,
  name: team?.name || "",
  imageUrl: team?.imageUrl ?? team?.image_url,
  score: score ?? team?.score ?? null,
});

/** A fixture row of the API (or an already normalised match) in one shape. */
export function navMatch(row) {
  return {
    id: row.id,
    date: row.date,
    timeUtc: row.time_utc || row.timeUtc || null,
    status:
      row.status || (row.finished === false ? "not_started" : "finished"),
    round:
      row.round_name != null && String(row.round_name).trim()
        ? { name: String(row.round_name).trim(), playoff: row.has_playoff === true }
        : null,
    home: side(row.home_team || row.home, row.score_home),
    away: side(row.away_team || row.away, row.score_away),
  };
}

/** The season's fixtures with their rounds, or an empty list when there is none to read. */
export async function loadMatchNav(f, { league, season }, { signal } = {}) {
  const cached = f.client.fixtures?.get(`${league}:${season}`);
  const rows = Array.isArray(cached?.matches)
    ? cached.matches
    : await completeFixtures({ league, season }, { signal });
  const matches = rows.filter((row) => row?.id).map(navMatch);
  const rounds = {
    ...(cached?.rounds || {}),
    ...Object.fromEntries(
      matches.filter((m) => m.round).map((m) => [m.id, m.round]),
    ),
  };
  if (matches.some((m) => !rounds[m.id])) {
    const published = await json(
      `/api/matchdays?competition=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`,
      { signal },
    ).catch((error) => {
      if (error.name === "AbortError") throw error;
      return { matches: {} };
    });
    for (const [id, round] of Object.entries(published.matches || {}))
      rounds[id] ||= round;
  }
  return { matches, rounds };
}

/** Rounds in order, each with its matches by kick-off; unnamed rounds left out. */
export function navRounds(value) {
  if (!value?.matches?.length) return [];
  return matchdayGroups(value.matches, value.rounds).filter(
    (group) => group.key !== "unknown",
  );
}

/** The current match's round and its neighbours across the season's order. */
export function navPosition(groups, id) {
  const order = groups.flatMap((group) =>
    group.matches.map((match) => ({ match, group })),
  );
  const at = order.findIndex((item) => item.match.id === id);
  if (at < 0 || order.length < 2) return null;
  return {
    group: order[at].group,
    previous: order[at - 1]?.match || null,
    next: order[at + 1]?.match || null,
  };
}

const fold = (text) =>
  String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** The season's matches of a club whose name holds the query (accents and case ignored). */
export function navSearch(groups, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return groups.flatMap((group) =>
    group.matches
      .filter((match) => {
        const names = fold(`${match.home.name} ${match.away.name}`);
        return words.every((word) => names.includes(word));
      })
      .map((match) => ({ match, group })),
  );
}

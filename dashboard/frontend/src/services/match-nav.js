/* The match page's previous / next and its round picker: the competition season's fixtures,
 * grouped by round in kick-off order. One read of the season's fixtures (/api/fixtures/season, shared with the
 * « Classement »; its pages by 50 when the API does not serve it). A row of the native API carries its round
 * (`round_name`, null without one): /api/matchdays, built from the same fixtures, names no round it lacks, and is not
 * asked. A row without the field (the football client's snapshot, an older server's pages) takes its round from
 * /api/matchdays as before (FAILURE_MODES_OPTIMISATIONS.md GH129-e, GH129-n). */
import { completeFixtures } from "./fixture-pages.js";
import { json } from "./resources.js";
import { matchdayGroups, roundLabel } from "./competition-matchdays.js";

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
    status: row.status || (row.finished === false ? "not_started" : "finished"),
    round:
      row.round_name != null && String(row.round_name).trim()
        ? {
            name: String(row.round_name).trim(),
            playoff: row.has_playoff === true,
          }
        : null,
    home: side(row.home_team || row.home, row.score_home),
    away: side(row.away_team || row.away, row.score_away),
  };
}

/** The season's fixtures with their rounds, or an empty list when there is none to read. */
export async function loadMatchNav(f, { league, season }, { signal } = {}) {
  const cached = f.client.fixtures?.get(`${league}:${season}`);
  const rows = (
    Array.isArray(cached?.matches)
      ? cached.matches
      : await completeFixtures(
          { league, season },
          { signal, manifest: f.manifest },
        )
  ).filter((row) => row?.id);
  const matches = rows.map(navMatch);
  const rounds = {
    ...(cached?.rounds || {}),
    ...Object.fromEntries(
      matches.filter((m) => m.round).map((m) => [m.id, m.round]),
    ),
  };
  if (
    rows.some((row) => !rounds[row.id] && !Object.hasOwn(row, "round_name"))
  ) {
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

const sideKey = (side) => side?.id || side?.name || null;
const sides = (match) => [sideKey(match.home), sideKey(match.away)];
const kickoff = (match) => {
  const value = Date.parse(match.timeUtc || match.date || "");
  return Number.isFinite(value) ? value : Infinity;
};
const byKickoff = (a, b) => kickoff(a) - kickoff(b);

/**
 * A league's rounds to come, read from the dates (FAILURE_MODES § 73). The provider names the round of played matches
 * only: without this the picker stopped at the last round played (11 of Ligue 1's 34). Only for a league (every named
 * round a number, no play-off), whose named rounds hold `size` matches between `2 × size` clubs. A named round short of
 * matches (under way, or one postponed) takes, round after round, a match to come of two clubs it lacks when that match
 * is the next of both. The matches left, by kick-off, then make rounds of `size`, each with every club once, numbered
 * after the last named one; at the first that does not, the rest stays unnamed (out of the picker, as before).
 */
export function inferRounds(groups) {
  const unknown = groups.find((group) => group.key === "unknown");
  const named = groups.filter((group) => group.key !== "unknown");
  if (
    !unknown ||
    !named.length ||
    !named.every((g) => !g.playoff && /^\d+$/.test(g.name))
  )
    return groups;
  const size = Math.max(...named.map((group) => group.matches.length));
  const clubs = new Set(named.flatMap((group) => group.matches.flatMap(sides)));
  if (size < 2 || clubs.has(null) || clubs.size !== 2 * size) return groups;
  let rest = [...unknown.matches].sort(byKickoff);
  const out = named.map((group) => ({ ...group, matches: [...group.matches] }));
  // The rounds short of matches take the next match of two clubs they lack, as long as one does.
  const fill = () => {
    for (const group of out) {
      if (group.matches.length >= size) continue;
      const seen = new Set(group.matches.flatMap(sides));
      for (let added = true; added && group.matches.length < size;) {
        added = false;
        const next = new Map();
        for (const match of rest)
          for (const club of sides(match))
            if (!next.has(club)) next.set(club, match);
        for (const club of clubs) {
          const match = next.get(club);
          if (seen.has(club) || !match) continue;
          const [home, away] = sides(match);
          if (
            seen.has(home) ||
            seen.has(away) ||
            next.get(home) !== match ||
            next.get(away) !== match
          )
            continue;
          group.matches.push(match);
          group.matches.sort(byKickoff);
          seen.add(home);
          seen.add(away);
          rest = rest.filter((m) => m !== match);
          added = true;
          break;
        }
      }
    }
  };
  let number = Math.max(...out.map((group) => Number(group.name)));
  for (fill(); rest.length >= size && number < 2 * (clubs.size - 1); fill()) {
    const chunk = rest.slice(0, size);
    const seen = new Set(chunk.flatMap(sides));
    if (seen.size !== clubs.size || [...seen].some((club) => !clubs.has(club)))
      break;
    number += 1;
    const name = String(number);
    out.push({
      key: `regular:${name}`,
      name,
      playoff: false,
      label: roundLabel(name),
      inferred: true,
      matches: chunk,
      firstTime: kickoff(chunk[0]),
    });
    rest = rest.slice(size);
  }
  return rest.length ? [...out, { ...unknown, matches: rest }] : out;
}

const midnight = (m) => /T00:00(:00(\.0+)?)?Z$/.test(m.timeUtc || "");
/** The provider's matches whose time is not set yet carry midnight UTC (« 02:00 » in Paris): a midnight kick-off shared
 * by five matches or more is a date without its time, shown « à venir » (§ 73). One real kick-off at midnight UTC (an
 * evening match in the Americas) keeps its time. */
export function withoutUnsetTimes(matches) {
  const count = new Map();
  for (const m of matches)
    if (midnight(m)) count.set(m.timeUtc, (count.get(m.timeUtc) || 0) + 1);
  return matches.map((m) =>
    midnight(m) && count.get(m.timeUtc) >= 5 ? { ...m, timeUtc: null } : m,
  );
}

/** Rounds in order, each with its matches by kick-off (times not set yet left out); a league's rounds to come read from
 * the dates (inferRounds); unnamed rounds left out. */
export function navRounds(value) {
  if (!value?.matches?.length) return [];
  return inferRounds(
    matchdayGroups(withoutUnsetTimes(value.matches), value.rounds),
  ).filter((group) => group.key !== "unknown");
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

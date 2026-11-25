function instant(match) {
  const value = match.time_utc || match.timeUtc || match.date;
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function roundLabel(name, playoff = false) {
  const value = String(name).trim();
  const numeric = /^\d+$/.test(value);
  const known = {
    "1/16": "Seizièmes de finale",
    "1/8": "Huitièmes de finale",
    "1/4": "Quarts de finale",
    "1/2": "Demi-finales",
    final: "Finale",
    bronze: "Match pour la 3ᵉ place",
  };
  const stage = /^League Stage - Round (\d+)$/i.exec(value);
  const ordinal = (number) =>
    Number(number) === 1 ? "1ʳᵉ" : `${Number(number)}ᵉ`;
  const label = numeric
    ? `${ordinal(value)} journée`
    : known[value.toLowerCase()] ||
      (stage ? `Phase de ligue · ${ordinal(stage[1])} journée` : value);
  return playoff ? `Play-offs · ${label}` : label;
}

export function matchdayGroups(matches, rounds) {
  const grouped = new Map();
  for (const match of matches || []) {
    const round = rounds?.[match.id];
    const raw = round?.name != null ? String(round.name).trim() : "";
    // The base names a league phase's round « 3 » or « League Stage - Round 3 »: one round,
    // named by its number, labelled as the league phase when one of its rows says so (§ 64).
    const stage = /^League Stage - Round (\d+)$/i.exec(raw);
    const name = stage ? String(Number(stage[1])) : raw;
    const key = name
      ? `${round.playoff ? "playoff" : "regular"}:${name}`
      : "unknown";
    if (!grouped.has(key))
      grouped.set(key, {
        key,
        name,
        playoff: Boolean(round?.playoff),
        label: name
          ? roundLabel(raw, round.playoff)
          : "Journée non renseignée",
        matches: [],
      });
    const group = grouped.get(key);
    if (stage) group.label = roundLabel(raw, round.playoff);
    group.matches.push(match);
  }
  const groups = [...grouped.values()];
  for (const group of groups) {
    group.matches.sort(
      (a, b) => (instant(a) ?? Infinity) - (instant(b) ?? Infinity),
    );
    group.firstTime =
      group.matches.map(instant).find((time) => time != null) ?? Infinity;
  }
  groups.sort((a, b) => {
    if (a.key === "unknown" || b.key === "unknown")
      return a.key === "unknown" ? 1 : -1;
    if (a.playoff === b.playoff && /^\d+$/.test(a.name) && /^\d+$/.test(b.name))
      return Number(a.name) - Number(b.name);
    return a.firstTime - b.firstTime || a.label.localeCompare(b.label, "fr");
  });
  return groups;
}

export function defaultMatchday(
  groups,
  preferred = "finished",
  now = Date.now(),
) {
  if (preferred === "not_started") {
    let next = null;
    let nearest = Infinity;
    for (const group of groups) {
      for (const match of group.matches) {
        const time = instant(match);
        if (
          (match.status === "not_started" || match.finished === false) &&
          time != null &&
          time >= now &&
          time < nearest
        ) {
          nearest = time;
          next = group.key;
        }
      }
    }
    if (next) return next;
  }
  const known = groups.filter((group) => group.key !== "unknown");
  let selected = null;
  let latest = -Infinity;
  for (const group of known) {
    for (const match of group.matches) {
      if (
        (match.status === "finished" || match.finished === true) &&
        instant(match) != null &&
        instant(match) > latest
      ) {
        latest = instant(match);
        selected = group.key;
      }
    }
  }
  return selected || known[0]?.key || groups[0]?.key || null;
}

export function nearestUntried(matches, tried, now = Date.now(), limit = 24) {
  return (matches || [])
    .filter((match) => match.id && !tried.has(match.id))
    .map((match, order) => ({
      match,
      order,
      distance: Math.abs((instant(match) ?? Infinity) - now),
    }))
    .sort((a, b) => a.distance - b.distance || a.order - b.order)
    .slice(0, limit)
    .map(({ match }) => match);
}

const isPlayed = (match) => match.status === "finished" || match.finished === true;
const teamKey = (team) => team?.id || team?.name || null;
/**
 * The API names the round of played matches only. When no named matchday is still to
 * play, the next one is read from the earliest unnamed fixtures to come: each club once, at
 * most as many matches as a named matchday holds. It becomes « Prochaine journée », just
 * before the unnamed rest (« Journée non renseignée »), which stays last.
 */
export function withNextMatchday(groups, now = Date.now()) {
  const unknown = groups.find((group) => group.key === "unknown");
  const named = groups.filter((group) => group.key !== "unknown");
  const size = Math.max(0, ...named.filter((group) => !group.playoff).map((group) => group.matches.length));
  if (!unknown || size < 2) return groups;
  const namedToCome = named.some((group) =>
    group.matches.some((match) => !isPlayed(match) && (instant(match) ?? -Infinity) >= now),
  );
  if (namedToCome) return groups;
  const taken = [], teams = new Set();
  for (const match of unknown.matches) {
    const time = instant(match);
    if (isPlayed(match) || time == null || time < now - 12 * 3600000) continue;
    const sides = [teamKey(match.home_team || match.home), teamKey(match.away_team || match.away)];
    if (sides.some((side) => !side || teams.has(side))) break;
    sides.forEach((side) => teams.add(side));
    taken.push(match);
    if (taken.length >= size) break;
  }
  if (!taken.length) return groups;
  const rest = unknown.matches.filter((match) => !taken.includes(match));
  const next = {
    key: "next",
    name: "",
    playoff: false,
    label: "Prochaine journée",
    matches: taken,
    firstTime: instant(taken[0]) ?? Infinity,
  };
  return [...named, next, ...(rest.length ? [{ ...unknown, matches: rest }] : [])];
}

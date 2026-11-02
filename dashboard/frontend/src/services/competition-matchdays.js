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
    const name = round?.name != null ? String(round.name).trim() : "";
    const key = name
      ? `${round.playoff ? "playoff" : "regular"}:${name}`
      : "unknown";
    if (!grouped.has(key))
      grouped.set(key, {
        key,
        name,
        playoff: Boolean(round?.playoff),
        label: name
          ? roundLabel(name, round.playoff)
          : "Journée non renseignée",
        matches: [],
      });
    grouped.get(key).matches.push(match);
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

// Standings and fixture providers use different names for the same teams.
// Resolve only against teams in this competition, and leave ambiguous names
// unresolved rather than linking to a different club.
const CLUB_WORDS = new Set([
  "a",
  "ac",
  "afc",
  "as",
  "athletic",
  "b",
  "ca",
  "cd",
  "cf",
  "club",
  "da",
  "de",
  "del",
  "des",
  "di",
  "do",
  "ec",
  "fc",
  "fk",
  "football",
  "fsv",
  "futbol",
  "if",
  "ifk",
  "ii",
  "iii",
  "jk",
  "jong",
  "k",
  "kv",
  "la",
  "le",
  "losc",
  "ogc",
  "rc",
  "rcd",
  "reserve",
  "reserves",
  "sc",
  "sd",
  "sk",
  "sco",
  "sportif",
  "ssc",
  "stade",
  "sv",
  "tsg",
  "ud",
  "vfb",
  "vfl",
  "youth",
  "futures",
]);
const WORD_ALIASES = {
  brestois: "brest",
  munich: "munchen",
  praha: "prague",
  rennais: "rennes",
  saint: "st",
};
const NAME_ALIASES = {
  "inter milan": "inter",
  "athletic bilbao": "athletic",
  "rc deportivo": "deportivo a coruna",
  "rcd espanyol de barcelona": "espanyol",
  "stade lavallois mfc": "laval",
  "new york red bulls": "red bull new york",
  "khor fakkan ssc": "khorfakkan",
  "baniyas club": "bani yas",
  "ham kam": "hamarkameratene",
  amedspor: "amed sportif",
};

function words(value) {
  const text = String(value || "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[ıłø]/g, (c) => ({ ı: "i", ł: "l", ø: "o" })[c])
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return (NAME_ALIASES[text] || text)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => WORD_ALIASES[word] || word);
}

function nameKey(value) {
  return words(value).join("");
}

function meaningfulWords(value) {
  const all = words(value);
  const significant = all.filter(
    (word) =>
      !CLUB_WORDS.has(word) && !/^\d+$/.test(word) && !/^u\d{2}$/.test(word),
  );
  return significant.length ? significant : all;
}

function key(value) {
  return [...meaningfulWords(value)].sort().join(" ");
}

function variant(value) {
  const text = String(value || "").toLowerCase();
  const women =
    /\b(?:women|womens|ladies|feminine|femenino|femenina|damen|femmes)\b|\(w\)/i.test(
      text,
    );
  const reserve =
    /(?:^|[\s.(-])(?:u\s?-?\s?\d{2}|under\s?-?\s?\d{2}|ii|iii|b|youth|jong|reserve|reserves|futures)(?:$|[\s.)-])/i.test(
      text,
    );
  return `${women ? "women" : "open"}:${reserve ? "reserve" : "senior"}`;
}

function add(index, name, id) {
  if (!name) return;
  if (!index.has(name)) index.set(name, new Set());
  index.get(name).add(id);
}

/** Return one matching fixture team per standing row, or null when uncertain. */
export function matchStandingsClubs(rows, matches) {
  const teams = new Map();
  for (const match of matches || []) {
    for (const team of [match.home_team, match.away_team]) {
      if (!team?.id || !team.name) continue;
      if (!teams.has(team.id)) teams.set(team.id, { team, names: new Set() });
      teams.get(team.id).names.add(team.name);
    }
  }
  const exact = new Map(),
    simplified = new Map(),
    tokens = new Map(),
    rowTokens = new Map();
  for (const [id, item] of teams) {
    for (const name of item.names) {
      const prefix = variant(name) + ":";
      add(exact, prefix + nameKey(name), id);
      add(simplified, prefix + key(name), id);
      for (const token of meaningfulWords(name))
        if (token.length >= 4) add(tokens, prefix + token, id);
    }
  }
  for (const row of rows || []) {
    const prefix = variant(row.name) + ":";
    for (const token of meaningfulWords(row.name))
      if (token.length >= 4) add(rowTokens, prefix + token, nameKey(row.name));
  }
  const unique = (set) => (set?.size === 1 ? [...set][0] : null);
  const resolutions = (rows || []).map((row) => {
    const prefix = variant(row.name) + ":";
    const direct = unique(exact.get(prefix + nameKey(row.name)));
    if (direct) return { id: direct, score: 3 };
    const clean = unique(simplified.get(prefix + key(row.name)));
    const significant = meaningfulWords(row.name);
    if (
      clean &&
      !(
        significant.length === 1 &&
        tokens.get(prefix + significant[0])?.size > 1
      )
    )
      return { id: clean, score: 2 };
    const candidates = new Set();
    for (const token of meaningfulWords(row.name)) {
      const id =
        token.length >= 4 && unique(rowTokens.get(prefix + token))
          ? unique(tokens.get(prefix + token))
          : null;
      if (id) {
        const rowWords = new Set(significant);
        const comparable = [...teams.get(id).names].some((name) => {
          const teamWords = new Set(meaningfulWords(name));
          return (
            [...rowWords].every((word) => teamWords.has(word)) ||
            [...teamWords].every((word) => rowWords.has(word))
          );
        });
        if (comparable) candidates.add(id);
      }
    }
    const id = unique(candidates);
    return id ? { id, score: 1 } : null;
  });
  // Prefer an exact match over a weaker claim; ties between names are ambiguous.
  const claims = new Map();
  resolutions.forEach((result, index) => {
    if (!result) return;
    if (!claims.has(result.id)) claims.set(result.id, new Map());
    const names = claims.get(result.id),
      name = nameKey(rows[index].name);
    names.set(name, Math.max(names.get(name) || 0, result.score));
  });
  return resolutions.map((result) => {
    if (!result) return null;
    const scores = [...claims.get(result.id).values()];
    const best = Math.max(...scores);
    return result.score === best &&
      scores.filter((score) => score === best).length === 1
      ? teams.get(result.id).team
      : null;
  });
}

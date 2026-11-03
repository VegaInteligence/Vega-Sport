import { normalizeText } from "../model.js";
import { positionOf } from "./player-profile.js";
import { competitionCountryLabel } from "./competition-selector.js";
import { mergeCupCatalog } from "./cup-catalog.js";
import {
  EUROPE_FOCUS_IDS,
  inEuropeFocus,
} from "../../../shared/competition-scope.js";

/**
 * Navbar search: one compact index per season, built on first use from the
 * whole season, whatever competitions the pages are filtered on. Records
 * outside the Top 7 + UEFA scope are flagged so links can widen the scope.
 */
const INDEXES = new WeakMap();
const LIMITS = { players: 6, clubs: 4, competitions: 3 };
const CATEGORIES = Object.keys(LIMITS);
const EMPTY_WORDS = [];
const searchText = (value) => normalizeText(value).replace(/[’‘]/g, "'").trim();

/** Use the same cup catalogue as the competitions page, once per identity. */
export function globalCompetitionCatalog(
  native = [],
  supplemental,
  workerNative,
) {
  const seen = new Set();
  return mergeCupCatalog(native, supplemental, workerNative).filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function searchedEdition(item, query) {
  if (item?.kind !== "competitions") return "";
  const year = /(?:^|\D)((?:19|20)\d{2})(?!\d)/.exec(String(query || ""))?.[1];
  return year
    ? (item.seasons || []).find(
        (season) => String(season).slice(0, 4) === year,
      ) || ""
    : "";
}

function entry(kind, id, name, extra) {
  const key = searchText(name),
    words = key.split(/[\s\-'’.]+/).filter(Boolean),
    aliases = extra.aliases || EMPTY_WORDS,
    aliasWords = aliases.length
      ? aliases.flatMap((name) => name.split(/[\s\-'’.]+/).filter(Boolean))
      : EMPTY_WORDS;
  return {
    kind,
    id,
    name,
    key,
    words,
    aliases,
    aliasWords,
    // "psg", "fcb": initials of multi-word club and competition names.
    initials:
      kind !== "players" && words.length > 1
        ? words.map((word) => word[0]).join("")
        : "",
    ...extra,
  };
}

export function buildSearchIndex(data, competitions = []) {
  if (!data) return null;
  const cached = INDEXES.get(data);
  if (cached?.competitions === competitions) return cached.index;
  const players = new Map();
  for (const row of data.appearances || []) {
    if (!row.playerId || !row.name) continue;
    let player = players.get(row.playerId);
    if (!player) {
      player = {
        id: row.playerId,
        name: row.name,
        imageUrl: row.imageUrl,
        team: row.team,
        teamId: row.teamId,
        league: row.league,
        date: row.date || "",
        minutes: 0,
        matches: 0,
        position: positionOf(row)?.label || null,
        europe: false,
      };
      players.set(row.playerId, player);
    }
    if (EUROPE_FOCUS_IDS.has(row.leagueId)) player.europe = true;
    if (row.minutes > 0) {
      player.minutes += row.minutes;
      player.matches++;
    }
    // The latest appearance names the player's current club.
    if ((row.date || "") >= player.date) {
      player.date = row.date || "";
      player.team = row.team || player.team;
      player.teamId = row.teamId || player.teamId;
      player.league = row.league || player.league;
      player.imageUrl = row.imageUrl || player.imageUrl;
      player.position = positionOf(row)?.label || player.position;
    }
  }
  const clubs = new Map();
  for (const match of data.matches || [])
    for (const side of [match.home, match.away]) {
      if (!side?.id || !side.name) continue;
      const club = clubs.get(side.id) || {
        id: side.id,
        name: side.name,
        imageUrl: side.imageUrl,
        leagues: new Map(),
        matches: 0,
        europe: false,
      };
      club.matches++;
      if (EUROPE_FOCUS_IDS.has(match.leagueId)) club.europe = true;
      club.imageUrl ||= side.imageUrl;
      if (match.league)
        club.leagues.set(
          match.league,
          (club.leagues.get(match.league) || 0) + 1,
        );
      clubs.set(side.id, club);
    }
  const index = {
    players: [...players.values()].map((p) =>
      entry("players", p.id, p.name, {
        imageUrl: p.imageUrl,
        meta: [p.position, p.team].filter(Boolean).join(" · ") || "Joueur",
        context: normalizeText(p.team || ""),
        weight: p.minutes,
        outside: !p.europe,
      }),
    ),
    clubs: [...clubs.values()].map((c) =>
      entry("clubs", c.id, c.name, {
        imageUrl: c.imageUrl,
        meta:
          [...c.leagues].sort((a, b) => b[1] - a[1])[0]?.[0] ||
          `${c.matches} matchs`,
        context: "",
        weight: c.matches,
        outside: !c.europe,
      }),
    ),
    competitions: competitions.map((c) =>
      entry("competitions", c.id, c.name, {
        imageUrl: c.imageUrl,
        meta: competitionCountryLabel(c),
        aliases: (c.aliases || []).map(searchText).filter(Boolean),
        seasons: c.seasons || [],
        context: searchText(
          [competitionCountryLabel(c), ...(c.seasons || [])].join(" "),
        ),
        weight: 0,
        outside: !inEuropeFocus(c),
      }),
    ),
  };
  INDEXES.set(data, { competitions, index });
  return index;
}

/** Lower is better; null when the record does not match every search word. */
function score(item, needle, tokens) {
  if (item.key === needle || item.aliases.includes(needle)) return 0;
  if (
    item.key.startsWith(needle) ||
    item.aliases.some((name) => name.startsWith(needle)) ||
    item.initials === needle
  )
    return 1;
  // Prefix of the initials too, so that narrowing "ps" → "psg" keeps PSG.
  if (
    item.words.some((word) => word.startsWith(needle)) ||
    item.aliasWords.some((word) => word.startsWith(needle)) ||
    item.initials.startsWith(needle)
  )
    return 2;
  if (
    item.key.includes(needle) ||
    item.aliases.some((name) => name.includes(needle))
  )
    return 3;
  // "mbappe real": every word must appear in the name or its context.
  if (
    tokens.length > 1 &&
    tokens.every(
      (token) =>
        item.words.some((word) => word.startsWith(token)) ||
        item.aliasWords.some((word) => word.startsWith(token)) ||
        item.context.includes(token),
    )
  )
    return 4;
  return null;
}

const previous = { index: null, needle: "", tokens: 0, candidates: null };

export function searchIndex(index, query) {
  const needle = searchText(query)
    .replace(/([a-z])((?:19|20)\d{2})\b/g, "$1 $2")
    .replace(/\s+/g, " ");
  const empty = {
    needle,
    players: [],
    clubs: [],
    competitions: [],
    total: 0,
    order: CATEGORIES,
  };
  if (!index || needle.length < 2) return empty;
  const tokens = needle.split(/[\s\-'’.]+/).filter(Boolean);
  // Typing one more letter of the same word only narrows the previous matches.
  const narrowing =
    previous.index === index &&
    previous.needle &&
    previous.tokens === tokens.length &&
    needle.startsWith(previous.needle);
  const result = { needle, total: 0 },
    candidates = {},
    best = {};
  for (const kind of CATEGORIES) {
    const source = narrowing ? previous.candidates[kind] : index[kind];
    const matched = [];
    for (const item of source) {
      const s = score(item, needle, tokens);
      if (s !== null) matched.push([s, item]);
    }
    candidates[kind] = matched.map(([, item]) => item);
    matched.sort(
      (a, b) =>
        a[0] - b[0] ||
        b[1].weight - a[1].weight ||
        a[1].name.localeCompare(b[1].name, "fr"),
    );
    result[kind] = matched.slice(0, LIMITS[kind]).map(([, item]) => item);
    best[kind] = matched.length ? matched[0][0] : Infinity;
    result[`${kind}Count`] = matched.length;
    result.total += result[kind].length;
  }
  // The category holding the closest name comes first ("psg" → clubs).
  result.order = [...CATEGORIES].sort(
    (a, b) =>
      best[a] - best[b] || CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b),
  );
  previous.index = index;
  previous.needle = needle;
  previous.tokens = tokens.length;
  previous.candidates = candidates;
  return result;
}

export const SEARCH_LABELS = {
  players: "Joueurs",
  clubs: "Clubs",
  competitions: "Compétitions",
};

import { normalizeText } from "../model.js";
import { isFinalPool1950 } from "../../../shared/world-cup-1950.js";
import { parisDay, validDay } from "./fixtures.js";

function scoreNumber(value) {
  if (Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}
function pair(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const result = value.map(scoreNumber);
  return result.every((number) => number !== null) ? result : null;
}
function identity(date, home, away) {
  return [date, normalizeText(home), normalizeText(away)].join("|");
}
function readableRound(round, group) {
  const convert = (value) => String(value || "")
    // The confederations' cups (OpenFootball): "Finals, Semifinals", "Qualifying, Round 2", "Gruppe G".
    .replace(/^Finals,\s*/i, "")
    .replace(/^(?:Qualifying,|Qual\.)\s*Round\s+(\d+)$/i, "Tour préliminaire $1")
    .replace(/^Preliminary round$/i, "Tour préliminaire")
    .replace(/^Final Round$/i, "Poule finale")
    .replace(/^Group ([A-Z]|\d+) Play-off$/i, "Groupe $1 · Barrage")
    .replace(/^Group,\s*Matchday\s+(\d+)$/i, "Phase de groupes · Journée $1")
    .replace(/^Playoffs$/i, "Barrages")
    .replace(/^Gruppe\s+([A-Z0-9]+)$/i, "Groupe $1")
    .replace(/^Group\s+([A-Z]|\d+)$/i, "Groupe $1")
    .replace(/^Matchday\s+(\d+)$/i, "Journée $1")
    .replace(/^Round\s+(\d+)$/i, "Tour $1")
    .replace(/^Round of 32$/i, "Seizièmes de finale")
    .replace(/^Round of 16$/i, "Huitièmes de finale")
    .replace(/^Quarter[- ]?finals?$/i, "Quarts de finale")
    .replace(/^Semi[- ]?finals?$/i, "Demi-finales")
    .replace(/^Final$/i, "Finale")
    .replace(/^Third place$/i, "Match pour la troisième place");
  const first = convert(group), second = convert(round);
  return [first, second && second !== first ? second : ""].filter(Boolean).join(" · ");
}

function tally(matches, winPoints) {
  const rows = new Map();
  const row = (name) => rows.get(name) || rows.set(name, { name, played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 }).get(name);
  for (const match of matches || []) {
    const home = row(match.home), away = row(match.away);
    if (match.status !== "finished" || !Array.isArray(match.score)) continue;
    const [hs, as] = match.score;
    home.played++; away.played++;
    home.goalsFor += hs; home.goalsAgainst += as; away.goalsFor += as; away.goalsAgainst += hs;
    if (hs > as) { home.wins++; away.losses++; home.points += winPoints; }
    else if (hs < as) { away.wins++; home.losses++; away.points += winPoints; }
    else { home.draws++; away.draws++; home.points++; away.points++; }
  }
  return [...rows.values()].map((r) => ({ ...r, difference: r.goalsFor - r.goalsAgainst }));
}

const displayOrder = (a, b) => b.difference - a.difference || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name, "fr");

/** Standings of a complementary league (VI-19), as before: points, goal difference, goals and name. */
export function leagueTable(matches, { win = 3 } = {}) {
  return tally(matches, win)
    .sort((a, b) => b.points - a.points || displayOrder(a, b))
    .map((r, i) => ({ position: i + 1, ...r }));
}

// A knockout round's name by its number of ties (the names knockout-bracket.js reads).
const ROUND_BY_TIES = { 1: "Final", 2: "Semi-finals", 4: "Quarter-finals", 8: "Round of 16", 16: "Round of 32", 32: "Round of 64" };

/**
 * A cup's numbered rounds (open-matchday's gw) named by their ties, walking back from the last one: each round before
 * holds twice as many ties; the two legs of a tie (the same pairs in two rounds) are one round; an earlier irregular
 * round (replays, a preliminary round) is left unnamed, out of the bracket. A match that already has its round's name
 * keeps it.
 */
export function numberedCupRounds(matches) {
  const rounds = new Map();
  for (const match of matches || []) {
    if (!match.gw || match.roundName) continue;
    const round = rounds.get(match.gw) || { gw: match.gw, pairs: new Set(), first: match.date || "9999" };
    round.pairs.add([match.home, match.away].map((n) => String(n).toLowerCase()).sort().join("|"));
    if (match.date && match.date < round.first) round.first = match.date;
    rounds.set(match.gw, round);
  }
  // The two legs of a round: the same set of pairs in two numbered rounds.
  const groups = [];
  for (const round of [...rounds.values()].sort((a, b) => a.first.localeCompare(b.first))) {
    const key = [...round.pairs].sort().join(",");
    const legs = groups.find((g) => g.key === key);
    if (legs) legs.gws.push(round.gw);
    else groups.push({ key, gws: [round.gw], ties: round.pairs.size });
  }
  const names = new Map();
  let expected = null;
  for (const group of groups.reverse()) {
    if (!ROUND_BY_TIES[group.ties] || (expected !== null && group.ties !== expected)) break;
    for (const gw of group.gws) names.set(gw, ROUND_BY_TIES[group.ties]);
    expected = group.ties * 2;
  }
  return (matches || []).map((match) => (names.has(match.gw) && !match.roundName
    ? { ...match, roundName: names.get(match.gw), round: readableRound(names.get(match.gw)) }
    : match));
}

/** A match's forecast as the API gives it (VI-19): three shares (home, draw, away) that make a law, else null. */
export function matchForecast(value) {
  if (!value || typeof value !== "object") return null;
  const parts = [value.home, value.draw, value.away];
  if (!parts.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)) return null;
  const total = parts[0] + parts[1] + parts[2];
  return total > 0.98 && total < 1.02 ? { home: value.home, draw: value.draw, away: value.away } : null;
}

/**
 * A row's own sides (the API's `sides`, VI-30): each side's team id and crest reference, under the names the bracket
 * reads (homeImage, awayImage). A side comes only from its row's foreign key, never from a name; a malformed one is
 * left out.
 */
function ownSides(row) {
  const out = {};
  for (const [side, id, image] of [["home", "homeTeamId", "homeImage"], ["away", "awayTeamId", "awayImage"]]) {
    const value = row?.sides?.[side];
    if (typeof value?.id !== "string" || !value.id) continue;
    out[id] = value.id;
    if (typeof value.image_url === "string" && value.image_url) out[image] = value.image_url;
  }
  return out;
}

export function normalizeSupplementalCup(results, fixtures) {
  const completed = [], keys = new Set();
  for (const [index, row] of (results || []).entries()) {
    const home = String(row.home || "").trim(), away = String(row.away || "").trim();
    const score = [scoreNumber(row.ft_home), scoreNumber(row.ft_away)];
    if (!home || !away || score.some((number) => number === null)) continue;
    const day = validDay(row.date) ? row.date : "";
    keys.add(identity(day, home, away));
    const roundName = String(row.round_name || row.round || row.stage || "").trim();
    completed.push({ key: "result:" + index, date: day, home, away, score, roundName, round: readableRound(roundName), status: "finished", gw: String(row.gw ?? "").trim(), ...ownSides(row) });
  }
  const scheduled = [];
  for (const [index, row] of (fixtures || []).entries()) {
    const home = String(row.home || "").trim(), away = String(row.away || "").trim();
    if (!home || !away) continue;
    const day = validDay(row.date) ? row.date : "";
    if (keys.has(identity(day, home, away))) continue;
    const roundName = String(row.round_name || row.round || row.stage || "").trim();
    const forecast = matchForecast(row.forecast);
    scheduled.push({ key: "fixture:" + index, date: day, home, away, score: null, roundName, round: readableRound(roundName), status: "scheduled", gw: String(row.gw ?? "").trim(), ...(forecast && { forecast }), ...ownSides(row) });
  }
  return [...completed, ...scheduled];
}

/** The results-v1 matches of International Results in the open-cups shape normalizeOpenCup reads. */
export function resultsAsOpenCup(matches) {
  return (matches || []).map((match) => ({ date: match.date, team1: match.home, team2: match.away, round: match.round || "", score: Array.isArray(match.score) ? { ft: match.score } : undefined }));
}

export function normalizeRoundSides(matches) {
  return (matches || []).map((match) => ({ ...match, ...ownSides(match) }));
}

export function normalizeOpenCup(matches) {
  return (matches || []).flatMap((match, index) => {
    const home = String(match.team1 || "").trim(), away = String(match.team2 || "").trim();
    if (!home || !away) return [];
    const regulation = pair(match.score?.ft), extra = pair(match.score?.et), penalties = pair(match.score?.p);
    const canceled = match.status === "canceled";
    const score = canceled ? null : extra || regulation;
    const notes = [];
    if (extra) notes.push("après prolongation");
    if (penalties) notes.push("tirs au but " + penalties[0] + " – " + penalties[1]);
    const forecast = score ? null : matchForecast(match.forecast);
    return [{ key: "open:" + index, ...(match.id && { id: match.id }), date: validDay(match.date) ? match.date : "", home, away, score, penalties: canceled ? null : penalties, notes, roundName: String(match.round || ""), group: String(match.group || ""), number: Number.isInteger(match.num) ? match.num : null, round: readableRound(match.round, match.group), status: canceled ? "canceled" : score ? "finished" : "scheduled", ...(forecast && !canceled && { forecast }), ...ownSides(match) }];
  });
}

const worldCupYear = (year) => [1930, 1934, 1938].includes(year) || (year >= 1950 && year <= 2026 && (year - 1950) % 4 === 0);
const euroYear = (year) => year >= 1980 && year <= 2028 && year % 4 === 0;

function groupRules(competition, season) {
  const year = /^\d{4}$/.test(String(season)) ? Number(season) : 0;
  if (competition === "world-cup-history" && worldCupYear(year)) {
    const tieBreak = [1954, 1958].includes(year) ? "playoff"
      : year >= 1994 && year <= 2022 ? "fifa"
      : year >= 1974 && year <= 1990 ? "overall" : null;
    return { win: year < 1994 ? 2 : 3, tieBreak, finalPool: year === 1950 };
  }
  if (competition === "euro" && euroYear(year)) {
    return { win: year < 1996 ? 2 : 3, tieBreak: [2020, 2024].includes(year) ? "uefa" : null };
  }
  return { win: null, tieBreak: null };
}

const compare = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return 0;
};

/** Each block is ranked ahead of the next one. Teams within a block share the place. */
function rankBlocks(rows, metrics) {
  const sorted = rows.map((row) => ({ row, values: metrics(row) })).sort((a, b) => compare(a.values, b.values));
  const blocks = [];
  let previous;
  for (const { row, values } of sorted) {
    if (!previous || compare(previous, values)) blocks.push([]);
    blocks.at(-1).push(row);
    previous = values;
  }
  return blocks;
}

const overall = (row) => [row.difference, row.goalsFor];
const played = (match) => match.status === "finished" && Array.isArray(match.score);

function headToHead(rows, matches, win, reapply) {
  if (rows.length < 2) return [rows];
  const teams = new Set(rows.map((row) => row.name));
  const games = matches.filter((m) => played(m) && m.home !== m.away && teams.has(m.home) && teams.has(m.away));
  const pairs = new Set(games.map((m) => JSON.stringify([m.home, m.away].sort())));
  const expected = rows.length * (rows.length - 1) / 2;
  if (games.length !== expected || pairs.size !== expected) return null;
  const miniTable = new Map(tally(games, win).map((row) => [row.name, row]));
  const blocks = rankBlocks(rows, ({ name }) => [miniTable.get(name).points, ...overall(miniTable.get(name))]);
  if (reapply && blocks.length > 1) return blocks.flatMap((block) => headToHead(block, games, win, true) ?? [block]);
  return blocks;
}

function breakTie(rows, { matches, playoffs }, { win, tieBreak }) {
  if (rows.length < 2) return [rows];
  if (tieBreak === "playoff" && rows.length === 2) {
    const teams = new Set(rows.map((row) => row.name));
    const games = playoffs.filter((m) => played(m) && m.home !== m.away && teams.has(m.home) && teams.has(m.away));
    if (games.length === 1 && games[0].score[0] !== games[0].score[1]) {
      const game = games[0], winner = game.score[0] > game.score[1] ? game.home : game.away;
      return rankBlocks(rows, (row) => [Number(row.name === winner)]);
    }
  }
  if (tieBreak === "overall") return rankBlocks(rows, overall);
  if (tieBreak === "fifa") return rankBlocks(rows, overall).flatMap((block) => headToHead(block, matches, win, false) ?? [block]);
  if (tieBreak === "uefa") {
    const direct = headToHead(rows, matches, win, true);
    return direct ? direct.flatMap((block) => rankBlocks(block, overall)) : [rows];
  }
  return [rows];
}

function standings(group, rules, today) {
  const { name, matches } = group;
  const pool = name === "Poule finale";
  const missing = matches.filter((m) => !played(m) && m.status !== "canceled" && (!m.date || m.date < today));
  const affected = new Set(missing.flatMap((m) => [m.home, m.away]));
  const table = tally(matches, rules.win);
  const ranked = rules.win !== null && !missing.length && table.some((row) => row.played) &&
    (!pool || (rules.finalPool && matches.every(played) && isFinalPool1950(matches)));
  const blocks = ranked
    ? rankBlocks(table, (row) => [row.points]).flatMap((block) => breakTie(block, group, rules))
    : [table];
  let position = 1;
  const rows = blocks.flatMap((block) => {
    const current = position;
    position += block.length;
    return block.sort(displayOrder).map((row) => {
      const hasPoints = rules.win !== null && !affected.has(row.name) && (row.played > 0 || ranked);
      return { ...row, position: ranked ? current : null, tied: ranked && block.length > 1,
        points: hasPoints ? row.points : null, difference: hasPoints ? row.difference : null };
    });
  });
  return { name, rows, unresolved: rows.some((row) => row.tied) };
}

/** Archive groups: explicit group, round-only group, separating play-off, or 1950 final pool. */
export function groupTables(matches, { competition, season, today = parisDay(Date.now()) } = {}) {
  const groups = new Map();
  for (const match of matches || []) {
    const round = String(match.roundName ?? "").trim();
    const playoff = /^(Group (?:[a-z]|\d+)) Play-?off$/i.exec(round)?.[1];
    const namedGroup = match.group || (/^Group (?:[a-z]|\d+)$/i.test(round) ? round : "");
    const name = playoff ? readableRound(playoff) : namedGroup ? readableRound(namedGroup) : /^final round$/i.test(round) ? "Poule finale" : "";
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, { name, matches: [], playoffs: [] });
    groups.get(name)[playoff ? "playoffs" : "matches"].push(match);
  }
  const rules = groupRules(competition, season);
  return [...groups.values()]
    .filter((group) => group.matches.length)
    .sort((a, b) => (a.name === "Poule finale") - (b.name === "Poule finale") || a.name.localeCompare(b.name, "fr", { numeric: true }))
    .map((group) => standings(group, rules, today));
}

/** Keep past unscored matches out of the upcoming list. */
export function filterCupMatches(matches, status, query = "", now = Date.now(), teamLabel) {
  const needle = normalizeText(query).trim(), today = parisDay(now);
  const rows = (matches || []).filter((match) => {
    if (status === "finished" && match.status !== "finished") return false;
    if (status === "scheduled" && (match.status !== "scheduled" || (match.date && match.date < today))) return false;
    const sourceNames = [match.home, match.away, match.round].join(" ");
    const names = teamLabel ? [sourceNames, teamLabel(match.home), teamLabel(match.away)].join(" ") : sourceNames;
    return !needle || normalizeText(names).includes(needle);
  });
  return rows.sort((a, b) => {
    if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : a.key.localeCompare(b.key);
    return (status === "scheduled" ? 1 : -1) * a.date.localeCompare(b.date) || a.key.localeCompare(b.key);
  });
}

import { normalizeText } from "../model.js";
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
    .replace(/^Group,\s*Matchday\s+(\d+)$/i, "Phase de groupes · Journée $1")
    .replace(/^Playoffs$/i, "Barrages")
    .replace(/^Gruppe\s+([A-Z0-9]+)$/i, "Groupe $1")
    .replace(/^Group\s+([A-Z])$/i, "Groupe $1")
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

/**
 * A league's standings from its matches (a complementary league, VI-19): points, goal difference, goals scored, then
 * the name; a team with no match played yet is in the table all the same. Computed from the results the source gives:
 * no deduction or head-to-head rule can be read from them.
 */
export function leagueTable(matches) {
  const rows = new Map();
  const row = (name) => rows.get(name) || rows.set(name, { name, played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 }).get(name);
  for (const match of matches || []) {
    const home = row(match.home), away = row(match.away);
    if (match.status !== "finished" || !Array.isArray(match.score)) continue;
    const [hs, as] = match.score;
    home.played++; away.played++;
    home.goalsFor += hs; home.goalsAgainst += as; away.goalsFor += as; away.goalsAgainst += hs;
    if (hs > as) { home.wins++; away.losses++; home.points += 3; }
    else if (hs < as) { away.wins++; home.losses++; away.points += 3; }
    else { home.draws++; away.draws++; home.points++; away.points++; }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, difference: r.goalsFor - r.goalsAgainst }))
    .sort((a, b) => b.points - a.points || b.difference - a.difference || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name, "fr"))
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

export function normalizeSupplementalCup(results, fixtures) {
  const completed = [], keys = new Set();
  for (const [index, row] of (results || []).entries()) {
    const home = String(row.home || "").trim(), away = String(row.away || "").trim();
    const score = [scoreNumber(row.ft_home), scoreNumber(row.ft_away)];
    if (!home || !away || score.some((number) => number === null)) continue;
    const day = validDay(row.date) ? row.date : "";
    keys.add(identity(day, home, away));
    const roundName = String(row.round_name || row.round || row.stage || "").trim();
    completed.push({ key: "result:" + index, date: day, home, away, score, roundName, round: readableRound(roundName), status: "finished", gw: String(row.gw ?? "").trim() });
  }
  const scheduled = [];
  for (const [index, row] of (fixtures || []).entries()) {
    const home = String(row.home || "").trim(), away = String(row.away || "").trim();
    if (!home || !away) continue;
    const day = validDay(row.date) ? row.date : "";
    if (keys.has(identity(day, home, away))) continue;
    const roundName = String(row.round_name || row.round || row.stage || "").trim();
    const forecast = matchForecast(row.forecast);
    scheduled.push({ key: "fixture:" + index, date: day, home, away, score: null, roundName, round: readableRound(roundName), status: "scheduled", gw: String(row.gw ?? "").trim(), ...(forecast && { forecast }) });
  }
  return [...completed, ...scheduled];
}

/** The results-v1 matches of International Results in the open-cups shape normalizeOpenCup reads. */
export function resultsAsOpenCup(matches) {
  return (matches || []).map((match) => ({ date: match.date, team1: match.home, team2: match.away, round: match.round || "", score: Array.isArray(match.score) ? { ft: match.score } : undefined }));
}

export function normalizeOpenCup(matches) {
  return (matches || []).flatMap((match, index) => {
    const home = String(match.team1 || "").trim(), away = String(match.team2 || "").trim();
    if (!home || !away) return [];
    const regulation = pair(match.score?.ft), extra = pair(match.score?.et), penalties = pair(match.score?.p);
    const score = extra || regulation;
    const notes = [];
    if (extra) notes.push("après prolongation");
    if (penalties) notes.push("tirs au but " + penalties[0] + " – " + penalties[1]);
    const forecast = score ? null : matchForecast(match.forecast);
    return [{ key: "open:" + index, date: validDay(match.date) ? match.date : "", home, away, score, penalties, notes, roundName: String(match.round || ""), number: Number.isInteger(match.num) ? match.num : null, round: readableRound(match.round, match.group), status: score ? "finished" : "scheduled", ...(forecast && { forecast }) }];
  });
}

/** Keep past unscored matches out of the upcoming list. */
export function filterCupMatches(matches, status, query = "", now = Date.now()) {
  const needle = normalizeText(query).trim(), today = parisDay(now);
  const rows = (matches || []).filter((match) => {
    if (status === "finished" && match.status !== "finished") return false;
    if (status === "scheduled" && (match.status !== "scheduled" || (match.date && match.date < today))) return false;
    return !needle || normalizeText(match.home + " " + match.away + " " + (match.round || "")).includes(needle);
  });
  return rows.sort((a, b) => {
    if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : a.key.localeCompare(b.key);
    return (status === "scheduled" ? 1 : -1) * a.date.localeCompare(b.date) || a.key.localeCompare(b.key);
  });
}

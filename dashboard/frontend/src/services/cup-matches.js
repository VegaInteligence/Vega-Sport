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

export function normalizeSupplementalCup(results, fixtures) {
  const completed = [], keys = new Set();
  for (const [index, row] of (results || []).entries()) {
    const home = String(row.home || "").trim(), away = String(row.away || "").trim();
    const score = [scoreNumber(row.ft_home), scoreNumber(row.ft_away)];
    if (!home || !away || score.some((number) => number === null)) continue;
    const day = validDay(row.date) ? row.date : "";
    keys.add(identity(day, home, away));
    completed.push({ key: "result:" + index, date: day, home, away, score, status: "finished" });
  }
  const scheduled = [];
  for (const [index, row] of (fixtures || []).entries()) {
    const home = String(row.home || "").trim(), away = String(row.away || "").trim();
    if (!home || !away) continue;
    const day = validDay(row.date) ? row.date : "";
    if (keys.has(identity(day, home, away))) continue;
    scheduled.push({ key: "fixture:" + index, date: day, home, away, score: null, status: "scheduled" });
  }
  return [...completed, ...scheduled];
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
    return [{ key: "open:" + index, date: validDay(match.date) ? match.date : "", home, away, score, notes, round: readableRound(match.round, match.group), status: score ? "finished" : "scheduled" }];
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

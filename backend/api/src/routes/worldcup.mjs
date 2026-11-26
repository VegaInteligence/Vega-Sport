/**
 * An archived World Cup match's details (138), from the Fjelstul World Cup Database (CC-BY-SA 4.0; its credit comes
 * with every match):
 *
 * GET /api/worldcup/matches?edition=YYYY — the edition's men's matches paired with an archived match: each under the
 * database's key, its day and the teams as the archive names them, in the archive's order (the bracket finds its ties
 * by them).
 *
 * GET /api/worldcup/matches/{key} — one match, oriented as the archived match: its stage, day and time, stadium,
 * referee, managers, the base's score, the line-ups by side (from 1970: before, empty lists), its events by time and
 * the kicks of its shoot-out in the order taken.
 */
import { reject, validateParams } from "../http.mjs";
import { createDataVersions } from "../data-versions.mjs";

const MATCH = /^\/api\/worldcup\/matches\/([^/]+)$/;
const KEY = /^M-\d{4}-\d{2,3}$/;
const CREDIT = "fjelstul-worldcup";
// A line-up's order: the goalkeeper, then the defence, the midfield and the attack; the database's codes.
const LINE = { GK: 0, DF: 1, CB: 1, RB: 1, LB: 1, SW: 1, RWB: 1, LWB: 1, WB: 1, MF: 2, CM: 2, DM: 2, AM: 2, RM: 2, LM: 2, FW: 3, CF: 3, SS: 3, RW: 3, LW: 3, RF: 3, LF: 3 };
// Two halves of one substitution: the player going off first.
const AFTER = { off: 1, on: 2 };

// Each path's statements' relations (FAILURE_MODES_OPTIMISATIONS.md GH137A); the bodies ({ data }) and former tags unchanged.
const worldcup = (reads) => ({ family: "worldcup", data: true, ttl: 3600, reads });
export const WORLDCUP_INDEX_SPEC = worldcup(["api.worldcup_match_index"]);
export const WORLDCUP_MATCH_SPEC = worldcup(["api.worldcup_match_heads", "api.worldcup_match_people", "api.worldcup_match_events",
  "api.worldcup_match_kicks", "api.source_revisions"]);

const day = (value) => (value ? String(value instanceof Date ? value.toISOString() : value).slice(0, 10) : null);

async function index(params, read) {
  validateParams(params, ["edition"]);
  const edition = params.get("edition");
  if (!/^\d{4}$/.test(edition || "")) reject(400, "Paramètre invalide.");
  const rows = await read("SELECT key, date, home, away FROM api.worldcup_match_index WHERE edition = $1 ORDER BY date, key", [Number(edition)]);
  if (!rows.length) reject(404, "Ressource introuvable.");
  return { edition: Number(edition), matches: rows.map((r) => ({ key: r.key, date: day(r.date), home: r.home, away: r.away })) };
}

async function match(key, params, read) {
  validateParams(params, []);
  if (!KEY.test(key)) reject(400, "Paramètre invalide.");
  const [head] = await read("SELECT * FROM api.worldcup_match_heads WHERE key = $1", [key]);
  if (!head) reject(404, "Ressource introuvable.");
  const [people, events, kicks, [credit]] = await Promise.all([
    read("SELECT role, team_key, person, name, country, number, position, starter FROM api.worldcup_match_people WHERE key = $1", [key]),
    read("SELECT kind, team_key, person, name, minute, stoppage, event_key FROM api.worldcup_match_events WHERE key = $1", [key]),
    read("SELECT team_key, person, name, converted FROM api.worldcup_match_kicks WHERE key = $1 ORDER BY position", [key]),
    read("SELECT name, url, license FROM api.source_revisions WHERE source = $1", [CREDIT]),
  ]);
  const side = (team) => (team === head.home_team_key ? "home" : team === head.away_team_key ? "away" : null);
  const manager = (team) => people.find((p) => p.role === "manager" && p.team_key === team)?.name ?? null;
  const referee = people.find((p) => p.role === "referee");
  const lineup = (team) =>
    people
      .filter((p) => p.role === "player" && p.team_key === team)
      .sort((a, b) => Number(b.starter) - Number(a.starter) || (LINE[a.position] ?? 2) - (LINE[b.position] ?? 2) || (a.number ?? 99) - (b.number ?? 99) || a.name.localeCompare(b.name))
      .map((p) => ({ person: p.person, name: p.name, number: p.number ?? null, position: p.position ?? null, starter: p.starter }));
  const penalties = head.home_penalty_score == null || head.away_penalty_score == null ? null : [head.home_penalty_score, head.away_penalty_score];
  return {
    key, edition: head.edition, stage: head.stage, group: head.group_name ?? null, date: day(head.date), time: head.time ?? null,
    stadium: { name: head.stadium, city: head.city ?? null, country: head.country ?? null },
    referee: referee ? { name: referee.name, country: referee.country ?? null } : null,
    home: { name: head.home, manager: manager(head.home_team_key) },
    away: { name: head.away, manager: manager(head.away_team_key) },
    score: head.home_score == null || head.away_score == null ? null : [head.home_score, head.away_score],
    extraTime: head.extra_time, penalties,
    lineups: { home: lineup(head.home_team_key), away: lineup(head.away_team_key) },
    events: events
      .sort((a, b) => a.minute - b.minute || a.stoppage - b.stoppage || (AFTER[a.kind] ?? 0) - (AFTER[b.kind] ?? 0) || a.event_key.localeCompare(b.event_key))
      .map((e) => ({ minute: e.minute, stoppage: e.stoppage, side: side(e.team_key), kind: e.kind, person: e.person, name: e.name })),
    kicks: kicks.map((k) => ({ side: side(k.team_key), person: k.person, name: k.name, converted: k.converted })),
    credit: credit ? { name: credit.name, url: credit.url, license: credit.license } : null,
  };
}

export function createWorldCupRoute(read, { versioned = createDataVersions(read) } = {}) {
  return async (req, path, params) => {
    if (path === "/api/worldcup/matches") return versioned(req, params, WORLDCUP_INDEX_SPEC, (guarded) => index(params, guarded));
    const found = path.match(MATCH);
    return found ? versioned(req, params, WORLDCUP_MATCH_SPEC, (guarded) => match(decodeURIComponent(found[1]), params, guarded)) : null;
  };
}

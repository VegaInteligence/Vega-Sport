/**
 * Cup editions of the sources other than PitchAPI, and the cup snapshots of main:
 * /api/open-cups, /api/openligadb, /api/nations-results and /api/cup-snapshot, same
 * parameters and bodies, read from api.cup_editions and api.cup_matches (028), which
 * vega_v2/sources/cups.py fills with main's own source projections.
 *
 * Differences with the legacy read: a field the source left null is omitted (as when it
 * is absent); a snapshot's `worker.checkedAt`/`updatedAt` are the last successful read and
 * the last change of the edition; native and standings snapshots are read from the v2
 * PitchAPI tables (main: the retired cup worker's files). The cup worker index and the
 * open-matchday tables (/api/cup-index, /api/cup-table, /api/supplemental) stay on main.
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";
import { fixture } from "./matches.mjs";
import { standingsBody } from "./reference.mjs";

const KEY = /^[\w:-]{1,100}$/,
  YEAR = /^\d{4}(?:\/\d{4})?$/;
const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
const pair = (a, b) => (a != null && b != null ? [a, b] : null);
// The English round names of frontend/src/services/openligadb.js (main), by French name.
const GERMAN_ROUND_NAMES = {
  "Premier tour": "Round of 64", "Seizièmes de finale": "Round of 32", "Huitièmes de finale": "Round of 16",
  "Quarts de finale": "Quarter-finals", "Demi-finales": "Semi-finals", Finale: "Final",
};
const SOURCES = {
  "open-cups": (e) => ({ name: "OpenFootball", url: e.source_url, license: "CC0-1.0" }),
  openligadb: (e) => ({ name: "OpenLigaDB", url: "https://www.openligadb.de/", dataUrl: e.data_url, license: "ODbL-1.0" }),
  "nations-results": () => ({ name: "International Results", url: "https://github.com/martj42/international_results", license: "CC0-1.0" }),
};

function validate(p, spec) {
  validateParams(p, Object.keys(spec));
  for (const [k, v] of p) if (!spec[k].test(v)) reject(400, "Paramètre invalide.");
  return Object.fromEntries(p);
}

function respond(req, body, family) {
  const etag = `W/"${family}-v1-${createHash("sha256").update(JSON.stringify(body)).digest("hex")}"`;
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl: 60 });
  return send(req, body, 200, { etag, ttl: 60 });
}

const openCupMatch = (m) => {
  const score = {};
  const ft = m.home_score_90 != null ? pair(m.home_score_90, m.away_score_90) : pair(m.home_score, m.away_score);
  if (ft) score.ft = ft;
  if (pair(m.home_score_ht, m.away_score_ht)) score.ht = [m.home_score_ht, m.away_score_ht];
  if (pair(m.home_score_et, m.away_score_et)) score.et = [m.home_score_et, m.away_score_et];
  if (pair(m.home_penalty_score, m.away_penalty_score)) score.p = [m.home_penalty_score, m.away_penalty_score];
  return {
    ...(m.round != null && { round: m.round }),
    ...(m.group_name != null && { group: m.group_name }),
    ...(m.match_number != null && { num: m.match_number }),
    ...(m.date != null && { date: m.date }),
    team1: m.home,
    team2: m.away,
    ...(Object.keys(score).length && { score }),
  };
};

const notes = (m) => [
  ...(pair(m.home_score_et, m.away_score_et) ? ["après prolongation"] : []),
  ...(pair(m.home_penalty_score, m.away_penalty_score) ? [`tirs au but ${m.home_penalty_score} – ${m.away_penalty_score}`] : []),
];

const openLigaMatch = (competition) => (m) => {
  const finished = m.status === "finished";
  return {
    key: `openliga:${m.key}`, date: m.date ?? "", home: m.home, away: m.away, homeId: m.home_key, awayId: m.away_key,
    score: finished ? pair(m.home_score, m.away_score) : null,
    penalties: finished ? pair(m.home_penalty_score, m.away_penalty_score) : null,
    notes: notes(m), status: finished ? "finished" : "scheduled",
    roundName: competition === "germany-cup" ? GERMAN_ROUND_NAMES[m.round] ?? "" : "",
    round: m.round ?? "",
    group: competition === "nations-league" && m.group_name != null ? Number(m.group_name) : null,
  };
};

const nationsMatch = (m) => ({
  key: `nations:${m.key}`, date: m.date ?? "", home: m.home, away: m.away, homeId: m.home_key, awayId: m.away_key,
  score: pair(m.home_score, m.away_score), status: "finished",
  league: m.group_name?.[0] ?? null, group: m.group_name ? Number(m.group_name.slice(1)) : null, round: m.round ?? "",
});

/** The body of a cup edition, or null when it was never read. */
export async function cupBody(read, kind, competition, season) {
  const [e] = await read("SELECT * FROM api.cup_editions WHERE kind=$1 AND competition=$2 AND season=$3", [kind, competition, season]);
  if (!e) return null;
  const rows = await read("SELECT * FROM api.cup_matches WHERE competition_season_id=$1 ORDER BY position, match_id", [e.competition_season_id]);
  const source = SOURCES[kind](e);
  const body =
    kind === "open-cups"
      ? { name: e.name, season, matches: rows.map(openCupMatch), source }
      : kind === "openligadb"
        ? { competition, season, matches: rows.map(openLigaMatch(competition)), source }
        : { season, matches: rows.map(nationsMatch), source };
  return { body, worker: { checkedAt: iso(e.checked_at), updatedAt: iso(e.updated_at) } };
}

async function nativeSnapshot(read, competition, season) {
  const rows = await read(
    `SELECT f.*,r.name AS round,r.playoff FROM api.fixtures f LEFT JOIN api.match_rounds r ON r.match_id=f.match_id
     WHERE f.league_id=$1 AND (f.season=$2 OR f.native_season=$2) ORDER BY f.day NULLS LAST,f.id`,
    [competition, season],
  );
  if (!rows.length) return null;
  const [state] = await read("SELECT published_at FROM api.publication");
  const matches = rows.map((row) => {
    const f = fixture(row);
    return {
      id: f.id, season: f.season, date: f.date, time_utc: f.time_utc, status: f.status,
      home_team: f.home_team, away_team: f.away_team, league: { ...f.league, season: f.season },
      score_home: f.score_home, score_away: f.score_away,
    };
  });
  const rounds = Object.fromEntries(rows.filter((r) => r.round).map((r) => [r.id, { name: r.round, playoff: r.playoff }]));
  const at = iso(state?.published_at);
  return { matches, rounds, worker: { checkedAt: at, updatedAt: at } };
}

export function createCupRoute(read) {
  return async (req, path, params) => {
    const edition = async (kind, competition, season) => {
      const found = await cupBody(read, kind, competition, season);
      if (!found) reject(400, "Compétition ou édition indisponible.");
      return respond(req, found.body, "support");
    };
    if (path === "/api/open-cups") {
      const p = validate(params, { competition: KEY, season: YEAR });
      return edition("open-cups", p.competition ?? "", p.season ?? "");
    }
    if (path === "/api/openligadb") {
      const p = validate(params, { competition: KEY, season: YEAR });
      return edition("openligadb", p.competition ?? "", p.season ?? "");
    }
    if (path === "/api/nations-results") {
      const p = validate(params, { season: YEAR });
      return edition("nations-results", "nations-league", p.season ?? "");
    }
    if (path === "/api/cup-snapshot") {
      const p = validate(params, { competition: KEY, season: YEAR, kind: /^(native|standings|open-cups|openligadb|nations-results)$/ });
      if (!p.competition || !p.season || !p.kind) reject(400, "Paramètre manquant.");
      let body = null;
      if (p.kind === "native") body = await nativeSnapshot(read, p.competition, p.season);
      else if (p.kind === "standings") {
        if (!/^l_(?:[A-Za-z0-9]{6}|v\d{7})$/.test(p.competition)) reject(404, "Donnée indisponible.");
        const table = await standingsBody(read, p.competition, p.season).catch((error) => (error.status === 404 ? null : Promise.reject(error)));
        if (table) {
          const [state] = await read("SELECT published_at FROM api.publication");
          const { competition, source, tables } = table;
          body = { competition, source, tables, worker: { checkedAt: iso(state?.published_at), updatedAt: table.fetchedAt } };
        }
      } else {
        const competition = p.kind === "nations-results" ? "nations-league" : p.competition;
        const found = await cupBody(read, p.kind, competition, p.season);
        if (found) body = { ...found.body, worker: found.worker };
      }
      if (!body) reject(404, "Donnée indisponible.");
      return respond(req, body, "catalog");
    }
    return null;
  };
}

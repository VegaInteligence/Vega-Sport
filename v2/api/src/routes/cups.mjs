/**
 * The cup editions of the complementary sources and the cup snapshots, read from
 * api.cup_editions and api.cup_matches (028, 030), which vega_v2/sources/cups.py fills with
 * main's own source projections. Routes name no source (030_neutral_reads.sql):
 * - GET /api/cups/index: the cups, by Vega competition id, with their competition key,
 *   seasons, body `format` and attribution;
 * - GET /api/cups/edition?competition=l_v…&season=: one edition, in main's body for its
 *   format (legacy /api/open-cups, /api/openligadb and /api/nations-results);
 * - GET /api/cup-snapshot?kind=native|standings|edition&competition=l_…&season=: main's
 *   snapshot; `edition` replaces the legacy source kinds;
 * - GET /api/cup-index?kind=supplemental and /api/cup-table?competition=<folder>&season=&kind=:
 *   main's catalogue of complementary competitions (open-matchday) and its table rows,
 *   rebuilt from typed facts (the source's goal minutes, kick-off time and per-row
 *   sub-source are not kept: empty). The retired cup worker's index (kind=worker) is a 404,
 *   and the site reads the catalogue instead.
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

const LEAGUE = /^l_(?:[A-Za-z0-9]{6}|v\d{7})$/,
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
  "open-matchday": (e) => ({ name: "open-matchday", url: e.source_url, license: "informational, non-commercial use with attribution" }),
};
const FOLDER = /^[A-Z0-9_]+_[a-z0-9-]+$/;
const text = (v) => (v === null || v === undefined ? "" : String(v));
const outcome = (h, a) => (h == null || a == null ? "" : h > a ? "H" : h < a ? "A" : "D");

/** A row of main's catalogue tables (the source's CSV line), from typed facts. */
export function tableRow(r) {
  const row = { gw: text(r.gw), away: r.away, date: r.date ?? "", home: r.home, time: "" };
  if (r.status !== "finished") return row;
  const sides = {};
  for (const side of ["home", "away"])
    for (const k of ["shots", "target", "fouls", "corners", "yellow", "red", "corners_1h", "corners_2h"]) sides[`${side}_${k}`] = text(r[`${side}_${k}`]);
  return {
    ...row, source: "", ft_away: text(r.away_score), ft_home: text(r.home_score), ht_away: text(r.away_score_ht), ht_home: text(r.home_score_ht),
    ft_result: outcome(r.home_score, r.away_score), ht_result: outcome(r.home_score_ht, r.away_score_ht), goal_minutes: "", ...sides,
  };
}

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

/** The body of a cup edition (by Vega competition id and season), or null when it was never read. */
export async function cupBody(read, competitionId, season) {
  const [e] = await read("SELECT * FROM api.cup_editions WHERE competition_id=$1 AND season=$2", [competitionId, season]);
  if (!e) return null;
  const rows = await read("SELECT * FROM api.cup_matches WHERE competition_season_id=$1 ORDER BY position, match_id", [e.competition_season_id]);
  const source = SOURCES[e.kind](e);
  if (e.format === "table-v1") {
    const table = await read("SELECT * FROM api.cup_table_rows WHERE competition_season_id=$1 ORDER BY position", [e.competition_season_id]);
    const body = {
      name: e.name, season, source,
      results: table.filter((r) => r.status === "finished").map(tableRow),
      fixtures: table.filter((r) => r.status !== "finished").map(tableRow),
    };
    return { body, worker: { checkedAt: iso(e.checked_at), updatedAt: iso(e.updated_at) } };
  }
  const body =
    e.format === "matches-v1"
      ? { name: e.name, season, matches: rows.map(openCupMatch), source }
      : e.format === "rounds-v1"
        ? { competition: e.competition, season, matches: rows.map(openLigaMatch(e.competition)), source }
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
    if (path === "/api/cups/index") {
      validate(params, {});
      const rows = await read("SELECT competition_id,competition,name,season,format,kind,source_url,data_url FROM api.cup_editions ORDER BY competition_id,season");
      const cups = new Map();
      for (const e of rows) {
        const cup = cups.get(e.competition_id) ?? { id: e.competition_id, key: e.competition, seasons: [] };
        // The latest edition names the cup and its source.
        cups.set(e.competition_id, { ...cup, name: e.name ?? e.competition, format: e.format, source: SOURCES[e.kind](e), seasons: [...cup.seasons, e.season] });
      }
      return respond(req, { cups: [...cups.values()] }, "catalog");
    }
    if (path === "/api/cup-index") {
      // main's catalogue of complementary competitions; the cup worker's own index is retired.
      const p = validate(params, { kind: /^(supplemental|worker)$/ });
      if (p.kind !== "supplemental") reject(404, "Donnée indisponible.");
      const [revision] = await read("SELECT * FROM api.source_revisions WHERE source='open-matchday'");
      const editions = await read(
        `SELECT e.competition,e.name,e.season,(SELECT count(*) FILTER(WHERE t.status='finished')::int FROM api.cup_table_rows t WHERE t.competition_season_id=e.competition_season_id) results,
           (SELECT count(*) FILTER(WHERE t.status<>'finished')::int FROM api.cup_table_rows t WHERE t.competition_season_id=e.competition_season_id) fixtures
         FROM api.cup_editions e WHERE e.kind='open-matchday' ORDER BY e.competition,e.season`,
      );
      if (!revision && !editions.length) reject(404, "Donnée indisponible.");
      return respond(req, {
        meta: {
          terms: "https://github.com/oladeeayo/open-matchday/blob/master/DISCLAIMER.md",
          usage: revision?.license ?? "informational, non-commercial use with attribution",
          source: revision?.url ?? "https://github.com/oladeeayo/open-matchday",
          retrieved_at_utc: iso(revision?.retrieved_at),
          source_generated_at_utc: revision?.revision ?? null,
        },
        competitions: editions.map((e) => ({
          name: e.name, folder: e.competition, season: e.season,
          tables: { goals: { rows: 0 }, results: { rows: e.results }, fixtures: { rows: e.fixtures } }, country_code: e.competition.split("_")[0],
        })),
      }, "catalog");
    }
    if (path === "/api/cup-table") {
      const p = validate(params, { competition: FOLDER, season: YEAR, kind: /^(results|fixtures)$/ });
      if (!p.competition || !p.season || !p.kind) reject(400, "Paramètre manquant.");
      const rows = await read("SELECT * FROM api.cup_table_rows WHERE competition=$1 AND season=$2 ORDER BY position", [p.competition, p.season]);
      if (!rows.length) reject(404, "Donnée indisponible.");
      return respond(req, rows.filter((r) => (p.kind === "results") === (r.status === "finished")).map(tableRow), "catalog");
    }
    if (path === "/api/cups/edition") {
      const p = validate(params, { competition: LEAGUE, season: YEAR });
      if (!p.competition || !p.season) reject(400, "Paramètre manquant.");
      const found = await cupBody(read, p.competition, p.season);
      if (!found) reject(404, "Compétition ou édition indisponible.");
      return respond(req, found.body, "support");
    }
    if (path === "/api/cup-snapshot") {
      const p = validate(params, { competition: LEAGUE, season: YEAR, kind: /^(native|standings|edition)$/ });
      if (!p.competition || !p.season || !p.kind) reject(400, "Paramètre manquant.");
      let body = null;
      if (p.kind === "native") body = await nativeSnapshot(read, p.competition, p.season);
      else if (p.kind === "standings") {
        const table = await standingsBody(read, p.competition, p.season).catch((error) => (error.status === 404 ? null : Promise.reject(error)));
        if (table) {
          const [state] = await read("SELECT published_at FROM api.publication");
          const { competition, source, tables } = table;
          body = { competition, source, tables, worker: { checkedAt: iso(state?.published_at), updatedAt: table.fetchedAt } };
        }
      } else {
        const found = await cupBody(read, p.competition, p.season);
        if (found) body = { ...found.body, worker: found.worker };
      }
      if (!body) reject(404, "Donnée indisponible.");
      return respond(req, body, "catalog");
    }
    return null;
  };
}

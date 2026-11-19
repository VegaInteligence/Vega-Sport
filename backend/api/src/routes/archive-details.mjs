/**
 * What football-data.co.uk adds to the archived league seasons 2000/01–2020/21 (140, vega/sources/footballdata.py).
 * No page reads it yet; the source's credit and terms come with every answer.
 *
 * GET /api/archives/details — per division and season: its country and level, the rows read, those paired with an
 * archived match, those with match statistics and those with prices.
 *
 * GET /api/archives/details?match={archive key} — an archived match's details: the base's day and score, the file's
 * score, the half-time score, kick-off, referee and attendance when given, each side's statistics (null when the
 * file gives none) and the 1X2 prices the file gives.
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";

const SOURCE = "football-data-co-uk";
// An archive key: "r:2015-16/fr.1:370", "engsoccerdata/…": letters, digits and . : / _ + -.
const KEY = /^[A-Za-z0-9._:/+-]{1,200}$/;
const STATS = [
  ["shots", "shots"], ["shotsOnTarget", "shots_on_target"], ["woodwork", "woodwork"], ["corners", "corners"], ["fouls", "fouls"],
  ["freeKicksConceded", "free_kicks_conceded"], ["offsides", "offsides"], ["yellowCards", "yellow_cards"], ["redCards", "red_cards"],
  ["bookingPoints", "booking_points"],
];
// The columns of each price triple, in the order served.
const ODDS = [["bet365", false, "b365"], ["bet365", true, "b365_closing"], ["pinnacle", false, "pinnacle"], ["pinnacle", true, "pinnacle_closing"],
  ["market-average", false, "market_average"], ["market-maximum", false, "market_maximum"]];

const day = (value) => (value ? String(value instanceof Date ? value.toISOString() : value).slice(0, 10) : null);
const pair = (a, b) => (a == null || b == null ? null : [a, b]);

function respond(req, data) {
  const etag = `W/"archive-details-v1-${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl: 3600 });
  return send(req, { data }, 200, { etag, ttl: 3600 });
}

async function credit(read) {
  const [row] = await read("SELECT name, url, license FROM api.source_revisions WHERE source = $1", [SOURCE]);
  return row ? { name: row.name, url: row.url, terms: row.license } : null;
}

const side = (row, prefix) => Object.fromEntries(STATS.map(([name, column]) => [name, row[`${prefix}_${column}`] ?? null]));

async function details(req, params, read) {
  validateParams(params, ["match"]);
  if (!params.has("match")) {
    const rows = await read(`SELECT division, country, level, season_id, matches, paired, with_stats, with_odds
      FROM api.archive_detail_coverage ORDER BY country, level, season_id`);
    return respond(req, {
      coverage: rows.map((r) => ({ division: r.division, country: r.country, level: r.level, season: `${r.season_id}/${r.season_id + 1}`,
        matches: r.matches, paired: r.paired, withStats: r.with_stats, withOdds: r.with_odds })),
      credit: await credit(read),
    });
  }
  const key = params.get("match");
  if (!KEY.test(key || "")) reject(400, "Paramètre invalide.");
  const [row] = await read("SELECT * FROM api.archive_match_details WHERE key = $1", [key]);
  if (!row) reject(404, "Ressource introuvable.");
  const home = side(row, "home"), away = side(row, "away");
  const given = [...Object.values(home), ...Object.values(away)].some((v) => v != null);
  return respond(req, {
    match: key, date: day(row.date), score: pair(row.home_score, row.away_score), sourceScore: [row.home_goals, row.away_goals],
    halfTime: pair(row.ht_home_goals, row.ht_away_goals),
    kickoff: row.kickoff_time ? String(row.kickoff_time).slice(0, 5) : null, referee: row.referee ?? null, attendance: row.attendance ?? null,
    stats: given ? { home, away } : null,
    odds: ODDS.filter(([, , c]) => row[`${c}_home`] != null).map(([bookmaker, closing, c]) => ({ bookmaker, closing, home: row[`${c}_home`], draw: row[`${c}_draw`], away: row[`${c}_away`] })),
    credit: await credit(read),
  });
}

export function createArchiveDetailRoute(read) {
  return async (req, path, params) => (path === "/api/archives/details" ? details(req, params, read) : null);
}

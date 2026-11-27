/**
 * GET /api/league-history?competition={PitchAPI league key}&season=YYYY/YYYY — an archived season (2010/11–2020/21) of
 * one of the five big leagues, for the competition page (164; logic in ../league-history.mjs):
 * - standings: the table computed from the archived results, each row coloured by what the club did the next season;
 * - matchdays: the matches by matchday (or by month when the archive gives no round);
 * - players: from 2012/13 each player's league season (Transfermarkt datasets, CC0: matches, minutes, goals,
 *   assists); before, the scorers of the archived goals;
 * - summary: champion, top scorer, goals per match, relegated clubs.
 * 404 for a league or season outside that range, or a season the base does not hold.
 *
 * The validator (docs/calculs/09-audit-2026-11/FAILURE_MODES_OPTIMISATIONS.md, GH137): every request runs one statement,
 * one snapshot. It runs the four reads once and gives the SHA-256 of their rows' text (`digest`); the ETag names the
 * representation's version, the league and the season (`resource`), then that digest. The digests the request holds for
 * this resource (If-None-Match, read by http.mjs's parser), and whether it sent '*', are the statement's parameters: it
 * gives the rows only for an answer to send, a GET none of whose tags is the digest. Otherwise 304, or a HEAD's 200
 * without body, and nothing is built. The reads always run: a revalidation spares their rows' transfer, the answer's
 * building and its hash, not the reads.
 */
import { createHash } from "node:crypto";
import { entityTags, reject, send, validateParams } from "../http.mjs";
import { clubName, editionKeys, historySeason, HISTORY_LEAGUES, matchdays, playersIncomplete, standings, summary, zones, fold } from "../league-history.mjs";
import { CODE_DIGEST } from "../data-versions.mjs";

const PLAYERS_FROM = 2012;
const CREDITS = {
  appearances: { name: "transfermarkt-datasets", url: "https://github.com/dcaribou/transfermarkt-datasets", license: "CC0-1.0" },
};
// What builds the answer from the rows: the read API's release (VEGA_RELEASE, its package's SHA-256, api.yaml), else a
// code digest (a local run, the tests), and the runtime (collation, Unicode). Another release, another
// validator: a kept answer built by other code is never said unchanged.
const REPRESENTATION = createHash("sha256")
  .update(JSON.stringify(["league-history-v2", process.env.VEGA_RELEASE || CODE_DIGEST, process.version]))
  .digest("hex");
// The tag: the representation and the resource (16 hexadecimal characters), then the digest, so that the digests a
// request holds for this resource can be read back from its tags.
const resource = (league, start) => createHash("sha256").update(JSON.stringify([REPRESENTATION, league, start])).digest("hex").slice(0, 16);
const tagOf = (prefix, digest) => `W/"league-history-v2-${prefix}-${digest}"`;
function heldDigests(header, prefix) {
  const held = entityTags(header);
  const mine = new RegExp(`^"league-history-v2-${prefix}-([a-f0-9]{64})"$`);
  return { any: Boolean(held?.any), digests: (held?.tags || []).map((tag) => mine.exec(tag)?.[1]).filter(Boolean) };
}

// The four reads, each once, in one statement (one snapshot).
const reads = (start) => `WITH edition AS MATERIALIZED (SELECT key FROM api.league_history_edition($1::text[],$2::smallint)),
matches AS MATERIALIZED (SELECT m.* FROM edition e CROSS JOIN LATERAL api.league_history_matches(e.key,$2::smallint) WITH ORDINALITY m),
next AS MATERIALIZED (SELECT n.* FROM api.league_history_next($3,$4::text[],$5::smallint) n),
people AS MATERIALIZED (SELECT p.* FROM ${start >= PLAYERS_FROM ? "api.league_history_players($3,$2::smallint) p" : "edition e CROSS JOIN LATERAL api.league_history_scorers(e.key,$2::smallint) p"})`;
// The digest: each row as PostgreSQL writes it (its record text), the lists in an order they alone decide (the matches
// in the function's, the archive's order; the others sorted), in one JSON array: no two different reads give the same
// text. On a local archive, hashing the rows' text adds about a third to the reads' own time; building them as JSON, as
// an answer needs, more than doubles it.
const DIGEST = `encode(sha256(convert_to(json_build_array(e.key,
 (SELECT json_agg(x::text ORDER BY x.ordinality) FROM matches x),
 (SELECT json_agg(x::text ORDER BY x::text COLLATE "C") FROM next x),
 (SELECT json_agg(x::text ORDER BY x::text COLLATE "C") FROM people x))::text,'UTF8')),'hex')`;
// The statement: the digest once, then the rows, in the digest's order, only when the answer is to be sent ($8 a GET,
// $7 not '*', $6 the request's digests, none of them this one). No edition: no row (404).
const seasonSql = (start) => `/*vega:v2:league-history*/
${reads(start)},
checked AS MATERIALIZED (SELECT e.key,${DIGEST} digest FROM edition e),
held AS (SELECT d.*,($8::boolean AND NOT $7::boolean AND NOT d.digest=ANY($6::text[])) answer FROM checked d)
SELECT h.key,h.digest,h.answer,
 CASE WHEN h.answer THEN (SELECT coalesce(jsonb_agg(to_jsonb(x)-'ordinality' ORDER BY x.ordinality),'[]') FROM matches x) END matches,
 CASE WHEN h.answer THEN (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x::text COLLATE "C"),'[]') FROM next x) END next,
 CASE WHEN h.answer THEN (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x::text COLLATE "C"),'[]') FROM people x) END people
FROM held h`;

const day = (value) => (value ? String(value instanceof Date ? value.toISOString() : value).slice(0, 10) : null);
// A side: the club as the site shows it, with its spelling in the archive (`names`) to match it across editions.
const team = (key, id, name, image, source) => ({ key: String(key ?? fold(name)), id: id ?? null, name, imageUrl: image ?? null, names: source ? [source] : [] });
const out = (t) => ({ id: t.id, name: t.name, imageUrl: t.imageUrl });

async function season(req, params, read) {
  validateParams(params, ["competition", "season"]);
  const league = params.get("competition") || "";
  const start = historySeason(league, params.get("season"));
  if (start == null) reject(404, "Ressource introuvable.");
  const prefix = resource(league, start),
    held = heldDigests(req.headers.get("if-none-match"), prefix);
  const values = [editionKeys(league, start), start, league, start + 1 <= 2020 ? editionKeys(league, start + 1) : [], start + 1,
    held.digests, held.any, req.method !== "HEAD"];
  const [edition] = await read(seasonSql(start), values);
  if (!edition) reject(404, "Ressource introuvable.");
  const etag = tagOf(prefix, edition.digest);
  // Held ('*' or this digest): 304; a HEAD: 200 without body (send compares the request's tags with this one).
  if (!edition.answer) return send(req, null, 200, { etag, ttl: 3600 });
  const { matches: rows, next: nextRows, people: players } = edition;
  const matches = rows.map((r) => ({
    date: day(r.match_date), round: r.round ?? null,
    home: team(r.home_key, r.home_id, r.home_name, r.home_image, r.home_source), away: team(r.away_key, r.away_id, r.away_name, r.away_image, r.away_source),
    homeScore: r.home_score ?? null, awayScore: r.away_score ?? null,
  }));
  // The next season by club: its id when the site holds it, its archive row, its names as clubName agrees on them.
  const next = { league: new Set(), cl: new Set(), el: new Set(), ecl: new Set() };
  for (const r of nextRows) {
    const set = next[r.kind];
    if (!set) continue;
    set.add(String(r.team_key));
    if (r.public_id) set.add(r.public_id);
    for (const name of [r.name, r.source_name]) if (clubName(name)) set.add(clubName(name));
  }
  const table = zones(standings(matches, { league, start }), { league, start, next });
  const appearances = start >= PLAYERS_FROM;
  const people = players
    .map((p) => (appearances
      ? { id: p.player_id ?? null, name: p.name, imageUrl: p.image_url ?? null, club: { id: p.team_id ?? null, name: p.club_name, imageUrl: p.team_image ?? null },
          matches: p.matches, minutes: p.minutes, goals: p.goals, assists: p.assists }
      : { id: null, name: p.name, imageUrl: null, club: { id: p.team_id ?? null, name: p.team_name, imageUrl: p.team_image ?? null }, goals: p.goals }))
    .sort((a, b) => b.goals - a.goals || (b.assists ?? 0) - (a.assists ?? 0) || (a.minutes ?? 0) - (b.minutes ?? 0) || a.name.localeCompare(b.name));
  const s = summary(table, matches, people);
  const matchGoals = matches.reduce((n, m) => n + (m.homeScore ?? 0) + (m.awayScore ?? 0), 0);
  const incomplete = appearances && people.length > 0 && playersIncomplete(people.reduce((n, p) => n + p.goals, 0), matchGoals);
  const data = {
    competition: league, name: HISTORY_LEAGUES[league].name, season: `${start}/${start + 1}`, edition: edition.key,
    standings: table.map((r) => ({
      rank: r.rank, team: out(r.team), played: r.played, wins: r.wins, draws: r.draws, losses: r.losses,
      goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, points: r.points, ...(r.deduction ? { deduction: r.deduction } : {}), zone: r.zone,
    })),
    matchdays: matchdays(matches).map((g) => ({
      ...(g.number != null ? { number: g.number } : { month: g.month }),
      matches: g.matches.map((m) => ({ date: m.date, home: out(m.home), away: out(m.away), score: m.homeScore == null || m.awayScore == null ? null : [m.homeScore, m.awayScore] })),
    })),
    players: { kind: appearances ? "appearances" : "scorers", rows: people, ...(appearances ? { source: CREDITS.appearances, incomplete } : {}) },
    summary: {
      champion: s.champion && { team: out(s.champion.team), points: s.champion.points },
      topScorer: s.topScorer, goalsPerMatch: s.goalsPerMatch, relegated: s.relegated.map(out),
    },
  };
  return send(req, { data }, 200, { etag, ttl: 3600 });
}

export function createLeagueHistoryRoute(read) {
  return async (req, path, params) => (path === "/api/league-history" ? season(req, params, read) : null);
}

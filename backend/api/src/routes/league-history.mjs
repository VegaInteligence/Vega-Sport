/**
 * GET /api/league-history?competition={PitchAPI league key}&season=YYYY/YYYY — an archived season (2010/11–2020/21) of
 * one of the five big leagues, for the competition page (164; logic in ../league-history.mjs):
 * - standings: the table computed from the archived results, each row coloured by what the club did the next season;
 * - matchdays: the matches by matchday (or by month when the archive gives no round);
 * - players: from 2012/13 each player's league season (Transfermarkt datasets, CC0: matches, minutes, goals,
 *   assists); before, the scorers of the archived goals;
 * - summary: champion, top scorer, goals per match, relegated clubs.
 * 404 for a league or season outside that range, or a season the base does not hold.
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";
import { editionKeys, historySeason, HISTORY_LEAGUES, matchdays, playersIncomplete, standings, summary, zones, fold } from "../league-history.mjs";

const PLAYERS_FROM = 2012;
const CREDITS = {
  appearances: { name: "transfermarkt-datasets", url: "https://github.com/dcaribou/transfermarkt-datasets", license: "CC0-1.0" },
};

function respond(req, data) {
  const etag = `W/"league-history-v1-${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl: 3600 });
  return send(req, { data }, 200, { etag, ttl: 3600 });
}

const day = (value) => (value ? String(value instanceof Date ? value.toISOString() : value).slice(0, 10) : null);
const team = (key, id, name, image) => ({ key: String(key ?? fold(name)), id: id ?? null, name, imageUrl: image ?? null });
const out = (t) => ({ id: t.id, name: t.name, imageUrl: t.imageUrl });

async function season(req, params, read) {
  validateParams(params, ["competition", "season"]);
  const league = params.get("competition") || "";
  const start = historySeason(league, params.get("season"));
  if (start == null) reject(404, "Ressource introuvable.");
  const [edition] = await read("SELECT key, matches FROM api.league_history_edition($1::text[], $2::smallint)", [editionKeys(league, start), start]);
  if (!edition) reject(404, "Ressource introuvable.");
  const nextKeys = start + 1 <= 2020 ? editionKeys(league, start + 1) : [];
  const [rows, nextRows, players] = await Promise.all([
    read("SELECT * FROM api.league_history_matches($1, $2::smallint)", [edition.key, start]),
    read("SELECT kind, team_key, public_id, name FROM api.league_history_next($1, $2::text[], $3::smallint)", [league, nextKeys, start + 1]),
    start >= PLAYERS_FROM
      ? read("SELECT * FROM api.league_history_players($1, $2::smallint)", [league, start])
      : read("SELECT * FROM api.league_history_scorers($1, $2::smallint)", [edition.key, start]),
  ]);
  const matches = rows.map((r) => ({
    date: day(r.match_date), round: r.round ?? null,
    home: team(r.home_key, r.home_id, r.home_name, r.home_image), away: team(r.away_key, r.away_id, r.away_name, r.away_image),
    homeScore: r.home_score ?? null, awayScore: r.away_score ?? null,
  }));
  // The next season by club: its id when the site holds it, its archive row, its name (folded).
  const next = { league: new Set(), cl: new Set(), el: new Set(), ecl: new Set() };
  for (const r of nextRows) {
    const set = next[r.kind];
    if (!set) continue;
    set.add(String(r.team_key));
    if (r.public_id) set.add(r.public_id);
    set.add(fold(r.name));
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
  return respond(req, {
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
  });
}

export function createLeagueHistoryRoute(read) {
  return async (req, path, params) => (path === "/api/league-history" ? season(req, params, read) : null);
}

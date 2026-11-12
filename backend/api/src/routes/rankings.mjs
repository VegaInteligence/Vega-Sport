/**
 * The ranking catalogue of main (relational-catalog.js): /api/rankings/index,
 * /api/rankings/edition, /api/rankings/associations, /api/rankings/club and
 * /api/club-links, same parameters and bodies, read from api.ranking_editions,
 * api.ranking_entries, api.ranking_season_points and api.club_links (026).
 *
 * Differences with the legacy read, by construction (typed tables only):
 * `sourceRow` keeps only the facts the site reads (a UEFA row's overall and per-season
 * points and clubs still in competition), not the provider's whole record; editions carry
 * no file path or checksum; `quality.duplicateEntityIds` is empty (one row per entity).
 * An edition is keyed by what it covers, never by its source (030_neutral_reads.sql): the
 * season's ending year for the UEFA coefficients ("2026", legacy "2026.uefa"), the
 * publication date otherwise ("2025-09-18", legacy "2025-09-18.fifa"); when two sources
 * hold the same edition the official one is served. `kind` names the ranking itself (the
 * UEFA coefficients, the FIFA ranking), whoever supplies it; the supplier stays in the
 * body's `provider`.
 *
 * GET /api/rankings/power?kind=players|clubs|nations&season=&limit= — Vega's power
 * rankings (docs/METHODE_CLASSEMENT_BALLON_D_OR.md on main, vega/power.py): players by
 * their standardised index, the ranked players of a top division (the site's
 * `ballonDorRanking(season)` entries), clubs and national teams by their Elo strength
 * after their last match of the season.
 *
 * GET /api/rankings/leagues — the league strength index: each league's level on the
 * Elo's scale, its rank among the leagues on the common scale, and its level at the end
 * of each season.
 *
 * GET /api/forecasts/match?match= — the forecast of a match still to play (vega/forecast.py,
 * from the two Elo strengths): win, draw, loss, expected goals and the likeliest score.
 * GET /api/forecasts/live?match= — a finished or running match minute by minute: win, draw
 * and loss from the forecast, the score, the clock and the dismissals (vega/inplay.py).
 * GET /api/forecasts/season?competition=&season= — a league replayed to its end: each
 * club's points now and projected, the share of the replays it finishes at each place, and
 * `next`, its coming league matches (the opponents' mean strength, the points forecast).
 *
 * GET /api/rankings/breakouts?season= — the season's breakouts: players below the ranking's
 * minutes whose rate per 90 minutes is among the best of their role's regulars.
 *
 * GET /api/rankings/power/player?season=&player= — one player's power ranking of a
 * season, for his page: the object of the player reads (powerOf) and `roleCount`, the
 * number of ranked players of his role.
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";
import { rates as inplayRates, timeline as inplayTimeline } from "../inplay.mjs";

const TEAM = /^t_(?:[A-Za-z0-9]{6}|v\d{7})$/;
const PLAYER = /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/;
const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);

function validate(p, spec) {
  validateParams(p, Object.keys(spec));
  for (const [k, v] of p) if (!spec[k].test(v)) reject(400, "Paramètre invalide.");
  if (Object.keys(spec).some((k) => !p.has(k))) reject(400, "Paramètre manquant.");
  return Object.fromEntries(p);
}

function respond(req, body) {
  const etag = `W/"catalog-v1-${createHash("sha256").update(JSON.stringify(body)).digest("hex")}"`;
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl: 60 });
  return send(req, body, 200, { etag, ttl: 60 });
}

export const indexEdition = (e) => ({
  edition: e.edition,
  kind: e.kind,
  officialEdition: e.official_edition,
  period: e.period,
  provider: e.provider,
  retrievedAt: iso(e.retrieved_at),
  rows: e.rows,
  sourceUpdatedAt: iso(e.source_updated_at) ?? (e.published_on || null),
  sourceUrl: e.source_url,
});

export function rankingRow(kind, r, seasons = []) {
  const row = {
    entityId: `${kind.startsWith("uefa") ? "uefa" : "fifa"}:${r.provider_key}`,
    entityName: r.entity_name,
    countryCode: r.country_code ?? null,
    position: r.position,
    points: r.points,
    ...(kind.startsWith("uefa") && { earnedPoints: r.earned_points }),
    previousPosition: r.previous_position ?? null,
    imageUrl: r.image_url ?? null,
    ...(kind === "fifa-men" && { confederation: r.confederation ?? null }),
  };
  if (kind.startsWith("uefa"))
    row.sourceRow = {
      overallRanking: { numberOfTeamsStillInPlaying: r.teams_still_playing ?? null },
      seasonRankings: seasons.map((s) => ({
        seasonYear: s.season_year,
        totalPoints: s.points,
        nationalAssociationPoints: s.association_points,
        numberOfTeamsStillInPlaying: s.teams_still_playing,
      })),
    };
  return row;
}

async function editionBody(read, kind, edition) {
  const [e] = await read("SELECT * FROM api.ranking_editions WHERE kind=$1 AND edition=$2", [kind, edition]);
  if (!e) reject(404, "Donnée indisponible.");
  const [rows, seasons] = await Promise.all([
    read("SELECT * FROM api.ranking_entries WHERE edition_id=$1 ORDER BY row_no", [e.edition_id]),
    read("SELECT * FROM api.ranking_season_points WHERE edition_id=$1 ORDER BY row_no,season_year DESC", [e.edition_id]),
  ]);
  const byRow = new Map();
  for (const s of seasons) byRow.set(s.row_no, [...(byRow.get(s.row_no) || []), s]);
  return {
    kind: e.kind,
    edition: e.edition,
    provider: e.provider,
    sourceUrl: e.source_url,
    retrievedAt: iso(e.retrieved_at),
    sourceUpdatedAt: iso(e.source_updated_at) ?? (e.published_on || null),
    period: e.period,
    officialEdition: e.official_edition,
    quality: { duplicateEntityIds: [] },
    rows: rows.map((r) => rankingRow(e.kind, r, byRow.get(r.row_no) || [])),
  };
}

export const ROLE_LABEL = {
  centre_forward: "Avant-centre", winger: "Ailier / milieu offensif", central_midfielder: "Milieu central",
  defensive_midfielder: "Milieu défensif", full_back: "Latéral / piston", centre_back: "Défenseur central", goalkeeper: "Gardien",
};
const round = (v, d) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);
const BLOCKS = { finishing: "finishing", creation: "creation", progression: "progression", defence: "defence", retention: "retention",
  shot_stopping: "shotStopping", aerial: "aerial", depth: "depth", distribution: "distribution" };

/** A player's season by block (§§ 6, 8): its share of T and its percentile within the role. */
function blocksOf(r) {
  const out = {};
  for (const [column, key] of Object.entries(BLOCKS))
    if (r[column + "_total"] != null || r[column + "_percentile"] != null)
      out[key] = { contribution: round(r[column + "_total"], 2), percentile: round(r[column + "_percentile"], 1) };
  return out;
}

/** A club's season in Elo terms (§ 3). */
const clubSeason = (r) => ({
  eloStart: round(r.elo_start, 1), eloPeak: round(r.elo_peak, 1), eloLow: round(r.elo_low, 1),
  wins: r.wins ?? null, draws: r.draws ?? null, losses: r.losses ?? null,
  results: round(r.result_sum, 1), expectedResults: round(r.expected_sum, 2),
});

// The power views by their keys (064): a season by its id, players and clubs by their
// internal ids, which the tables index. Filtered on the public ids, a view computed them
// for every row of the season first.
const SEASON_KEY = "(SELECT k.season_id FROM api.season_keys k WHERE k.season=$1)";
const keysOf = (kind) => `ARRAY(SELECT api.internal_id('${kind}',k) FROM unnest($2::text[]) k)`;

/** Each role a player played in the season (§ 8), most played first. */
async function rolesOf(read, season, ids) {
  const out = new Map();
  if (!ids.length) return out;
  for (const r of await read(`SELECT * FROM api.power_player_roles WHERE season_id=${SEASON_KEY} AND player_key=ANY(${keysOf("player")}) ORDER BY minutes DESC, role`, [season, ids])) {
    if (!out.has(r.player_id)) out.set(r.player_id, []);
    out.get(r.player_id).push({ role: r.role, position: ROLE_LABEL[r.role] ?? r.role, matches: r.matches, minutes: r.minutes,
      contribution: round(r.total, 2), rate: round(r.rate, 3) });
  }
  return out;
}

/**
 * The power ranking of each club or player of a page, for one season (the club and
 * player reads carry it): clubs { rank, elo, eloChange, matches, and the season in Elo
 * terms }, players { rank, score, role, position, roleRank, blocks, roles }. A club or
 * player without one (not ranked) has none.
 */
export async function powerOf(read, kind, season, ids) {
  const out = new Map();
  if (!season || !ids.length) return out;
  if (kind === "clubs") {
    for (const r of await read(`SELECT * FROM api.power_clubs WHERE season_id=${SEASON_KEY} AND scope='clubs' AND team_key=ANY(${keysOf("team")})`, [season, ids]))
      out.set(r.team_id, { rank: r.rank, elo: round(r.elo, 1), eloChange: round(r.elo_change, 1), matches: r.matches, ...clubSeason(r) });
  } else {
    const rows = await read(`SELECT * FROM api.power_players WHERE season_id=${SEASON_KEY} AND player_key=ANY(${keysOf("player")})`, [season, ids]);
    const roles = await rolesOf(read, season, rows.map((r) => r.player_id));
    for (const r of rows)
      out.set(r.player_id, {
        rank: r.rank, score: round(r.score, 1), index: round(r.index, 2), role: r.role, position: ROLE_LABEL[r.role] ?? r.role, roleRank: r.role_rank,
        ownContribution: round(r.own_total, 2), clubLevel: round(r.level_total, 2), linked: r.linked !== false, topDivision: r.top_division !== false,
        blocks: blocksOf(r), roles: roles.get(r.player_id) ?? [],
      });
  }
  return out;
}

async function leagueLevels(read, params) {
  validateParams(params, []);
  const [rows, seasons] = await Promise.all([
    read("SELECT * FROM api.league_levels ORDER BY competition_id"),
    read("SELECT competition_key, season, level, teams FROM api.league_level_seasons ORDER BY competition_key, season_id"),
  ]);
  if (!rows.length) reject(404, "Donnée indisponible.");
  const history = new Map();
  for (const s of seasons) {
    if (!history.has(s.competition_key)) history.set(s.competition_key, []);
    history.get(s.competition_key).push({ season: s.season, level: round(s.level, 1), teams: s.teams });
  }
  // The level shown is that of the league's last season (the clubs that play it now); the
  // Elo's own level, over every club that started in the league, decides the common scale.
  const leagues = rows.map((r) => {
    const own = history.get(r.competition_key) ?? [];
    return { id: r.competition_id, name: r.name, country: r.country ?? null, level: own.at(-1)?.level ?? round(r.level, 1),
      onScale: r.linked, teams: own.at(-1)?.teams ?? r.teams, links: r.links, seasons: own };
  }).sort((a, b) => Number(b.onScale) - Number(a.onScale) || b.level - a.level || a.id.localeCompare(b.id));
  let rank = 0;
  return {
    method: { version: rows[0].method_version, computedAt: iso(rows[0].computed_at) },
    onScale: leagues.filter((l) => l.onScale).length,
    // A league off the common scale has a level of its own, which says nothing against the others: no rank.
    leagues: leagues.map(({ id, name, country, level, onScale, teams, links, seasons: own }) => (
      { id, name, country, level, rank: onScale ? ++rank : null, onScale, teams, links, seasons: own })),
  };
}

const MATCH = /^m_(?:[A-Za-z0-9]{6}|v\d{7})$/, LEAGUE = /^l_(?:[A-Za-z0-9]{6}|v\d{7})$/;

async function matchForecast(read, params) {
  validateParams(params, ["match"]);
  const id = params.get("match");
  if (!MATCH.test(id || "")) reject(400, "Paramètre invalide.");
  const [r] = await read("SELECT * FROM api.match_forecasts WHERE match_key=api.internal_id('match',$1)", [id]);
  if (!r) reject(404, "Donnée indisponible.");
  return {
    match: id,
    forecast: { home: round(r.home_win, 4), draw: round(r.draw, 4), away: round(r.away_win, 4),
      homeGoals: round(r.home_goals, 2), awayGoals: round(r.away_goals, 2), score: [r.likely_home, r.likely_away] },
    model: { version: r.model_version, fittedAt: iso(r.fitted_at), matches: r.model_matches },
  };
}

/**
 * A match minute by minute: win, draw and loss from the forecast's expected goals, the
 * score, the clock and the dismissals (src/inplay.mjs). A finished match runs to the 90th
 * minute, where its last point is its result; a match in play stops at its clock.
 */
async function liveProbability(read, params) {
  validateParams(params, ["match"]);
  const id = params.get("match");
  if (!MATCH.test(id || "")) reject(400, "Paramètre invalide.");
  const [s] = await read("SELECT * FROM api.match_strengths WHERE match_key=api.internal_id('match',$1)", [id]);
  if (!s || s.home_elo === null || s.away_elo === null || !["finished", "in_play"].includes(s.status)) reject(404, "Donnée indisponible.");
  const at = [s.season_id, s.match_key];
  const [[forecast], [model], events, [clock]] = await Promise.all([
    read("SELECT * FROM api.forecast_models ORDER BY fitted_at DESC, id DESC LIMIT 1"),
    read("SELECT * FROM api.inplay_models ORDER BY fitted_at DESC, id DESC LIMIT 1"),
    read("SELECT kind, minute, minute_added AS added, side FROM api.match_inplay_events WHERE season_id=$1 AND match_key=$2 AND side IS NOT NULL ORDER BY seq", at),
    read("SELECT minute FROM api.match_clocks WHERE season_id=$1 AND match_key=$2", at),
  ]);
  if (!forecast || !model) reject(404, "Donnée indisponible.");
  const finished = s.status === "finished";
  const goals = (side) => events.filter((e) => e.kind === "goal" && e.side === side).length;
  // A finished match whose goal events do not give its score has no timeline to show.
  if (finished && (goals("home") !== s.home_score || goals("away") !== s.away_score)) reject(404, "Donnée indisponible.");
  const seen = Math.max(clock?.minute ?? 0, ...events.map((e) => e.minute), 0);
  const last = finished ? 90 : Math.max(0, Math.min(90, Math.floor(seen)));
  const [rateHome, rateAway] = inplayRates(forecast, s.home_elo, s.away_elo, s.neutral);
  const inplay = { profile: [model.q1, model.q2, model.q3, model.q4, model.q5, model.q6, model.after_90], down: model.down, up: model.up };
  const points = inplayTimeline(rateHome, rateAway, events, inplay, forecast.rho, last);
  if (finished) {
    const end = points.at(-1), [h, a] = end.score;
    Object.assign(end, { home: h > a ? 1 : 0, draw: h === a ? 1 : 0, away: h < a ? 1 : 0 });
  }
  return {
    match: id, status: s.status,
    rates: { home: round(rateHome, 2), away: round(rateAway, 2) },
    model: { version: model.version, fittedAt: iso(model.fitted_at), matches: model.matches },
    points: points.map((p) => ({ minute: p.minute, home: round(p.home, 4), draw: round(p.draw, 4), away: round(p.away, 4), score: p.score })),
    events: events.map((e) => ({ minute: e.minute, added: e.added, kind: e.kind, side: e.side })),
  };
}

async function seasonProjection(read, params) {
  validateParams(params, ["competition", "season"]);
  const competition = params.get("competition"), season = params.get("season");
  if (!LEAGUE.test(competition || "") || !/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
  const [edition] = await read("SELECT competition_season_id FROM api.edition_keys WHERE league_id=$1 AND season=$2 ORDER BY competition_season_id DESC LIMIT 1", [competition, season]);
  if (!edition) reject(404, "Donnée indisponible.");
  const [teams, places, fixtures] = await Promise.all([
    read("SELECT * FROM api.season_projections WHERE competition_season_id=$1 ORDER BY projected_points DESC, name", [edition.competition_season_id]),
    read("SELECT team_key, place, probability FROM api.season_projection_places WHERE competition_season_id=$1", [edition.competition_season_id]),
    read("SELECT * FROM api.schedule_forecasts WHERE competition_season_id=$1 ORDER BY kickoff_at NULLS LAST, match_key", [edition.competition_season_id]),
  ]);
  if (!teams.length) reject(404, "Donnée indisponible.");
  const next = comingMatches(fixtures);
  // One share per place, 0 for a place the club never reached.
  const shares = new Map(teams.map((team) => [team.team_key, Array(teams.length).fill(0)]));
  for (const p of places) if (shares.has(p.team_key) && p.place <= teams.length) shares.get(p.team_key)[p.place - 1] = round(p.probability, 4);
  return {
    competition, season,
    model: { version: teams[0].model_version, fittedAt: iso(teams[0].fitted_at), replays: teams[0].simulations },
    teams: teams.map((team) => ({ id: team.team_id, name: team.name, imageUrl: team.image_url ?? null, played: team.played, points: team.points,
      projectedPoints: round(team.projected_points, 1), places: shares.get(team.team_key), next: next.get(team.team_key) ?? null })),
  };
}

const COMING = 5;

/**
 * Each club's next COMING league matches: how many, how many at home, the mean strength
 * of the opponents (their Elo before the match), the points the forecasts give it, and
 * `rank`, 1 for the hardest run of opponents among the clubs with as many matches ahead.
 */
export function comingMatches(fixtures, count = COMING) {
  const runs = new Map();
  const add = (team, home, opponent, win, draw) => {
    const run = runs.get(team) ?? runs.set(team, { matches: 0, home: 0, level: 0, points: 0 }).get(team);
    if (run.matches >= count) return;
    run.matches++;
    run.home += home ? 1 : 0;
    run.level += opponent;
    run.points += 3 * win + draw;
  };
  for (const f of fixtures) {
    add(f.home_key, true, f.away_elo, f.home_win, f.draw);
    add(f.away_key, false, f.home_elo, f.away_win, f.draw);
  }
  const full = [...runs.values()].filter((run) => run.matches === count).map((run) => run.level).sort((a, b) => b - a);
  return new Map([...runs].map(([team, run]) => [team, {
    matches: run.matches, home: run.home, opponentLevel: Math.round(run.level / run.matches), expectedPoints: round(run.points, 1),
    rank: run.matches === count ? full.indexOf(run.level) + 1 : null,
  }]));
}

const BREAKOUTS_SHOWN = 30;
const breakoutOf = (r) => ({ rank: r.rank, minutes: r.minutes, percentile: round(r.percentile, 1), regulars: r.regulars, role: r.role, position: ROLE_LABEL[r.role] ?? r.role });

/**
 * The season's players below the ranking's minutes who already play like its regulars
 * (vega/breakout.py): the first BREAKOUTS_SHOWN, each with the share of his role's
 * regulars his rate per 90 minutes is ahead of.
 */
async function breakouts(read, params) {
  validateParams(params, ["season"]);
  const season = params.get("season");
  if (!/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
  const [run] = await read(`SELECT * FROM api.breakout_runs WHERE season_id=${SEASON_KEY}`, [season]);
  if (!run) reject(404, "Donnée indisponible.");
  const rows = await read(`SELECT * FROM api.player_breakouts WHERE season_id=${SEASON_KEY} ORDER BY rank LIMIT ${BREAKOUTS_SHOWN}`, [season]);
  return {
    season, computedAt: iso(run.computed_at), candidates: run.candidates, flagged: run.flagged,
    rows: rows.map((r) => ({ ...breakoutOf(r), playerId: r.player_id, name: r.name, imageUrl: r.image_url ?? null,
      teamId: r.team_id ?? null, team: r.team ?? null, teamImageUrl: r.team_image_url ?? null })),
  };
}

async function powerPlayer(read, params) {
  validateParams(params, ["season", "player"]);
  const season = params.get("season"), id = params.get("player");
  if (!/^\d{4}\/\d{4}$/.test(season || "") || !PLAYER.test(id || "")) reject(400, "Paramètre invalide.");
  const [power, [flag]] = await Promise.all([
    powerOf(read, "players", season, [id]).then((found) => found.get(id)),
    read(`SELECT * FROM api.player_breakouts WHERE season_id=${SEASON_KEY} AND player_key=api.internal_id('player',$2)`, [season, id]),
  ]);
  // A player below the ranking's minutes has no ranking of his own, but may be flagged as a breakout.
  if (!power && !flag) reject(404, "Donnée indisponible.");
  const breakout = flag ? breakoutOf(flag) : null;
  if (!power) return { season, player: { id, breakout } };
  const [count] = await read(`SELECT ranked FROM api.power_role_counts WHERE season_id=${SEASON_KEY} AND role=$2`, [season, power.role]);
  return { season, player: { id, ...power, roleCount: count?.ranked ?? null, breakout } };
}

async function powerRanking(read, params) {
  validateParams(params, ["kind", "season", "limit"]);
  const kind = params.get("kind") ?? "players", season = params.get("season"), limitRaw = params.get("limit") ?? "30";
  if (!/^(players|clubs|nations)$/.test(kind) || !/^\d{4}\/\d{4}$/.test(season || "") || !/^[1-9]\d{0,2}$/.test(limitRaw) || Number(limitRaw) > 200)
    reject(400, "Paramètre invalide.");
  const limit = Number(limitRaw);
  if (kind === "players") {
    // The award race: the ranked players of a top division, numbered in their order
    // (`powerRank` is the player's rank among every ranked player).
    const rows = await read(
      `SELECT * FROM api.power_players WHERE season_id=${SEASON_KEY} AND rank IS NOT NULL AND top_division ORDER BY rank, player_id LIMIT $2`,
      [season, limit],
    );
    if (!rows.length) reject(404, "Donnée indisponible.");
    const roles = await rolesOf(read, season, rows.map((r) => r.player_id));
    return {
      season, kind, method: { version: rows[0].method_version, computedAt: iso(rows[0].computed_at) },
      rows: rows.map((r, i) => ({
        rank: i + 1, playerId: r.player_id, name: r.name, imageUrl: r.image_url ?? null, teamId: r.team_id ?? null, team: r.team ?? null,
        teamImageUrl: r.team_image_url ?? null, position: ROLE_LABEL[r.role] ?? r.role, role: r.role, roleRank: r.role_rank, powerRank: r.rank,
        score: round(r.score, 1), index: round(r.index, 2), matches: r.matches, minutes: r.minutes,
        contribution: round(r.total, 2), ownContribution: round(r.own_total, 2), clubLevel: round(r.level_total, 2), rate: round(r.rate, 3),
        contributionPercentile: round(r.total_percentile, 1), ratePercentile: round(r.rate_percentile, 1),
        blocks: blocksOf(r), roles: roles.get(r.player_id) ?? [],
      })),
    };
  }
  const rows = await read(`SELECT * FROM api.power_clubs WHERE season_id=${SEASON_KEY} AND scope=$2 ORDER BY rank, team_id LIMIT $3`, [season, kind, limit]);
  if (!rows.length) reject(404, "Donnée indisponible.");
  return {
    season, kind, method: { version: rows[0].method_version, computedAt: iso(rows[0].computed_at) },
    rows: rows.map((r) => ({
      rank: r.rank, teamId: r.team_id, name: r.name, imageUrl: r.image_url ?? null, country: r.country ?? null,
      elo: round(r.elo, 1), eloChange: round(r.elo_change, 1), matches: r.matches, lastMatchAt: iso(r.last_match_at), ...clubSeason(r),
    })),
  };
}

export function createRankingRoute(read) {
  return async (req, path, params) => {
    if (path === "/api/rankings/power") return respond(req, await powerRanking(read, params));
    if (path === "/api/rankings/power/player") return respond(req, await powerPlayer(read, params));
    if (path === "/api/rankings/leagues") return respond(req, await leagueLevels(read, params));
    if (path === "/api/rankings/breakouts") return respond(req, await breakouts(read, params));
    if (path === "/api/forecasts/match") return respond(req, await matchForecast(read, params));
    if (path === "/api/forecasts/season") return respond(req, await seasonProjection(read, params));
    if (path === "/api/forecasts/live") return respond(req, await liveProbability(read, params));
    if (path === "/api/rankings/index") {
      validate(params, {});
      const [editions, [mapping]] = await Promise.all([
        read("SELECT * FROM api.ranking_editions ORDER BY kind DESC,edition DESC"),
        read("SELECT count(*)::int AS linked FROM api.club_links"),
      ]);
      const retrieved = editions.map((e) => iso(e.retrieved_at)).filter(Boolean).sort();
      return respond(req, {
        schemaVersion: 1,
        retrievedAt: retrieved.at(-1) ?? null,
        editions: editions.map(indexEdition),
        errors: [],
        notes: {
          "uefa-associations": "Association club coefficients, not national-team strength.",
          historicalDates: "UEFA period is a season ending year, not a known publication date. SportsAPI updatedAt is a source refresh timestamp, not an official edition date.",
        },
        clubMapping: { linked: mapping.linked },
      });
    }
    if (path === "/api/rankings/edition") {
      const p = validate(params, {
        kind: /^(uefa-clubs|uefa-associations|fifa-men)$/,
        edition: /^\d{4}(?:-\d{2}-\d{2})?$/,
      });
      return respond(req, await editionBody(read, p.kind, p.edition));
    }
    if (path === "/api/rankings/associations") {
      const p = validate(params, { year: /^\d{4}$/ });
      return respond(req, await editionBody(read, "uefa-associations", p.year));
    }
    if (path === "/api/rankings/club") {
      const p = validate(params, { club: TEAM });
      const [link] = await read("SELECT * FROM api.club_links WHERE team_id=$1", [p.club]);
      if (!link) return respond(req, { rows: null });
      const editions = await read("SELECT * FROM api.ranking_editions WHERE kind='uefa-clubs' AND provider='UEFA' ORDER BY edition DESC");
      const rows = await read(
        `SELECT r.* FROM api.ranking_entries r JOIN api.ranking_editions e ON e.edition_id=r.edition_id
         WHERE e.kind='uefa-clubs' AND r.internal_team_id=$1`,
        [link.internal_team_id],
      );
      const byEdition = new Map(rows.map((r) => [r.edition_id, r]));
      return respond(req, {
        rows: editions.map((e) => {
          const row = byEdition.get(e.edition_id);
          return { edition: indexEdition(e), row: row ? rankingRow("uefa-clubs", row) : null };
        }),
      });
    }
    if (path === "/api/club-links") {
      const p = validate(params, { club: TEAM });
      const [link] = await read("SELECT * FROM api.club_links WHERE team_id=$1", [p.club]);
      return respond(req, {
        links: link
          ? { [p.club]: { clubName: link.club_name, countryCode: link.country_code, entityId: link.entity_id, method: link.method, rankingName: link.ranking_name } }
          : {},
      });
    }
    return null;
  };
}

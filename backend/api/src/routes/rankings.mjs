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
 * GET /api/rankings/power?kind=players|clubs|nations&season=&limit=[&page= for nations] — Vega's power
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
 * from the two Elo strengths): win, draw, loss, expected goals and the likeliest score; and,
 * once both clubs have confirmed their eleven, `lineups`: the same forecast read with them.
 * GET /api/forecasts/live?match= — a finished or running match minute by minute: win, draw
 * and loss from the forecast (the one that read the line-ups when there is one), the score,
 * the clock and the dismissals (vega/inplay.py).
 * GET /api/forecasts/season?competition=&season= — a league replayed to its end: each
 * club's points now and projected, the share of the replays it finishes at each place, and
 * `next`, its coming league matches (the opponents' mean strength, the points forecast).
 * A UEFA cup of the league-phase format (122) gives each club `stages` too: its share of the
 * replays finishing the league phase in the first eight (top8), 9th to 24th (playoff) or below
 * (out), then reaching the round of 16, the quarter-finals, the semi-finals, the final, and
 * winning (r16, qf, sf, final, win); `format` is "league-phase".
 *
 * GET /api/forecasts/swap?season=&out=&in= — what a club's league results would become if
 * the player `in` played in the place of its player `out` (vega/lineup.py, 090): the gap
 * between their own rates, the Elo points it is worth and the expected points per match.
 * An estimate, for two outfield players of the same role.
 * GET /api/rankings/breakouts?season= — the season's breakouts: players below the ranking's
 * minutes whose rate per 90 minutes is among the best of their role's regulars.
 *
 * GET /api/rankings/match?match= — each player's grade in one match (vega/power.py, « Match
 * grades »): how exceptional the match was for his role, whatever his season, on the season's
 * 0–100 curve; ranked within the match among the grades shown (20 minutes or more, or a
 * match a full standard deviation from the ordinary), the minutes beside each. `grade`
 * keeps its tenth; `gradeExact` is the visible, finite grade read from the same SQL row.
 *
 * GET /api/rankings/power/player?season=&player= — one player's power ranking of a
 * season, for his page: the object of the player reads (powerOf) and `roleCount`, the
 * number of ranked players of his role.
 *
 * GET /api/rankings/level?season=&universe=&position=&limit=&page= — the players' level of a
 * season (Score Vega v9, vega/level.py, docs/calculs/10-score-vega-v9): how many Elo points a
 * club gains with the player, `own` (what he does at his positions and how often he starts)
 * and `club` (the level he plays at), and the score out of 100 on the level's curve. Read
 * beside the power ranking, which it does not change. `position` is one of nine: a winger
 * of the power ranking is a winger, an attacking midfielder or a wide midfielder. A rank is
 * provisional under the minutes bar, in a league whose level is not measured, or (v9.1) for a
 * keeper without goals prevented on half his minutes in goal (`provisionalReason`).
 * GET /api/rankings/level/player?season=&player= — one player's level with its parts and
 * each position he played: judged (its share, value and talents by block, in standard
 * deviations) or not (too few minutes over two seasons).
 *
 * GET /api/rankings/award?season=&limit=&page= — the Ballon d'Or race on the level (vega/award.py,
 * FAILURE_MODES §60, docs/calculs/10-score-vega-v9/04): the ranked players in their order, 30 a page
 * by default (200 at most), each with his score and the raw parts it is made of: `individual` and
 * `level` in Elo points, `collective` in honour points, `fairPlay` in card points per 90 (negative).
 * Read beside the power ranking's race, which it does not change.
 * GET /api/rankings/award/player?season=&player= — one player's race: his parts and their z, his
 * card points and covered minutes, his rank or the reason he is out of the race, and his honours.
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";
import { rates as inplayRates, timeline as inplayTimeline } from "../../../../dashboard/shared/inplay.js";
import { ownRate, replace as replacePlayer } from "../lineup.mjs";

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
const put = (o, k, v) => (v === null || v === undefined ? o : ((o[k] = v), o));
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
/** Why a player's rank is provisional, the first that holds: « minutes » (under the season's
 * bar), « national » (known by his national team alone), « no_league » (his club plays in no
 * league of the base), « league » (his league's level is still measured roughly); else null. */
export function provisionalReason(r) {
  if (r.eligible === false) return "minutes";
  if (r.universe === "women" || r.linked !== false) return null;
  if (r.team_is_national) return "national";
  if (r.in_league === false) return "no_league";
  return "league";
}

/**
 * A club's or a league's score out of 100: its expected score (a draw counting half) on
 * neutral ground against the scale's reference, the mean level of the measured men's top
 * divisions (every men's league while none is measured). The Elo's own form: 50 at the
 * reference, 76 at 200 points above it, 91 at 400.
 */
export const outOf100 = (elo, reference) => (elo == null || reference == null ? null : round(100 / (1 + 10 ** (-(elo - reference) / 400)), 1));
const REFERENCE_LEVEL = `SELECT coalesce(
    (SELECT avg(level) FROM api.league_levels WHERE universe = 'men' AND linked AND coalesce(tier, 1) = 1),
    (SELECT avg(level) FROM api.league_levels WHERE universe = 'men'))::float8 AS level`;
const referenceLevel = async (read) => (await read(REFERENCE_LEVEL))[0]?.level ?? null;

export async function powerOf(read, kind, season, ids) {
  const out = new Map();
  if (!season || !ids.length) return out;
  if (kind === "clubs") {
    const [rows, reference] = await Promise.all([
      read(`SELECT * FROM api.power_clubs WHERE season_id=${SEASON_KEY} AND scope='clubs' AND team_key=ANY(${keysOf("team")})`, [season, ids]),
      referenceLevel(read),
    ]);
    for (const r of rows)
      out.set(r.team_id, { rank: r.rank, score: outOf100(r.elo, reference), elo: round(r.elo, 1), eloChange: round(r.elo_change, 1), matches: r.matches, ...clubSeason(r) });
  } else {
    const rows = await read(`SELECT * FROM api.power_players WHERE season_id=${SEASON_KEY} AND player_key=ANY(${keysOf("player")})`, [season, ids]);
    const roles = await rolesOf(read, season, rows.map((r) => r.player_id));
    for (const r of rows)
      out.set(r.player_id, {
        rank: r.rank, score: round(r.score, 1), index: round(r.index, 2), role: r.role, position: ROLE_LABEL[r.role] ?? r.role, roleRank: r.role_rank,
        ownContribution: round(r.own_total, 2), clubLevel: round(r.level_total, 2), linked: r.linked !== false, topDivision: r.top_division !== false,
        // A provisional rank: under the minutes bar, in a league whose level is still uncertain, in a
        // club the base knows in no league, or known by his national team alone (provisionalReason).
        eligible: r.eligible !== false, provisional: provisionalReason(r) !== null,
        universe: r.universe ?? "men", inLeague: r.in_league ?? null, provisionalReason: provisionalReason(r),
        blocks: blocksOf(r), roles: roles.get(r.player_id) ?? [],
      });
  }
  return out;
}

async function leagueLevels(read, params) {
  validateParams(params, []);
  const [rows, seasons, reference] = await Promise.all([
    read("SELECT * FROM api.league_levels ORDER BY competition_id"),
    read("SELECT competition_key, season, level, teams FROM api.league_level_seasons ORDER BY competition_key, season_id"),
    referenceLevel(read),
  ]);
  if (!rows.length) reject(404, "Donnée indisponible.");
  const history = new Map();
  for (const s of seasons) {
    if (!history.has(s.competition_key)) history.set(s.competition_key, []);
    history.get(s.competition_key).push({ season: s.season, level: round(s.level, 1), teams: s.teams });
  }
  // The level shown is that of the league's last season (the clubs that play it now). Every
  // men's league has a level on the common scale (power-ranking-v4) and a rank; one whose
  // standard error is above the measured bound (onScale false) is provisional, its margin
  // the error. A women's league is a universe of its own: a level that says nothing against
  // the others, no rank, no score. What the level rests on: its matches against the other
  // leagues, the players who moved between it and another league, its division.
  const leagues = rows.map((r) => {
    const own = history.get(r.competition_key) ?? [];
    const women = r.universe === "women";
    const level = own.at(-1)?.level ?? round(r.level, 1);
    return { id: r.competition_id, name: r.name, country: r.country ?? null, level, score: women ? null : outOf100(level, reference),
      onScale: r.linked, provisional: !women && !r.linked, margin: women || r.level_se == null ? null : Math.round(r.level_se),
      universe: r.universe ?? "men", teams: own.at(-1)?.teams ?? r.teams, links: r.links,
      evidence: { matches: r.links, movers: r.movers ?? null, tier: r.tier ?? null }, seasons: own };
  }).sort((a, b) => Number(a.universe !== "men") - Number(b.universe !== "men") || b.level - a.level || a.id.localeCompare(b.id));
  let rank = 0;
  return {
    method: { version: rows[0].method_version, computedAt: iso(rows[0].computed_at) },
    reference: round(reference, 1),
    onScale: leagues.filter((l) => l.onScale).length,
    ranked: leagues.filter((l) => l.universe === "men").length,
    leagues: leagues.map(({ id, name, country, level, score, onScale, provisional, margin, universe, teams, links, evidence, seasons: own }) => (
      { id, name, country, level, score, rank: universe === "men" ? ++rank : null, onScale, provisional, margin, universe, teams, links, evidence, seasons: own })),
  };
}

const MATCH = /^m_(?:[A-Za-z0-9]{6}|v\d{7})$/, LEAGUE = /^l_(?:[A-Za-z0-9]{6}|v\d{7})$/;

async function matchForecast(read, params) {
  validateParams(params, ["match"]);
  const id = params.get("match");
  if (!MATCH.test(id || "")) reject(400, "Paramètre invalide.");
  const [[r], [l]] = await Promise.all([
    read("SELECT * FROM api.match_forecasts WHERE match_key=api.internal_id('match',$1)", [id]),
    read("SELECT * FROM api.match_lineup_forecasts WHERE match_key=api.internal_id('match',$1)", [id]),
  ]);
  if (!r) reject(404, "Donnée indisponible.");
  const shares = (f) => ({ home: round(f.home_win, 4), draw: round(f.draw, 4), away: round(f.away_win, 4),
    homeGoals: round(f.home_goals, 2), awayGoals: round(f.away_goals, 2), score: [f.likely_home, f.likely_away] });
  const side = (deviation, shift) => ({ deviation: round(deviation, 2), elo: round(shift, 1) });
  return {
    match: id,
    forecast: shares(r),
    // The Elo points each club's recent form added to its strength (forecast version 2); absent on a match too far ahead.
    ...(r.home_form || r.away_form ? { form: { home: round(r.home_form, 1), away: round(r.away_form, 1) } } : {}),
    // Once both clubs have confirmed their eleven (vega/lineup.py, 091): the same forecast with each side's
    // strength moved by what its eleven is worth against its usual one.
    ...(l ? { lineups: { forecast: shares(l), home: side(l.home_deviation, l.home_shift), away: side(l.away_deviation, l.away_shift), computedAt: iso(l.computed_at) } } : {}),
    model: { version: r.model_version, fittedAt: iso(r.fitted_at), matches: r.model_matches },
  };
}

/**
 * A coming match's bookmakers' odds (vega/sources/odds.py): each bookmaker's full-time result
 * prices now and when first read, its margin, the market's consensus (each bookmaker's
 * chances with its margin taken out, averaged), the best price of each outcome, and Vega's own
 * forecast beside them with its fair odds (1 / chance).
 */
async function matchOdds(read, params) {
  validateParams(params, ["match"]);
  const id = params.get("match");
  if (!MATCH.test(id || "")) reject(400, "Paramètre invalide.");
  const [rows, [f]] = await Promise.all([
    read("SELECT o.* FROM api.match_odds o WHERE o.match_key=api.internal_id('match',$1) ORDER BY o.title", [id]),
    read("SELECT * FROM api.match_forecasts WHERE match_key=api.internal_id('match',$1)", [id]),
  ]);
  if (!rows.length) reject(404, "Donnée indisponible.");
  const mean = (key) => round(rows.reduce((sum, r) => sum + r[key], 0) / rows.length, 4);
  const best = (key) => round(Math.max(...rows.map((r) => r[key])), 2);
  const fair = (chance) => (chance > 0 ? round(1 / chance, 2) : null);
  return {
    match: id,
    bookmakers: rows.map((r) => ({
      key: r.bookmaker, name: r.title, home: round(r.home, 2), draw: round(r.draw, 2), away: round(r.away, 2),
      opening: { home: round(r.first_home, 2), draw: round(r.first_draw, 2), away: round(r.first_away, 2) },
      margin: round(r.overround - 1, 4), updatedAt: iso(r.updated_at), readAt: iso(r.fetched_at),
    })),
    market: { home: mean("home_chance"), draw: mean("draw_chance"), away: mean("away_chance") },
    best: { home: best("home"), draw: best("draw"), away: best("away") },
    vega: f
      ? { home: round(f.home_win, 4), draw: round(f.draw, 4), away: round(f.away_win, 4), fair: { home: fair(f.home_win), draw: fair(f.draw), away: fair(f.away_win) } }
      : null,
  };
}

/**
 * A match minute by minute: win, draw and loss from the forecast's expected goals, the
 * score, the clock and the dismissals (dashboard/shared/inplay.js). A finished match runs to the 90th
 * minute, where its last point is its result; a match in play stops at its clock. A finished
 * match with an extra-time or a shoot-out score, or with a goal or a red card after the 90th
 * minute (the source gives no extra-time score, and added time is the 90th plus `added`), runs
 * to the 120th (`extraTime`), its last point the result, level when a shoot-out decided it
 * (`penalties`: the shoot-out's score, outside the model, null when the base has none). The base does not say a match in play is in extra time (no period, a clock past the
 * 90th being added time as well): it stops at the 90th, the live feed's period carrying it on. A match
 * the base has not read yet (still "not_started" there, though it may be under way) gets
 * its kick-off point only; `inplay` and `rho` are the model the points were drawn with,
 * which the site carries on with the live feed's goals and red cards.
 */
async function liveProbability(read, params) {
  validateParams(params, ["match"]);
  const id = params.get("match");
  if (!MATCH.test(id || "")) reject(400, "Paramètre invalide.");
  const [s] = await read("SELECT * FROM api.match_strengths WHERE match_key=api.internal_id('match',$1)", [id]);
  if (!s || s.home_elo === null || s.away_elo === null || !["finished", "in_play", "not_started"].includes(s.status)) reject(404, "Donnée indisponible.");
  const at = [s.season_id, s.match_key];
  const [[forecast], [model], events, [clock], [lineups]] = await Promise.all([
    read("SELECT * FROM api.forecast_models ORDER BY fitted_at DESC, id DESC LIMIT 1"),
    read("SELECT * FROM api.inplay_models ORDER BY fitted_at DESC, id DESC LIMIT 1"),
    read("SELECT kind, minute, minute_added AS added, side FROM api.match_inplay_events WHERE season_id=$1 AND match_key=$2 AND side IS NOT NULL ORDER BY seq", at),
    read("SELECT minute FROM api.match_clocks WHERE season_id=$1 AND match_key=$2", at),
    read("SELECT home_shift, away_shift, home_strength, away_strength FROM api.match_lineup_forecasts WHERE match_key=$1", [s.match_key]),
  ]);
  if (!forecast || !model) reject(404, "Donnée indisponible.");
  const finished = s.status === "finished";
  const goals = (side) => events.filter((e) => e.kind === "goal" && e.side === side).length;
  // A finished match whose goal events do not give its score has no timeline to show.
  if (finished && (goals("home") !== s.home_score || goals("away") !== s.away_score)) reject(404, "Donnée indisponible.");
  const seen = Math.max(clock?.minute ?? 0, ...events.map((e) => e.minute), 0);
  // `?? null`: a base without migration 166 has neither column. An event past the 90th says extra time
  // as well: added time is minute 90 with `added`, and the source's matches carry no extra-time score.
  const extra = finished && ((s.home_score_et ?? null) !== null || (s.home_penalty_score ?? null) !== null || events.some((e) => e.minute > 90));
  const last = extra ? 120 : finished ? 90 : s.status === "not_started" ? 0 : Math.max(0, Math.min(90, Math.floor(seen)));
  // A match whose two confirmed line-ups were read before it (091) starts from the forecast that read them:
  // the strengths that forecast had (each club's Elo and its form), moved by what each eleven was worth.
  const [rateHome, rateAway] = lineups
    ? inplayRates(forecast, lineups.home_strength + lineups.home_shift, lineups.away_strength + lineups.away_shift, s.neutral)
    : inplayRates(forecast, s.home_elo, s.away_elo, s.neutral);
  const inplay = { profile: [model.q1, model.q2, model.q3, model.q4, model.q5, model.q6, model.after_90], down: model.down, up: model.up, ahead: model.ahead ?? 1, behind: model.behind ?? 1 };
  const points = inplayTimeline(rateHome, rateAway, events, inplay, forecast.rho, last, extra);
  if (finished) {
    const end = points.at(-1), [h, a] = end.score;
    Object.assign(end, { home: h > a ? 1 : 0, draw: h === a ? 1 : 0, away: h < a ? 1 : 0 });
  }
  return {
    match: id, status: s.status,
    // Four decimals: the site draws a live match's minutes from them (shared/inplay.js).
    rates: { home: round(rateHome, 4), away: round(rateAway, 4) },
    ...(lineups ? { lineups: true } : {}),
    ...(extra ? { extraTime: true, penalties: (s.home_penalty_score ?? null) !== null && (s.away_penalty_score ?? null) !== null ? [s.home_penalty_score, s.away_penalty_score] : null } : {}),
    model: { version: model.version, fittedAt: iso(model.fitted_at), matches: model.matches },
    inplay, rho: forecast.rho,
    points: points.map((p) => ({ minute: p.minute, home: round(p.home, 4), draw: round(p.draw, 4), away: round(p.away, 4), score: p.score })),
    events: events.map((e) => ({ minute: e.minute, added: e.added, kind: e.kind, side: e.side })),
  };
}

// A player needs this many minutes over the two award years his rate is read on.
export const SWAP_MIN_MINUTES = 450;

/** Why no estimate is given for two players ({role, minutes} each), or null when one is. */
export const swapReason = (leaving, coming) =>
  leaving.role === "goalkeeper" || coming.role === "goalkeeper" ? "goalkeeper"
    : leaving.role !== coming.role ? "role"
    : Math.min(leaving.minutes, coming.minutes) < SWAP_MIN_MINUTES ? "minutes" : null;

/**
 * What a club's league results would become if `in` played in the place of `out`
 * (src/lineup.mjs). The club and the role are `out`'s of the season; a rate is read on the
 * season and the one before. Without an estimate, `reason` says why: the two roles differ,
 * a goalkeeper (no effect of a goalkeeper's rate could be measured), or too few minutes.
 */
async function swap(read, params) {
  validateParams(params, ["season", "out", "in"]);
  const season = params.get("season"), out = params.get("out"), into = params.get("in");
  if (!/^\d{4}\/\d{4}$/.test(season || "") || !PLAYER.test(out || "") || !PLAYER.test(into || "") || out === into) reject(400, "Paramètre invalide.");
  const [[forecast], [model], rows] = await Promise.all([
    read("SELECT * FROM api.forecast_models ORDER BY fitted_at DESC, id DESC LIMIT 1"),
    read("SELECT * FROM api.lineup_models ORDER BY fitted_at DESC, id DESC LIMIT 1"),
    read(
      `SELECT o.*, o.season_id=${SEASON_KEY} AS present FROM api.player_own_totals o
       WHERE o.season_id IN (${SEASON_KEY}, ${SEASON_KEY}-1) AND o.player_key IN (api.internal_id('player',$2), api.internal_id('player',$3))`,
      [season, out, into],
    ),
  ]);
  const player = (id) => {
    const own = rows.filter((r) => r.player_id === id && r.own_total !== null), now = own.find((r) => r.present);
    if (!now) return null;
    const total = own.reduce((sum, r) => sum + r.own_total, 0), minutes = own.reduce((sum, r) => sum + r.minutes, 0);
    return { ...now, minutes, rate: ownRate(total, minutes) };
  };
  const leaving = player(out), coming = player(into);
  if (!forecast || !model || !leaving || !coming || leaving.team_key === null) reject(404, "Donnée indisponible.");
  const side = (p, team) => put({ id: p.player_id, name: p.name, rate: round(p.rate, 3), minutes: p.minutes }, "team", team && p.team_id ? { id: p.team_id, name: p.team } : null);
  const answer = {
    season, role: leaving.role, position: ROLE_LABEL[leaving.role] ?? leaving.role,
    club: { id: leaving.team_id, name: leaving.team },
    out: side(leaving, false), in: side(coming, true),
    model: { version: model.version, fittedAt: iso(model.fitted_at), matches: model.matches, eloPerUnit: round(model.elo_per_unit, 1), error: round(model.elo_per_unit_error, 1) },
  };
  const reason = swapReason(leaving, coming);
  if (reason) return { ...answer, reason, ...(reason === "role" ? { inRole: coming.role, inPosition: ROLE_LABEL[coming.role] ?? coming.role } : {}) };
  const at = [leaving.season_id, leaving.team_key];
  const [[club], [league]] = await Promise.all([
    read("SELECT elo FROM api.power_clubs WHERE season_id=$1 AND scope='clubs' AND team_key=$2", at),
    read("SELECT competition_key, count(*)::int AS matches FROM api.team_league_matches WHERE season_id=$1 AND team_key=$2 GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1", at),
  ]);
  const [level] = league
    ? await read(
        `SELECT s.level, s.teams, l.name, l.competition_id FROM api.league_level_seasons s JOIN api.league_levels l ON l.competition_key=s.competition_key
         WHERE s.competition_key=$1 AND s.season_id=$2`,
        [league.competition_key, leaving.season_id],
      )
    : [];
  if (!club || club.elo === null || !level || !(level.teams > 1)) reject(404, "Donnée indisponible.");
  // The league's other clubs: its mean level without the club itself.
  const opponents = (level.level * level.teams - club.elo) / (level.teams - 1);
  const gain = replacePlayer(forecast, model.elo_per_unit, club.elo, opponents, coming.rate, leaving.rate);
  return {
    ...answer,
    club: { ...answer.club, elo: round(club.elo, 0), league: { id: level.competition_id, name: level.name, matches: league.matches, opponentsElo: round(opponents, 0) } },
    estimate: { rateGap: round(coming.rate - leaving.rate, 3), elo: round(gain.shift, 1), pointsPerMatch: round(gain.points, 3), pointsPerSeason: round(gain.points * league.matches, 1) },
  };
}

// The stages of a UEFA cup's projection (122), in order.
const CUP_STAGES = ["top8", "playoff", "out", "first", "second", "third", "fourth", "stay", "barrage", "relegated", "promoted",
  "next_a", "next_b", "next_c", "r64", "r32", "r16", "qf", "sf", "final", "win"];
const LEAGUE_PHASE = ["top8", "playoff", "out"];
const GROUP_PLACES = ["first", "second", "third", "fourth"];

/**
 * "league-phase" for a UEFA cup's league phase and bracket (122), "nations" for the Nations League's groups and
 * League A's knockout (125), "knockout" for a domestic cup's rounds (124), else null.
 */
export function cupFormat(stages) {
  if (!stages.size) return null;
  const any = (keys) => [...stages.values()].some((s) => keys.some((k) => s[k] > 0));
  return any(LEAGUE_PHASE) ? "league-phase" : any(GROUP_PLACES) ? "nations" : "knockout";
}

/** Each nation's group in the Nations League (125). */
export function groupsByTeam(rows) {
  return new Map(rows.map((r) => [r.team_key, r.group_name]));
}

/** Each club's Elo (rows: one per club, its latest season's), rounded: a knockout cup's level column (124). */
export function levelsByTeam(rows) {
  return new Map(rows.map((r) => [r.team_key, Math.round(r.elo)]));
}

/** Each club's opponent of a knockout cup's round in play: its first match still to play (124). */
export function roundOpponents(rows) {
  const out = new Map();
  for (const r of [...rows].sort((a, b) => String(a.day).localeCompare(String(b.day))))
    if (!out.has(r.team_key)) out.set(r.team_key, { id: r.opponent_id, name: r.opponent_name, imageUrl: r.opponent_image ?? null, home: Boolean(r.home) });
  return out;
}

/** Each club's share of every stage of a cup's projection, 0 for a stage it never reaches. */
export function cupStages(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.team_key)) out.set(r.team_key, Object.fromEntries(CUP_STAGES.map((stage) => [stage, 0])));
    if (CUP_STAGES.includes(r.stage)) out.get(r.team_key)[r.stage] = round(r.probability, 4);
  }
  return out;
}

async function seasonProjection(read, params) {
  validateParams(params, ["competition", "season"]);
  const competition = params.get("competition"), season = params.get("season");
  if (!LEAGUE.test(competition || "") || !/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
  const [edition] = await read("SELECT competition_season_id FROM api.edition_keys WHERE league_id=$1 AND season=$2 ORDER BY competition_season_id DESC LIMIT 1", [competition, season]);
  if (!edition) reject(404, "Donnée indisponible.");
  const [teams, places, fixtures, stageRows, opponentRows] = await Promise.all([
    read("SELECT * FROM api.season_projections WHERE competition_season_id=$1 ORDER BY projected_points DESC, name", [edition.competition_season_id]),
    read("SELECT team_key, place, probability FROM api.season_projection_places WHERE competition_season_id=$1", [edition.competition_season_id]),
    read("SELECT * FROM api.schedule_forecasts WHERE competition_season_id=$1 ORDER BY kickoff_at NULLS LAST, match_key", [edition.competition_season_id]),
    read("SELECT team_key, stage, probability FROM api.cup_stage_odds WHERE competition_season_id=$1", [edition.competition_season_id]),
    read("SELECT team_key, day, opponent_id, opponent_name, opponent_image, home FROM api.cup_round_opponents WHERE competition_season_id=$1", [edition.competition_season_id]),
  ]);
  const stages = cupStages(stageRows);
  const format = cupFormat(stages);
  const opponents = format === "knockout" ? roundOpponents(opponentRows) : new Map();
  const ranked = format === "knockout" || format === "nations";
  // A club's Elo, or a nation's (the scope of its own ranking).
  const levels = ranked
    ? levelsByTeam(await read("SELECT DISTINCT ON (team_key) team_key, elo FROM api.power_clubs WHERE team_key=ANY($1) ORDER BY team_key, season_id DESC", [teams.map((t) => t.team_key)]))
    : new Map();
  const groups = format === "nations"
    ? groupsByTeam(await read("SELECT team_key, group_name FROM api.cup_team_groups WHERE competition_season_id=$1", [edition.competition_season_id]))
    : new Map();
  if (!teams.length) reject(404, "Donnée indisponible.");
  const next = comingMatches(fixtures);
  // One share per place, 0 for a place the club never reached.
  const shares = new Map(teams.map((team) => [team.team_key, Array(teams.length).fill(0)]));
  for (const p of places) if (shares.has(p.team_key) && p.place <= teams.length) shares.get(p.team_key)[p.place - 1] = round(p.probability, 4);
  return {
    competition, season,
    model: { version: teams[0].model_version, fittedAt: iso(teams[0].fitted_at), replays: teams[0].simulations },
    teams: teams.map((team) => ({ id: team.team_id, name: team.name, imageUrl: team.image_url ?? null, played: team.played, points: team.points,
      projectedPoints: round(team.projected_points, 1), places: shares.get(team.team_key), next: next.get(team.team_key) ?? null,
      ...(stages.size ? { stages: stages.get(team.team_key) ?? cupStages([{ team_key: team.team_key }]).get(team.team_key) } : {}),
      ...(format === "knockout" ? { elo: levels.get(team.team_key) ?? null, opponent: opponents.get(team.team_key) ?? null } : {}),
      ...(format === "nations" ? { elo: levels.get(team.team_key) ?? null, group: groups.get(team.team_key) ?? null } : {}) })),
    // A UEFA cup of the league-phase format: its league phase, then its bracket (122); a domestic
    // cup: its rounds from the one in play, each club with its drawn opponent (124).
    ...(format ? { format } : {}),
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
// breakout.MODEL_VERSION (vega/breakout.py): a list computed under an earlier rule is not
// served as the present one's; it comes back when the season is computed again.
export const BREAKOUT_RULE = "breakout-v2";
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
  if (!run || run.version !== BREAKOUT_RULE) reject(404, "Donnée indisponible.");
  const rows = await read(`SELECT * FROM api.player_breakouts WHERE season_id=${SEASON_KEY} ORDER BY rank LIMIT ${BREAKOUTS_SHOWN}`, [season]);
  return {
    season, computedAt: iso(run.computed_at), candidates: run.candidates, flagged: run.flagged,
    rows: rows.map((r) => ({ ...breakoutOf(r), playerId: r.player_id, name: r.name, imageUrl: r.image_url ?? null,
      teamId: r.team_id ?? null, team: r.team ?? null, teamImageUrl: r.team_image_url ?? null })),
  };
}

/**
 * A player's Vega score season by season (the player page's « Évolution de l'indice Vega »):
 * every season of the ranking he has a score in, oldest first.
 */
async function powerHistory(read, params) {
  validateParams(params, ["player"]);
  const id = params.get("player");
  if (!PLAYER.test(id || "")) reject(400, "Paramètre invalide.");
  const rows = await read(
    `SELECT season, rank, role_rank, role, team, score, index_season, minutes, matches, eligible, linked
     FROM api.power_players WHERE player_key=api.internal_id('player',$1) AND score IS NOT NULL ORDER BY season`,
    [id],
  );
  if (!rows.length) reject(404, "Donnée indisponible.");
  return {
    id,
    seasons: rows.map((r) => ({
      season: r.season, score: round(r.score, 1), rank: r.rank ?? null, roleRank: r.role_rank ?? null,
      position: ROLE_LABEL[r.role] ?? r.role ?? null, team: r.team ?? null, minutes: r.minutes ?? null, matches: r.matches ?? null,
      provisional: r.eligible === false || r.linked === false,
    })),
  };
}

async function powerPlayer(read, params) {
  validateParams(params, ["season", "player"]);
  const season = params.get("season"), id = params.get("player");
  if (!/^\d{4}\/\d{4}$/.test(season || "") || !PLAYER.test(id || "")) reject(400, "Paramètre invalide.");
  const [power, [flag]] = await Promise.all([
    powerOf(read, "players", season, [id]).then((found) => found.get(id)),
    read(`SELECT b.* FROM api.player_breakouts b JOIN api.breakout_runs r ON r.season_id=b.season_id AND r.version=$3
          WHERE b.season_id=${SEASON_KEY} AND b.player_key=api.internal_id('player',$2)`, [season, id, BREAKOUT_RULE]),
  ]);
  // A player below the ranking's minutes has no ranking of his own, but may be flagged as a breakout.
  if (!power && !flag) reject(404, "Donnée indisponible.");
  const breakout = flag ? breakoutOf(flag) : null;
  if (!power) return { season, player: { id, breakout } };
  const [count] = await read(`SELECT ranked FROM api.power_role_counts WHERE season_id=${SEASON_KEY} AND role=$2 AND universe=$3`, [season, power.role, power.universe]);
  return { season, player: { id, ...power, roleCount: count?.ranked ?? null, breakout } };
}

// A match grade is shown from this many minutes, or below them when it is a full standard
// deviation from an ordinary match of the role (something worth noting happened).
const GRADE_MINUTES = 20;

async function matchGrades(read, params) {
  validateParams(params, ["match"]);
  const id = params.get("match");
  if (!MATCH.test(id || "")) reject(400, "Paramètre invalide.");
  // The match's grades, read where its statistics are (the edition's season, the match), each with the player's appearance (name, photo, team, goals), so a match the source rated no
  // one in still lists its best players.
  const rows = await read(
    `SELECT g.*, a.player_name AS name, a.image_url, a.team, a.goals, a.assists
     FROM api.fixtures f JOIN api.match_grades g
       ON g.edition_season=f.season_id AND g.match_key=f.match_id
     LEFT JOIN api.player_appearances a
       ON a.season_id=f.season_id AND a.match_id=f.match_id AND a.player_id=api.internal_id('player',g.player_id)
     WHERE f.match_id=api.internal_id('match',$1)
     ORDER BY g.match_index DESC, g.player_id`,
    [id],
  );
  if (!rows.length) reject(404, "Donnée indisponible.");
  // The grades shown first, best first; the others after them, by minutes.
  const shown = (r) => r.minutes >= GRADE_MINUTES || Math.abs(r.match_index) >= 1;
  const ordered = [...rows.filter(shown), ...rows.filter((r) => !shown(r)).sort((a, b) => b.minutes - a.minutes)];
  let rank = 0;
  return {
    match: id,
    grades: ordered.map((r) => {
      const visible = shown(r);
      const gradeExact = visible && Number.isFinite(r.grade) && r.grade >= 0 && r.grade <= 100 ? r.grade : null;
      return {
        playerId: r.player_id, teamId: r.team_id ?? null, name: r.name ?? null, imageUrl: r.image_url ?? null, team: r.team ?? null,
        role: r.role, position: ROLE_LABEL[r.role] ?? r.role, minutes: r.minutes, goals: r.goals ?? null, assists: r.assists ?? null,
        grade: visible ? round(r.grade, 1) : null, rank: visible ? ++rank : null, gradeExact,
      };
    }),
  };
}

async function powerRanking(read, params) {
  validateParams(params, ["kind", "season", "limit", "scope", "page", "role", "universe"]);
  const kind = params.get("kind") ?? "players", season = params.get("season"), limitRaw = params.get("limit") ?? "30";
  if (!/^(players|clubs|nations)$/.test(kind) || !/^\d{4}\/\d{4}$/.test(season || "") || !/^[1-9]\d{0,2}$/.test(limitRaw) || Number(limitRaw) > 200)
    reject(400, "Paramètre invalide.");
  const limit = Number(limitRaw);
  if (kind === "players" && params.get("scope") === "all") return wholeRanking(read, params, season, limit);
  // The nations' world ranking (about 205 nations from 2021/22, FAILURE_MODES §51) is read a page at a time.
  const paged = kind === "nations" && params.has("page");
  if (params.has("scope") || (params.has("page") && !paged) || params.has("role") || params.has("universe")) reject(400, "Paramètre invalide.");
  if (paged && !/^[1-9]\d{0,3}$/.test(params.get("page"))) reject(400, "Paramètre invalide.");
  const page = paged ? Number(params.get("page")) : 1;
  if (kind === "players") {
    // The award race: the eligible players of a measured top division, numbered in their
    // order (`powerRank` is the player's rank among every ranked player; since
    // power-ranking-v5 every player who played has one, provisional below the minutes bar or
    // in a provisional league, and the race keeps the others).
    const rows = await read(
      // By the year's own index (index_season): last season's prior plays no part in the award race (power-ranking-v8).
      `SELECT * FROM api.power_players WHERE season_id=${SEASON_KEY} AND rank IS NOT NULL AND top_division AND eligible AND linked
       ORDER BY coalesce(index_season, index) DESC NULLS LAST, rank, player_id LIMIT $2`,
      [season, limit],
    );
    if (!rows.length) reject(404, "Donnée indisponible.");
    const roles = await rolesOf(read, season, rows.map((r) => r.player_id));
    return {
      season, kind, method: { version: rows[0].method_version, computedAt: iso(rows[0].computed_at) },
      rows: rows.map((r, i) => ({
        rank: i + 1, playerId: r.player_id, name: r.name, imageUrl: r.image_url ?? null, teamId: r.team_id ?? null, team: r.team ?? null,
        teamImageUrl: r.team_image_url ?? null, position: ROLE_LABEL[r.role] ?? r.role, role: r.role, roleRank: r.role_rank, powerRank: r.rank,
        score: round(r.index_season == null ? r.score : 100 / (1 + 10 ** (-r.index_season / 4)), 1), index: round(r.index_season ?? r.index, 2),
        matches: r.matches, minutes: r.minutes,
        eligible: r.eligible !== false, measured: r.linked !== false, provisional: r.eligible === false || r.linked === false,
        contribution: round(r.total, 2), ownContribution: round(r.own_total, 2), clubLevel: round(r.level_total, 2), rate: round(r.rate, 3),
        contributionPercentile: round(r.total_percentile, 1), ratePercentile: round(r.rate_percentile, 1),
        blocks: blocksOf(r), roles: roles.get(r.player_id) ?? [],
      })),
    };
  }
  const [rows, reference] = await Promise.all([
    read(`SELECT *, count(*) OVER ()::integer AS total FROM api.power_clubs WHERE season_id=${SEASON_KEY} AND scope=$2
          ORDER BY rank, team_id LIMIT $3 OFFSET $4`, [season, kind, limit, (page - 1) * limit]),
    referenceLevel(read),
  ]);
  if (!rows.length) reject(404, "Donnée indisponible.");
  return {
    season, kind, method: { version: rows[0].method_version, computedAt: iso(rows[0].computed_at) },
    ...(kind === "clubs" ? { reference: round(reference, 1) } : { page, limit, total: rows[0].total }),
    rows: rows.map((r) => powerRow(kind, r, reference)),
  };
}

/** One row of the clubs' or the nations' power ranking. A club's score out of 100 is read against the clubs' leagues:
 * national teams have none; a nation's row says whether its place is provisional (§51). */
export function powerRow(kind, r, reference) {
  return {
    rank: r.rank, teamId: r.team_id, name: r.name, imageUrl: r.image_url ?? null, country: r.country ?? null,
    ...(kind === "clubs" ? { score: outOf100(r.elo, reference) } : {}), elo: round(r.elo, 1), eloChange: round(r.elo_change, 1), matches: r.matches, lastMatchAt: iso(r.last_match_at), ...clubSeason(r),
    ...(kind === "nations" ? { provisional: r.provisional === true } : {}),
  };
}

/**
 * The whole player ranking of a season (`scope=all`), for the Power Ranking page: every
 * ranked player of a universe (men by default, or women: their own ranking), optionally of
 * one role, in the ranking's order, a page of `limit` at a time. `rank` is the player's rank
 * in his universe; a provisional rank says why (provisionalReason).
 */
async function wholeRanking(read, params, season, limit) {
  const pageRaw = params.get("page") ?? "1", role = params.get("role"), universe = params.get("universe") ?? "men";
  if (!/^[1-9]\d{0,4}$/.test(pageRaw) || (role && !Object.hasOwn(ROLE_LABEL, role)) || !["men", "women"].includes(universe))
    reject(400, "Paramètre invalide.");
  const page = Number(pageRaw);
  const where = `season_id=${SEASON_KEY} AND rank IS NOT NULL AND universe=$2${role ? " AND role=$5" : ""}`;
  const values = [season, universe, limit, (page - 1) * limit, ...(role ? [role] : [])];
  const [rows, [count]] = await Promise.all([
    read(`SELECT * FROM api.power_players WHERE ${where} ORDER BY ${role ? "role_rank" : "rank"}, player_id LIMIT $3 OFFSET $4`, values),
    read(`SELECT count(*)::int AS total FROM api.power_players WHERE ${where.replace("$5", "$3")}`, [season, universe, ...(role ? [role] : [])]),
  ]);
  if (!count?.total) reject(404, "Donnée indisponible.");
  return {
    season, kind: "players", scope: "all", universe, role: role ?? null, page, limit, total: count.total,
    method: rows.length ? { version: rows[0].method_version, computedAt: iso(rows[0].computed_at) } : null,
    rows: rows.map((r) => ({
      rank: r.rank, roleRank: r.role_rank, playerId: r.player_id, name: r.name, imageUrl: r.image_url ?? null, teamId: r.team_id ?? null,
      team: r.team ?? null, teamImageUrl: r.team_image_url ?? null, position: ROLE_LABEL[r.role] ?? r.role, role: r.role,
      score: round(r.score, 1), matches: r.matches, minutes: r.minutes, provisional: provisionalReason(r) !== null, provisionalReason: provisionalReason(r),
    })),
  };
}

// The level's nine positions (vega/level.py), in French.
export const POSITION_LABEL = {
  centre_forward: "Avant-centre", attacking_midfielder: "Milieu offensif", winger: "Ailier", wide_midfielder: "Milieu excentré",
  central_midfielder: "Milieu central", defensive_midfielder: "Milieu défensif", full_back: "Latéral / piston", centre_back: "Défenseur central",
  goalkeeper: "Gardien",
};
const LEVEL_BLOCKS = ["finishing", "creation", "progression", "defence", "retention"];
/** Why a level's rank is provisional, the first that holds: « minutes » (under the season's bar), « league » (men, a
 * league whose level is not measured), « keeper_data » (a keeper without goals prevented on half his minutes in goal:
 * his level is his starts and his club alone, Score Vega v9.1); else null. */
export const levelReason = (r) => (r.eligible === false ? "minutes" : r.universe !== "women" && r.linked === false ? "league"
  : r.measured === false ? "keeper_data" : null);

/** The players' level of a season, in the level's order, a page of `limit` at a time; optionally one position. */
async function levelRanking(read, params) {
  validateParams(params, ["season", "universe", "position", "limit", "page"]);
  const season = params.get("season"), universe = params.get("universe") ?? "men", position = params.get("position");
  const limitRaw = params.get("limit") ?? "50", pageRaw = params.get("page") ?? "1";
  if (!/^\d{4}\/\d{4}$/.test(season || "") || !["men", "women"].includes(universe) || (position !== null && !Object.hasOwn(POSITION_LABEL, position))
    || !/^[1-9]\d{0,2}$/.test(limitRaw) || Number(limitRaw) > 200 || !/^[1-9]\d{0,4}$/.test(pageRaw))
    reject(400, "Paramètre invalide.");
  const limit = Number(limitRaw), page = Number(pageRaw);
  const where = `season_id=${SEASON_KEY} AND universe=$2${position ? " AND position=$3" : ""}`;
  const values = [season, universe, ...(position ? [position] : [])];
  const [rows, [count]] = await Promise.all([
    read(`SELECT * FROM api.player_levels WHERE ${where} ORDER BY rank, player_id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, (page - 1) * limit]),
    read(`SELECT count(*)::int AS total, max(version) AS version, max(computed_at) AS computed_at FROM api.player_levels WHERE ${where}`, values),
  ]);
  if (!count?.total) reject(404, "Donnée indisponible.");
  return {
    season, universe, position: position ?? null, page, limit, total: count.total,
    method: { version: count.version, computedAt: iso(count.computed_at) },
    rows: rows.map((r) => ({
      rank: r.rank, positionRank: r.position_rank, playerId: r.player_id, name: r.name, imageUrl: r.image_url ?? null, teamId: r.team_id ?? null,
      team: r.team ?? null, teamImageUrl: r.team_image_url ?? null, position: POSITION_LABEL[r.position] ?? r.position, positionKey: r.position,
      score: round(r.score, 1), level: round(r.level, 1), own: round(r.own, 1), club: round(r.club, 1), minutes: Math.round(r.minutes),
      provisional: levelReason(r) !== null, provisionalReason: levelReason(r),
    })),
  };
}

/** One player's level of a season: its parts, and each position he played, the judged ones first. */
async function levelPlayer(read, params) {
  validateParams(params, ["season", "player"]);
  const season = params.get("season"), id = params.get("player");
  if (!/^\d{4}\/\d{4}$/.test(season || "") || !PLAYER.test(id || "")) reject(400, "Paramètre invalide.");
  const [[r], positions] = await Promise.all([
    read(`SELECT * FROM api.player_levels WHERE season_id=${SEASON_KEY} AND player_key=api.internal_id('player',$2)`, [season, id]),
    read(`SELECT * FROM api.player_level_positions WHERE season_id=${SEASON_KEY} AND player_key=api.internal_id('player',$2)
          ORDER BY acquired DESC, share DESC NULLS LAST, minutes_two_seasons DESC, position`, [season, id]),
  ]);
  if (!r) reject(404, "Donnée indisponible.");
  return {
    season, method: { version: r.version, computedAt: iso(r.computed_at) },
    player: {
      id, rank: r.rank, positionRank: r.position_rank, position: POSITION_LABEL[r.position] ?? r.position, positionKey: r.position,
      score: round(r.score, 1), level: round(r.level, 1), own: round(r.own, 1), blocks: round(r.blocks, 1), starts: round(r.starts, 1), club: round(r.club, 1),
      startShare: round(r.start_share, 3), minutes: Math.round(r.minutes), universe: r.universe, eligible: r.eligible !== false, linked: r.linked !== false,
      measured: r.measured !== false, provisional: levelReason(r) !== null, provisionalReason: levelReason(r),
      positions: positions.map((p) => ({
        position: POSITION_LABEL[p.position] ?? p.position, positionKey: p.position, judged: p.acquired, minutes: Math.round(p.minutes),
        minutesTwoSeasons: Math.round(p.minutes_two_seasons), share: round(p.share, 3), value: round(p.value, 1), level: round(p.level, 1),
        talents: p.acquired && LEVEL_BLOCKS.some((b) => p[b] != null) ? Object.fromEntries(LEVEL_BLOCKS.map((b) => [b, round(p[b], 2)])) : null,
      })),
    },
  };
}

/** The Ballon d'Or race on the level of a season (§60): its ranked players, a page of `limit` at a time. */
async function awardRanking(read, params) {
  validateParams(params, ["season", "limit", "page"]);
  const season = params.get("season"), limitRaw = params.get("limit") ?? "30", pageRaw = params.get("page") ?? "1";
  if (!/^\d{4}\/\d{4}$/.test(season || "") || !/^[1-9]\d{0,2}$/.test(limitRaw) || Number(limitRaw) > 200 || !/^[1-9]\d{0,4}$/.test(pageRaw))
    reject(400, "Paramètre invalide.");
  const limit = Number(limitRaw), page = Number(pageRaw);
  const where = `season_id=${SEASON_KEY} AND rank IS NOT NULL`;
  const [rows, [count]] = await Promise.all([
    read(`SELECT * FROM api.award_race WHERE ${where} ORDER BY rank, player_id LIMIT $2 OFFSET $3`, [season, limit, (page - 1) * limit]),
    read(`SELECT count(*)::int AS total, max(version) AS version, max(computed_at) AS computed_at FROM api.award_race WHERE ${where}`, [season]),
  ]);
  if (!count?.total) reject(404, "Donnée indisponible.");
  return {
    season, page, limit, total: count.total, method: { version: count.version, computedAt: iso(count.computed_at) },
    rows: rows.map((r) => ({
      rank: r.rank, playerId: r.player_id, name: r.name, imageUrl: r.image_url ?? null, teamId: r.team_id ?? null, team: r.team ?? null,
      teamImageUrl: r.team_image_url ?? null, position: POSITION_LABEL[r.position] ?? r.position, score: round(r.score, 1),
      individual: round(r.individual, 1), collective: round(r.collective, 2), fairPlay: round(r.fair_play, 2), level: round(r.level, 1),
    })),
  };
}

/** One player's Ballon d'Or race of a season: his parts and their z, his cards, his rank or his reason, his honours. */
async function awardPlayer(read, params) {
  validateParams(params, ["season", "player"]);
  const season = params.get("season"), id = params.get("player");
  if (!/^\d{4}\/\d{4}$/.test(season || "") || !PLAYER.test(id || "")) reject(400, "Paramètre invalide.");
  const [[r], honours] = await Promise.all([
    read(`SELECT * FROM api.award_race WHERE season_id=${SEASON_KEY} AND player_key=api.internal_id('player',$2)`, [season, id]),
    read(`SELECT * FROM api.award_honours WHERE season_id=${SEASON_KEY} AND player_key=api.internal_id('player',$2)
          ORDER BY value DESC, competition, team_id`, [season, id]),
  ]);
  if (!r) reject(404, "Donnée indisponible.");
  return {
    season, method: { version: r.version, computedAt: iso(r.computed_at) },
    player: {
      id, rank: r.rank, reason: r.reason ?? null, position: POSITION_LABEL[r.position] ?? r.position, positionKey: r.position,
      teamId: r.team_id ?? null, team: r.team ?? null, score: round(r.score, 1), individual: round(r.individual, 1), collective: round(r.collective, 2),
      fairPlay: round(r.fair_play, 2), level: round(r.level, 1), zIndividual: round(r.z_individual, 2), zCollective: round(r.z_collective, 2),
      zFairPlay: round(r.z_fair_play, 2), cardPoints: r.card_points, fairPlayMinutes: Math.round(r.fair_play_minutes),
      eligible: r.eligible !== false, linked: r.linked !== false, topDivision: r.top_division !== false, measured: r.measured !== false,
      honours: honours.map((h) => ({
        competition: h.competition, teamId: h.team_id, team: h.team, kind: h.kind, reached: h.reached ?? null, leagueRank: h.league_rank ?? null,
        progress: round(h.progress, 3), factor: round(h.factor, 3), prestige: round(h.prestige, 2), share: round(h.share, 3), value: round(h.value, 3),
        reason: h.reason ?? null,
      })),
    },
  };
}

/** A league edition's competition_season_id from its public id and season, or a 404. */
async function editionOf(read, params) {
  const competition = params.get("competition"), season = params.get("season");
  if (!LEAGUE.test(competition || "") || !/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
  const [edition] = await read("SELECT competition_season_id FROM api.edition_keys WHERE league_id=$1 AND season=$2 ORDER BY competition_season_id DESC LIMIT 1", [competition, season]);
  if (!edition) reject(404, "Donnée indisponible.");
  return { competition, season, edition: edition.competition_season_id };
}

const roundOf = (r) => ({
  key: r.round_key, label: r.label, status: r.status, closedAt: iso(r.closed_at), matches: r.matches, played: r.played, excused: r.excused,
  start: iso(r.window_start), end: iso(r.window_end),
});

/**
 * A league edition's matchweeks (vega/rounds.py), in order, and the latest closed one: a
 * round closes once its matches are over (a postponed match never blocks it); « amended »
 * when a late match of a closed round was played since.
 */
async function leagueRounds(read, params) {
  validateParams(params, ["competition", "season"]);
  const { competition, season, edition } = await editionOf(read, params);
  const rows = await read("SELECT * FROM api.league_rounds WHERE competition_season_id=$1 ORDER BY window_start, round_key", [edition]);
  if (!rows.length) reject(404, "Donnée indisponible.");
  const closed = rows.filter((r) => r.status !== "open");
  return { competition, season, rounds: rows.map(roundOf), latest: closed.length ? closed[closed.length - 1].round_key : null };
}

// The race the round's card shows: its first ten; race=all serves it whole (VI-44).
export const RACE_CARD = 10;

/** A round's race rows as asked: the card's first ten (mode null) or all of them ("all"); any other value is refused. */
export function roundRace(rows, mode) {
  if (mode !== null && mode !== "all") reject(400, "Paramètre invalide.");
  return { rows: mode === "all" ? rows : rows.slice(0, RACE_CARD), total: rows.length };
}

/**
 * One closed round of a league (the latest by default): its Team of the Round, the best
 * eleven by Vega's match grades in the formation that fits them best, and the league's
 * Player of the Season race after it (the shrunk mean grade of the season), both frozen at
 * the round's closure. The race is its first ten unless race=all; raceTotal counts all of it.
 */
async function leagueRound(read, params) {
  validateParams(params, ["competition", "season", "round", "race"]);
  const { competition, season, edition } = await editionOf(read, params);
  const key = params.get("round");
  if (key !== null && !/^(r\d{1,9}|w\d{4}-\d{2}-\d{2})$/.test(key)) reject(400, "Paramètre invalide.");
  const mode = params.get("race");
  roundRace([], mode);
  const [current] = await read(
    key
      ? "SELECT * FROM api.league_rounds WHERE competition_season_id=$1 AND round_key=$2 AND status<>'open'"
      : "SELECT * FROM api.league_rounds WHERE competition_season_id=$1 AND status<>'open' ORDER BY window_start DESC, round_key DESC LIMIT 1",
    key ? [edition, key] : [edition],
  );
  if (!current) reject(404, "Donnée indisponible.");
  const [team, race] = await Promise.all([
    read("SELECT * FROM api.round_teams WHERE competition_season_id=$1 AND round_key=$2 ORDER BY slot", [edition, current.round_key]),
    read("SELECT * FROM api.round_season_race WHERE competition_season_id=$1 AND round_key=$2 ORDER BY rank", [edition, current.round_key]),
  ]);
  const person = (r) => ({ playerId: r.player_id, name: r.player_name, imageUrl: r.image_url ?? null, teamId: r.team_id ?? null, team: r.team ?? null,
    teamImageUrl: r.team_image_url ?? null });
  const served = roundRace(race, mode);
  return {
    competition, season, round: roundOf(current),
    team: team.length
      ? { formation: team[0].formation, players: team.map((r) => ({ slot: r.slot, line: r.line, slotRole: r.slot_role, position: ROLE_LABEL[r.role] ?? r.role,
          ...person(r), matchId: r.match_id, minutes: r.minutes, grade: round(r.grade, 1) })) }
      : null,
    race: served.rows.map((r) => ({ rank: r.rank, ...person(r), grade: round(r.grade, 1), matches: r.matches, minutes: r.minutes })),
    raceTotal: served.total,
  };
}

/**
 * What became of each club of a finished league edition, read from the next season: a
 * European competition, a promotion or a relegation (api.league_team_fates). An edition
 * without a next season in the base has none ({}): its table keeps the league's rules.
 */
async function teamFates(read, params) {
  validateParams(params, ["competition", "season"]);
  const { competition, season, edition } = await editionOf(read, params);
  const rows = await read("SELECT team_id, fate FROM api.league_team_fates WHERE competition_season_id=$1 AND fate IS NOT NULL", [edition]);
  return { competition, season, teams: Object.fromEntries(rows.map((r) => [r.team_id, r.fate])) };
}

export function createRankingRoute(read) {
  return async (req, path, params) => {
    if (path === "/api/rankings/power") return respond(req, await powerRanking(read, params));
    if (path === "/api/rankings/power/player") return respond(req, await powerPlayer(read, params));
    if (path === "/api/rankings/power/history") return respond(req, await powerHistory(read, params));
    if (path === "/api/rankings/level") return respond(req, await levelRanking(read, params));
    if (path === "/api/rankings/level/player") return respond(req, await levelPlayer(read, params));
    if (path === "/api/rankings/award") return respond(req, await awardRanking(read, params));
    if (path === "/api/rankings/award/player") return respond(req, await awardPlayer(read, params));
    if (path === "/api/rankings/leagues") return respond(req, await leagueLevels(read, params));
    if (path === "/api/rankings/breakouts") return respond(req, await breakouts(read, params));
    if (path === "/api/rankings/match") return respond(req, await matchGrades(read, params));
    if (path === "/api/rankings/rounds") return respond(req, await leagueRounds(read, params));
    if (path === "/api/rankings/round") return respond(req, await leagueRound(read, params));
    if (path === "/api/rankings/fates") return respond(req, await teamFates(read, params));
    if (path === "/api/forecasts/match") return respond(req, await matchForecast(read, params));
    if (path === "/api/forecasts/odds") return respond(req, await matchOdds(read, params));
    if (path === "/api/forecasts/season") return respond(req, await seasonProjection(read, params));
    if (path === "/api/forecasts/live") return respond(req, await liveProbability(read, params));
    if (path === "/api/forecasts/swap") return respond(req, await swap(read, params));
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

/**
 * GET /api/players/{id}, GET /api/teams/{id} and GET /api/competitions — the profiles and
 * the competition catalogue the site reads today through the legacy provider proxy
 * (`{data}`; legacy /api/pitchapi/players/{id}, /teams/{id}, /leagues), from
 * api.player_profiles, api.team_profiles (031) and api.competitions (016).
 *
 * GET /api/players/{id}/partners?season= — the player's passing partners of a season
 * (api.player_pass_partners, 079): the passes given to and received from each team-mate
 * in the pass networks, the most exchanged first.
 *
 * GET /api/players/{id}/similar?season= — the players whose whole statistical profile of
 * the season is the closest to his (vega/embedding.py, 081): the nearest on the learnt
 * axes, each with a similarity from 100 (the same profile) to 0 (as far as his median
 * distance to the season's other players).
 *
 * GET /api/teams/{id}/similar?season=&league= — the clubs whose style of play is the closest,
 * across every league of the base (123, VI-22): 100 less the mean distance between the two
 * clubs' centiles on the ten style axes, each club placed among its own league's clubs, less
 * LEAGUE_GAP_COST per point of the two leagues' gap on the league strength scale beyond
 * LEAGUE_GAP_FREE: a club dominating a much weaker league does not pass for a club of a strong
 * one. The clubs' own level never counts. `league` narrows the pool to one league, whatever its
 * level, with the same numbers. Each club with its league, its place, its record, its closest axes.
 *
 * GET /api/teams/{id}/substitutions?season= — what followed the club's first change of each
 * finished match (082): the points the score then would have given against the points
 * taken, by the state of the score at that moment, and its most decisive substitutes.
 *
 * GET /api/players/{id}/return — the absence the player is coming back from, when he is in
 * the middle of a return (vega/returns.py, 087): its length, his minutes since against his
 * usual ones, and the base's curve for an absence of that length.
 * GET /api/players/{id}/halves?season= — the player's season by half (083): his minutes
 * and totals in first halves and in second halves.
 * GET /api/teams/{id}/age-profile?season= — minutes played by age on the match date.
 * GET /api/teams/{id}/passing?season= — the club's most used passing triangle and its most
 * linked pair, from the season's pass networks (083).
 * GET /api/players/{id}/faced?season= — a goalkeeper's shots on target faced in the season
 * (092): how many, the goals they were expected to give once struck, the goals they gave,
 * and his place among the keepers who faced enough of them.
 * GET /api/players/{id}/actions?season= — the source's action values of the player's league
 * season (vega/actions.py, 089): each per 90 minutes of that league, with its rank and
 * percentile among the players of his role there when they are enough to place him.
 *
 * GET /api/teams/{id}/squad?season= — the club record's squad (117): its value, its top 18's,
 * the players' average age and number, the day it was read, and its place by value among the
 * clubs of its league that have one, once three quarters of them do.
 * GET /api/players/{id}/physical?season= — the player's tracked matches (117), per competition:
 * his figures per 90 minutes and the median of his match top speeds, each placed among the
 * players of his role tracked there for 450 minutes or more.
 * GET /api/players/{id}/style?season= — where he acts (his activity maps summed by third and
 * side), the foot he shoots with and his share of his team's passes in its pass networks,
 * placed among the players of his role in his league (117).
 *
 * GET /api/players/{id}/transfers — the player's transfers once they were read, oldest first
 * (135): the date, the kind (transfer, free, loan, loan_return, internal; null when the
 * provider gives none), the fee when it is known, the club left and the club joined. A club
 * of ours carries its id, our name and its crest; another one the provider's name alone; a
 * club nobody names, or a name that is no club (« Without Club », « Retired »), is null. GET /api/player-market-values names each valuation's club the
 * same way (`club`), when it is known.
 *
 * Differences with the legacy read: a field without a value is omitted; a competition
 * carries no `is_free` (a plan of the source, not a fact of the competition); team
 * profiles are served (legacy: none was kept).
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";
import { ROLE_LABEL } from "./rankings.mjs";

const PLAYER = /^\/api\/players\/(p_(?:[A-Za-z0-9]{6}|v\d{7}))$/,
  TEAM = /^\/api\/teams\/(t_(?:[A-Za-z0-9]{6}|v\d{7}))$/;
const PARTNERS = /^\/api\/players\/(p_(?:[A-Za-z0-9]{6}|v\d{7}))\/partners$/;
const PARTNER_COUNT = 5;
const SIMILAR = /^\/api\/players\/(p_(?:[A-Za-z0-9]{6}|v\d{7}))\/similar$/;
const SIMILAR_COUNT = 8;
const CLUB_SIMILAR = /^\/api\/teams\/(t_(?:[A-Za-z0-9]{6}|v\d{7}))\/similar$/;
const LEAGUE = /^l_(?:[A-Za-z0-9]{6}|v\d{7})$/;
// Style axes (vega/models.py TEAM_SIMILARITY_AXES) and the site's name of each (club-scout.js).
const STYLE_AXES = {
  possession_pct: "possession", field_tilt_pct: "fieldTilt", directness_pct: "directness", ppda_approx: "ppda",
  crosses_pm: "crosses", set_share_pct: "setShare", def_actions_adj: "defActions", xg_pm: "xg", xga_pm: "xga",
  pass_accuracy_pct: "passAccuracy",
};
// The cost of a league gap on the league strength scale (Elo points): free up to 50, then 0.15
// point of similarity per point. Measured on 17 November 2026: a window cut at 125 let Ecuador's
// champion lead Paris's list, then dropped it when the levels moved by 3 points; this cost
// keeps LaLiga, Serie A and the Bundesliga for Arsenal and sends the leaders of much weaker
// leagues down for Paris, with no threshold.
export const LEAGUE_GAP_FREE = 50, LEAGUE_GAP_COST = 0.15;
// A league ranks a club once it has this many clubs; an axis counts on this many matches.
const LEAGUE_CLUBS = 10, AXIS_MATCHES = 5, CLUB_SIMILAR_COUNT = 10;
const DIMENSIONS = 10;
const SQUARES = Array.from({ length: DIMENSIONS }, (_, i) => `power(o.e${i + 1}-me.e${i + 1},2)`).join("+");

const RETURN = /^\/api\/players\/(p_(?:[A-Za-z0-9]{6}|v\d{7}))\/return$/;
const HALVES = /^\/api\/players\/(p_(?:[A-Za-z0-9]{6}|v\d{7}))\/halves$/;
const PASSING = /^\/api\/teams\/(t_(?:[A-Za-z0-9]{6}|v\d{7}))\/passing$/;
const AGE_PROFILE = /^\/api\/teams\/(t_(?:[A-Za-z0-9]{6}|v\d{7}))\/age-profile$/;
const ACTIONS = /^\/api\/players\/(p_(?:[A-Za-z0-9]{6}|v\d{7}))\/actions$/;
const FACED = /^\/api\/players\/(p_(?:[A-Za-z0-9]{6}|v\d{7}))\/faced$/;
// GET /api/players/{id}/injuries: a player's injuries, most recent first (api.player_injuries, 116).
const INJURIES = /^\/api\/players\/(p_(?:[A-Za-z0-9]{6}|v\d{7}))\/injuries$/;
// GET /api/players/{id}/transfers: a player's transfers, oldest first (api.player_transfers, 135).
const TRANSFERS = /^\/api\/players\/(p_(?:[A-Za-z0-9]{6}|v\d{7}))\/transfers$/;
const SQUAD = /^\/api\/teams\/(t_(?:[A-Za-z0-9]{6}|v\d{7}))\/squad$/;
// Share of a league's clubs with a squad value before a club's rank among them is given.
export const SQUAD_RANKED = 0.75;
const PHYSICAL = /^\/api\/players\/(p_(?:[A-Za-z0-9]{6}|v\d{7}))\/physical$/;
const STYLE = /^\/api\/players\/(p_(?:[A-Za-z0-9]{6}|v\d{7}))\/style$/;
// Shots on target a keeper must have faced in the season to be placed among the others.
export const FACED_MIN_SHOTS = 30;

/**
 * A keeper's shots faced and his place: goals prevented are the expected goals of the
 * shots once struck less the goals they gave; the rank is that of the goals prevented per
 * shot, among the keepers with `min` shots or more. `rows`: [{own, shots, goals, xgot}].
 */
export function keeperStanding(rows, min = FACED_MIN_SHOTS) {
  const own = rows.find((r) => r.own);
  if (!own || !(own.shots > 0)) return null;
  const rate = (r) => (r.xgot - r.goals) / r.shots;
  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
  const out = { shots: own.shots, goals: own.goals, xgot: round(own.xgot, 2), prevented: round(own.xgot - own.goals, 2), per100: round(100 * rate(own), 1) };
  if (own.shots >= min) {
    const field = rows.filter((r) => r.shots >= min);
    out.rank = 1 + field.filter((r) => rate(r) > rate(own)).length;
    out.keepers = field.length;
  }
  return out;
}
// The source's three totals, and the two parts it gives of two of them.
const ACTION_VALUES = [["vaep", true], ["pv", true], ["xt", false]];
// Only what the source publishes per half: it gives no chances created or expected assists there.
const HALF_FIELDS = ["matches", "minutes", "goals", "shots", "xg", "touches_box", "dribbles", "passes", "touches", "duels_won", "tackles", "recoveries"];

/**
 * The three players of a club who exchange the most passes: among the trios whose three
 * pairs all exchanged passes, the one with the largest total; and the most linked pair.
 * `pairs`: [{a, b, passes}] with a < b.
 */
export function passingTriangle(pairs) {
  const links = new Map(), players = new Set();
  let pair = null;
  for (const p of pairs) {
    if (!(p.passes > 0)) continue;
    links.set(`${p.a}:${p.b}`, p.passes);
    players.add(p.a).add(p.b);
    if (!pair || p.passes > pair.passes || (p.passes === pair.passes && (p.a < pair.players[0] || (p.a === pair.players[0] && p.b < pair.players[1]))))
      pair = { players: [p.a, p.b], passes: p.passes };
  }
  const ids = [...players].sort((x, y) => x - y);
  const of = (x, y) => links.get(`${x}:${y}`) ?? 0;
  let triangle = null;
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const ab = of(ids[i], ids[j]);
      if (!ab) continue;
      for (let k = j + 1; k < ids.length; k++) {
        const ac = of(ids[i], ids[k]), bc = of(ids[j], ids[k]);
        if (!ac || !bc) continue;
        const passes = ab + ac + bc;
        if (!triangle || passes > triangle.passes) triangle = { players: [ids[i], ids[j], ids[k]], passes };
      }
    }
  return { triangle, pair };
}

const CHANGES = /^\/api\/teams\/(t_(?:[A-Za-z0-9]{6}|v\d{7}))\/substitutions$/;
const SUBSTITUTES_SHOWN = 3;
const pointsOf = (scored, conceded) => (scored > conceded ? 3 : scored === conceded ? 1 : 0);

/**
 * What followed a club's first change of each match: the points the score at that moment
 * would have given, the points taken, and the same split by the state of the score then.
 */
export function changeImpact(rows) {
  const state = () => ({ matches: 0, pointsThen: 0, points: 0 });
  const out = { matches: 0, pointsThen: 0, points: 0, gained: 0, minute: null, leading: state(), level: state(), behind: state() };
  let minutes = 0, timed = 0;
  for (const r of rows) {
    if (!r.complete) continue;
    const then = pointsOf(r.goals_for_then, r.goals_against_then), final = pointsOf(r.goals_for, r.goals_against);
    const bucket = out[then === 3 ? "leading" : then === 1 ? "level" : "behind"];
    for (const target of [out, bucket]) {
      target.matches++;
      target.pointsThen += then;
      target.points += final;
    }
    if (Number.isFinite(r.change_minute)) {
      minutes += r.change_minute;
      timed++;
    }
  }
  out.gained = out.points - out.pointsThen;
  out.minute = timed ? Math.round(minutes / timed) : null;
  return out;
}

/** 100 for the same profile, 0 from the median distance between the player and the others. */
export const similarity = (distance, median) => (median > 0 ? Math.max(0, Math.round(100 * (1 - distance / median))) : 0);
const put = (o, k, v) => (v === null || v === undefined ? o : ((o[k] = v), o));
/** transfermarkt.py NO_CLUB: provider names that are no club (a player without one, retired,
 * unknown or on a break), in the reader's comparison form. A test keeps the two lists equal. */
export const NO_CLUB = ["withoutclub", "retired", "unknown", "careerbreak", "vereinslos", "karriereende", "unbekannt", "pause"];
const comparable = (name) => name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
/** A club as the transfers and the valuations name it: null when nobody names it, or when
 * the provider's name is no club. */
const namedClub = (id, name, image) =>
  name && (id || !NO_CLUB.includes(comparable(name))) ? put(put(put({}, "id", id), "name", name), "image_url", image) : null;

function respond(req, data) {
  const etag = `W/"profile-v1-${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl: 300 });
  return send(req, { data }, 200, { etag, ttl: 300, maxBytes: 2 * 1024 * 1024 });
}

// A role's players, and its line where the role has too few to place anyone (fewer than
// ROLE_PEERS); goalkeepers are only ever compared with goalkeepers.
export const ROLE_PEERS = 30;
const LINE = { goalkeeper: "G", centre_back: "D", full_back: "D", defensive_midfielder: "M", central_midfielder: "M", winger: "A", centre_forward: "A" };
const PEERS_LABEL = {
  centre_forward: "avant-centres", winger: "ailiers et milieux offensifs", central_midfielder: "milieux centraux",
  defensive_midfielder: "milieux défensifs", full_back: "latéraux", centre_back: "défenseurs centraux", goalkeeper: "gardiens",
  G: "gardiens", D: "défenseurs", M: "milieux", A: "attaquants",
};

/** The players a player of `role` is placed among: his role's, or his line's when it has too few. */
export function roleCohort(rows, role, min = ROLE_PEERS) {
  if (!role || !LINE[role]) return null;
  const own = rows.filter((r) => r.role === role);
  if (own.length >= min) return { scope: "role", key: role, label: PEERS_LABEL[role], rows: own };
  const line = rows.filter((r) => LINE[r.role] === LINE[role]);
  return { scope: "line", key: LINE[role], label: PEERS_LABEL[LINE[role]], rows: line };
}

/** Share of `values` below `value`, ties counted half, from 0 to 100; null without a value. */
export function centileOf(values, value) {
  if (value == null || !values.length) return null;
  let below = 0, same = 0;
  for (const v of values) if (v < value) below++; else if (v === value) same++;
  return Math.round((100 * (below + same / 2)) / values.length);
}

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * q, low = Math.floor(at);
  return sorted[low] + (sorted[Math.min(low + 1, sorted.length - 1)] - sorted[low]) * (at - low);
};
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

// Tracked figures: per 90 minutes (distances in metres), and the median of match top speeds.
export const PHYSICAL_METRICS = ["distance", "running", "sprinting", "sprints", "topSpeed"];
export const PHYSICAL_MINUTES = 450;
const PLACE_MIN = 10;

/** A player's figures of one competition from his tracked matches, as the peers' read gives them. */
export function physicalTotals(games) {
  const per90 = (key) => {
    const kept = games.filter((g) => g[key] != null);
    const minutes = kept.reduce((t, g) => t + g.minutes, 0);
    return minutes ? (90 * kept.reduce((t, g) => t + g[key], 0)) / minutes : null;
  };
  const speeds = games.map((g) => g.topSpeed).filter((v) => v != null).sort((a, b) => a - b);
  return {
    minutes: games.reduce((t, g) => t + g.minutes, 0),
    distance: per90("distance"), running: per90("running"), sprinting: per90("sprinting"), sprints: per90("sprints"),
    topSpeed: quantile(speeds, 0.5), maxSpeed: speeds.length ? speeds[speeds.length - 1] : null,
  };
}

/** One competition's block: the player's figures, each placed among his role's tracked players. */
export function physicalBlock({ name, games, peers, role }) {
  const own = physicalTotals(games);
  const cohort = roleCohort(peers.filter((p) => p.minutes >= PHYSICAL_MINUTES), role);
  const placed = own.minutes >= PHYSICAL_MINUTES && cohort && cohort.rows.length >= PLACE_MIN;
  const column = { distance: "distance_m", running: "running_m", sprinting: "sprinting_m", sprints: "sprints", topSpeed: "top_speed_kmh" };
  const metrics = PHYSICAL_METRICS.map((key) => {
    const values = (cohort?.rows || []).map((r) => r[column[key]]).filter((v) => v != null).sort((a, b) => a - b);
    return {
      key, value: round1(own[key]),
      percentile: placed && values.length >= PLACE_MIN ? centileOf(values, own[key]) : null,
      p10: round1(quantile(values, 0.1)), p25: round1(quantile(values, 0.25)), median: round1(quantile(values, 0.5)),
      p75: round1(quantile(values, 0.75)), p90: round1(quantile(values, 0.9)),
    };
  });
  const first = peers[0];
  return {
    name, matches: games.length, minutes: own.minutes, maxSpeed: round1(own.maxSpeed),
    tracked: first?.tracked ?? null, finished: first?.finished ?? null,
    cohort: cohort && placed ? { scope: cohort.scope, key: cohort.key, label: cohort.label, players: cohort.rows.length } : null,
    metrics,
    games: games.map((g) => ({ date: g.date, opponent: g.opponent, minutes: g.minutes, distance: round1(g.distance),
      sprints: g.sprints, topSpeed: round1(g.topSpeed) })),
  };
}

/** His share of his team's passes in the networks he is in, placed among his role's players. */
export function passShare(rows, playerKey, min = 5) {
  const share = (r) => (r.total > 0 ? r.received / r.total : null);
  const me = rows.find((r) => r.player_id === playerKey);
  if (!me || me.networks < min) return null;
  const cohort = roleCohort(rows.filter((r) => r.networks >= min), me.role);
  const values = (cohort?.rows || []).map(share).filter((v) => v != null);
  return {
    competition: me.competition_name, networks: me.networks, received: me.received, total: me.total,
    share: Math.round(1000 * share(me)) / 10,
    percentile: cohort && values.length >= PLACE_MIN ? centileOf(values, share(me)) : null,
    cohort: cohort && values.length >= PLACE_MIN ? { scope: cohort.scope, key: cohort.key, label: cohort.label, players: values.length } : null,
  };
}

const seasonParam = (params) => {
  validateParams(params, ["season"]);
  const season = params.get("season");
  if (!/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
  return season;
};
const SEASON_KEY = "(SELECT season_id FROM api.season_keys WHERE season=$2)";

export function createProfileRoute(read) {
  return async (req, path, params) => {
    const squad = path.match(SQUAD);
    if (squad) {
      const season = seasonParam(params);
      const [r] = await read(
        `SELECT squad_value_eur, top18_value_eur, average_age, squad_size, read_on::text AS read_on, league_rank, league_clubs, league_valued
         FROM api.club_squad(${SEASON_KEY}, api.internal_id('team',$1))`,
        [squad[1], season],
      );
      if (!r) reject(404, "Donnée indisponible.");
      const data = { id: squad[1], season, value: Number(r.squad_value_eur), readOn: r.read_on };
      put(data, "top18Value", r.top18_value_eur == null ? null : Number(r.top18_value_eur));
      put(data, "averageAge", r.average_age);
      put(data, "size", r.squad_size);
      // A rank among the league's clubs that have a value, once three quarters of them have one;
      // the page says how many were valued.
      if (r.league_clubs > 1 && r.league_valued >= SQUAD_RANKED * r.league_clubs)
        data.league = { rank: r.league_rank, valued: r.league_valued, clubs: r.league_clubs };
      return respond(req, data);
    }
    const physical = path.match(PHYSICAL);
    if (physical) {
      const season = seasonParam(params);
      const rows = await read(
        `SELECT competition_id, competition_name, match_date::text AS match_date, opponent_name, role, minutes,
                distance_m, running_m, sprinting_m, sprints, top_speed_kmh
         FROM api.player_physical_matches(${SEASON_KEY}, api.internal_id('player',$1))
         ORDER BY match_date, match_id`,
        [physical[1], season],
      );
      if (!rows.length) reject(404, "Donnée indisponible.");
      const byCompetition = new Map();
      for (const r of rows) {
        if (!byCompetition.has(r.competition_id)) byCompetition.set(r.competition_id, { name: r.competition_name, games: [] });
        byCompetition.get(r.competition_id).games.push({ date: r.match_date, opponent: r.opponent_name, minutes: r.minutes,
          distance: r.distance_m, running: r.running_m, sprinting: r.sprinting_m, sprints: r.sprints, topSpeed: r.top_speed_kmh });
      }
      const blocks = await Promise.all([...byCompetition].map(async ([key, { name, games }]) => {
        const peers = await read(
          `SELECT * FROM api.competition_physical_peers(${SEASON_KEY.replace("$2", "$1")}, $2::integer)`,
          [season, key],
        );
        return physicalBlock({ name, games, peers, role: rows[0].role });
      }));
      blocks.sort((a, b) => b.minutes - a.minutes);
      return respond(req, { id: physical[1], season, competitions: blocks });
    }
    const style = path.match(STYLE);
    if (style) {
      const season = seasonParam(params);
      const args = [style[1], season];
      const [[zones], [shots], passes] = await Promise.all([
        read(`SELECT * FROM api.player_zones(${SEASON_KEY}, api.internal_id('player',$1))`, args),
        read(`SELECT * FROM api.player_shot_profile(${SEASON_KEY}, api.internal_id('player',$1))`, args),
        read(`SELECT *, player_id = api.internal_id('player',$1) AS me FROM api.player_pass_share(${SEASON_KEY}, api.internal_id('player',$1))`, args),
      ]);
      const me = passes.find((r) => r.me);
      const data = { id: style[1], season };
      put(data, "zones", zones?.matches ? {
        matches: zones.matches, minutes: zones.minutes, actions: Number(zones.actions),
        thirds: [zones.own_third, zones.middle_third, zones.final_third].map(Number),
        sides: [zones.right_side, zones.centre, zones.left_side].map(Number),
      } : null);
      put(data, "shots", shots?.shots ? {
        shots: shots.shots, rightFoot: shots.right_foot, leftFoot: shots.left_foot, header: shots.header, other: shots.other, insideBox: shots.inside_box,
      } : null);
      put(data, "passes", me ? passShare(passes, me.player_id) : null);
      if (!data.zones && !data.shots && !data.passes) reject(404, "Donnée indisponible.");
      return respond(req, data);
    }
    const injuries = path.match(INJURIES);
    if (injuries) {
      validateParams(params, []);
      const [rows, [known]] = await Promise.all([
        read(
          `SELECT kind, label, start_date::text AS start_date, end_date::text AS end_date, days, matches_missed, season_year
           FROM api.player_injuries WHERE player_key=api.internal_id('player',$1)
           ORDER BY start_date DESC, label`,
          [injuries[1]],
        ),
        read(`SELECT read_at FROM api.player_injury_reads WHERE player_key=api.internal_id('player',$1) LIMIT 1`, [injuries[1]]),
      ]);
      // A player whose injuries were never read is not known: no list, rather than an empty one.
      if (!known) reject(404, "Donnée indisponible.");
      return respond(req, {
        id: injuries[1],
        injuries: rows.map((r) => ({ kind: r.kind ?? null, label: r.label ?? null, start: r.start_date, end: r.end_date ?? null,
          days: r.days ?? null, matchesMissed: r.matches_missed ?? null, season: r.season_year ?? null })),
      });
    }
    const transfers = path.match(TRANSFERS);
    if (transfers) {
      validateParams(params, []);
      const [rows, [known]] = await Promise.all([
        // Two moves of one day in the provider's order: its key is a number written as text.
        read(
          `SELECT transfer_date::text AS date, kind, fee_eur, from_id, from_name, from_image_url, to_id, to_name, to_image_url
           FROM api.player_transfers WHERE player_key=api.internal_id('player',$1)
           ORDER BY transfer_date, length(source_key), source_key`,
          [transfers[1]],
        ),
        read(`SELECT read_at FROM api.player_transfer_reads WHERE player_key=api.internal_id('player',$1) LIMIT 1`, [transfers[1]]),
      ]);
      // A player whose transfers were never read is not known: no list, rather than an empty one.
      if (!known) reject(404, "Donnée indisponible.");
      return respond(req, {
        id: transfers[1],
        transfers: rows.map((r) => ({ date: r.date, kind: r.kind ?? null, feeEur: r.fee_eur ?? null,
          from: namedClub(r.from_id, r.from_name, r.from_image_url), to: namedClub(r.to_id, r.to_name, r.to_image_url) })),
      });
    }
    const partners = path.match(PARTNERS);
    if (partners) {
      validateParams(params, ["season"]);
      const season = params.get("season");
      if (!/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
      const rows = await read(
        `SELECT partner_id, partner_name, partner_image_url, given, received, matches FROM api.player_pass_partners
         WHERE season_id=(SELECT k.season_id FROM api.season_keys k WHERE k.season=$2) AND player_key=api.internal_id('player',$1)
         ORDER BY given+received DESC, partner_name, partner_id LIMIT ${PARTNER_COUNT}`,
        [partners[1], season],
      );
      if (!rows.length) reject(404, "Donnée indisponible.");
      return respond(req, {
        id: partners[1], season,
        partners: rows.map((r) => put({ id: r.partner_id, name: r.partner_name, given: r.given, received: r.received, matches: r.matches }, "image_url", r.partner_image_url)),
      });
    }
    const back = path.match(RETURN);
    if (back) {
      validateParams(params, []);
      const [r] = await read("SELECT * FROM api.player_returns WHERE player_key=api.internal_id('player',$1)", [back[1]]);
      if (!r) reject(404, "Donnée indisponible.");
      const curve = await read("SELECT match_no, returns, minutes, usual_minutes FROM api.return_curves WHERE bucket=$1 ORDER BY match_no", [r.bucket]);
      return respond(req, {
        id: back[1],
        team: { id: r.team_id, name: r.team },
        absence: { from: r.absent_from, returnedOn: r.returned_on, days: r.days, matchesMissed: r.matches_missed },
        matchesBack: r.matches_back, minutesBack: Math.round(r.minutes_back), usualMinutes: Math.round(r.usual_minutes),
        // The base's curve for an absence of this length: the share of his usual minutes a player gets in each match back.
        curve: curve.map((c) => ({ match: c.match_no, returns: c.returns, share: Math.round((100 * c.minutes) / c.usual_minutes) / 100 })),
      });
    }
    const halves = path.match(HALVES);
    if (halves) {
      validateParams(params, ["season"]);
      const season = params.get("season");
      if (!/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
      const rows = await read(
        `SELECT * FROM api.player_half_totals
         WHERE season_id=(SELECT k.season_id FROM api.season_keys k WHERE k.season=$2) AND player_key=api.internal_id('player',$1)`,
        [halves[1], season],
      );
      const half = (name) => {
        const r = rows.find((row) => row.period === name);
        return r ? Object.fromEntries(HALF_FIELDS.map((k) => [k, k === "xg" ? Math.round(r[k] * 100) / 100 : r[k]])) : null;
      };
      const first = half("first_half"), second = half("second_half");
      if (!first && !second) reject(404, "Donnée indisponible.");
      return respond(req, { id: halves[1], season, first, second });
    }
    const faced = path.match(FACED);
    if (faced) {
      validateParams(params, ["season"]);
      const season = params.get("season");
      if (!/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
      const rows = await read(
        `SELECT k.shots, k.goals, k.xgot, k.keeper_key=api.internal_id('player',$1) AS own FROM api.keeper_shot_totals k
         WHERE k.season_id=(SELECT s.season_id FROM api.season_keys s WHERE s.season=$2)`,
        [faced[1], season],
      );
      const standing = keeperStanding(rows);
      if (!standing) reject(404, "Donnée indisponible.");
      return respond(req, { id: faced[1], season, ...standing, minShots: FACED_MIN_SHOTS });
    }
    const actions = path.match(ACTIONS);
    if (actions) {
      validateParams(params, ["season"]);
      const season = params.get("season");
      if (!/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
      const [r] = await read(
        `SELECT * FROM api.player_action_values
         WHERE season_id=(SELECT k.season_id FROM api.season_keys k WHERE k.season=$2) AND player_key=api.internal_id('player',$1)`,
        [actions[1], season],
      );
      if (!r) reject(404, "Donnée indisponible.");
      const rounded = (v, d) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);
      return respond(req, {
        id: actions[1], season,
        competition: { id: r.competition_id, name: r.competition },
        role: r.role, position: ROLE_LABEL[r.role] ?? r.role, minutes: r.minutes, peers: r.peers,
        // Per 90 minutes of the league; a rank and a percentile only among enough players of the role.
        values: ACTION_VALUES.map(([key, parts]) => {
          const value = { key, value: rounded(r[key], 3) };
          put(value, "rank", r[`${key}_rank`]);
          put(value, "percentile", rounded(r[`${key}_percentile`], 1));
          if (parts) {
            put(value, "offensive", rounded(r[`${key}_offensive`], 3));
            put(value, "defensive", rounded(r[`${key}_defensive`], 3));
          }
          return value;
        }),
        method: { version: r.version, computedAt: new Date(r.computed_at).toISOString() },
      });
    }
    const ageProfile = path.match(AGE_PROFILE);
    if (ageProfile) {
      validateParams(params, ["season"]);
      const season = params.get("season");
      if (!/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
      const minutesByAge = await read(
        `SELECT age, minutes FROM api.club_age_minutes(
           (SELECT season_id FROM api.season_keys WHERE season=$2),
           api.internal_id('team',$1)
         )
         ORDER BY age`,
        [ageProfile[1], season],
      );
      return respond(req, { id: ageProfile[1], season, minutesByAge });
    }
    const passing = path.match(PASSING);
    if (passing) {
      validateParams(params, ["season"]);
      const season = params.get("season");
      if (!/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
      const pairs = await read(
        `SELECT least(e.from_player_id, e.to_player_id) AS a, greatest(e.from_player_id, e.to_player_id) AS b, sum(e.passes)::int AS passes
         FROM api.team_pass_edges e
         WHERE e.season_id=(SELECT k.season_id FROM api.season_keys k WHERE k.season=$2) AND e.team_key=api.internal_id('team',$1)
           AND e.from_player_id <> e.to_player_id
         GROUP BY 1, 2`,
        [passing[1], season],
      );
      const { triangle, pair } = passingTriangle(pairs);
      if (!pair) reject(404, "Donnée indisponible.");
      const wanted = [...new Set([...(triangle?.players ?? []), ...pair.players])];
      const people = new Map((await read("SELECT player_id, public_id, name, image_url FROM api.player_profiles WHERE player_id = ANY($1::int[])", [wanted]))
        .map((r) => [r.player_id, put({ id: r.public_id, name: r.name }, "image_url", r.image_url)]));
      const named = (group) => (group ? { passes: group.passes, players: group.players.map((key) => people.get(key)).filter(Boolean) } : null);
      return respond(req, { id: passing[1], season, triangle: named(triangle), pair: named(pair) });
    }
    const changes = path.match(CHANGES);
    if (changes) {
      validateParams(params, ["season"]);
      const season = params.get("season");
      if (!/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
      const key = [changes[1], season];
      const scope = "season_id=(SELECT k.season_id FROM api.season_keys k WHERE k.season=$2) AND team_key=api.internal_id('team',$1)";
      const [matches, substitutes] = await Promise.all([
        read(`SELECT change_minute, goals_for_then, goals_against_then, goals_for, goals_against, complete FROM api.team_change_matches WHERE ${scope}`, key),
        read(
          `SELECT api.public_id('player', s.player_key) AS id, p.name, p.image_url, count(*)::int AS entries, sum(s.minutes)::int AS minutes,
                  sum(s.goals)::int AS goals, sum(s.assists)::int AS assists
           FROM api.team_substitute_matches s JOIN api.player_profiles p ON p.player_id = s.player_key
           WHERE ${scope.replace(/season_id/, "s.season_id").replace(/team_key/, "s.team_key")}
           GROUP BY s.player_key, p.name, p.image_url HAVING sum(s.goals) + sum(s.assists) > 0
           ORDER BY sum(s.goals) + sum(s.assists) DESC, sum(s.goals) DESC, sum(s.minutes), p.name LIMIT ${SUBSTITUTES_SHOWN}`,
          key,
        ),
      ]);
      const impact = changeImpact(matches);
      if (!impact.matches) reject(404, "Donnée indisponible.");
      return respond(req, {
        id: changes[1], season, ...impact,
        substitutes: substitutes.map((r) => put({ id: r.id, name: r.name, entries: r.entries, minutes: r.minutes, goals: r.goals, assists: r.assists }, "image_url", r.image_url)),
      });
    }
    const club = path.match(CLUB_SIMILAR);
    if (club) {
      validateParams(params, ["season", "league"]);
      const season = params.get("season"), league = params.get("league");
      if (!/^\d{4}\/\d{4}$/.test(season || "") || (params.has("league") && !LEAGUE.test(league))) reject(400, "Paramètre invalide.");
      // One league cohort per club (the one with the most matches); a pair needs
      // max(5, ⌈0.75 × the club's axes⌉) axes in common (as agg.player_similar).
      const rows = await read(
        // The ids are resolved once (k), not for each of the season's rows.
        `WITH k AS MATERIALIZED (SELECT api.internal_id('team',$1) AS team, api.internal_id('competition',$3) AS league),
              s AS (SELECT * FROM api.team_style_centiles WHERE season_id=${SEASON_KEY} AND league_clubs >= ${LEAGUE_CLUBS}),
              pick AS (SELECT DISTINCT ON (team_key) team_key, competition_season_id FROM s
                       GROUP BY 1, 2 ORDER BY team_key, max(covered_matches) DESC, competition_season_id),
              p AS (SELECT s.* FROM s JOIN pick USING (team_key, competition_season_id)
                    WHERE s.percentile IS NOT NULL AND s.covered_matches >= ${AXIS_MATCHES}),
              me AS (SELECT * FROM p WHERE team_key=(SELECT team FROM k)),
              mine AS (SELECT max(league_level) AS level, bool_or(women) AS women, count(*)::int AS axes FROM me),
              pool AS (
                SELECT o.team_key, o.competition_season_id, o.competition_key, o.league_name, o.country,
                       100 - avg(abs(me.percentile - o.percentile))
                         - greatest(0, coalesce(abs(max(o.league_level) - max(mine.level))::numeric, 0) - ${LEAGUE_GAP_FREE}) * ${LEAGUE_GAP_COST} AS similarity,
                       (array_agg(o.metric_key ORDER BY abs(me.percentile - o.percentile), array_position($4::text[], o.metric_key)))[1:3] AS closest
                FROM me JOIN p o USING (metric_key) CROSS JOIN mine
                WHERE o.team_key <> me.team_key AND o.women = mine.women
                  AND CASE WHEN $3::text IS NOT NULL THEN o.competition_key = (SELECT league FROM k)
                           ELSE mine.level IS NULL OR o.league_level IS NOT NULL END
                GROUP BY 1, 2, 3, 4, 5
                HAVING count(*) >= greatest(5, ceil(0.75 * max(mine.axes)))),
              top AS (SELECT * FROM pool ORDER BY similarity DESC, team_key LIMIT ${CLUB_SIMILAR_COUNT})
         SELECT mine.axes, (SELECT count(*) FROM pool)::int AS compared,
                api.public_id('team', t.team_key) AS id, pr.name, pr.image_url, t.similarity, t.closest,
                api.public_id('competition', t.competition_key) AS league_id, t.league_name, t.country,
                st.position, st.matches, st.won, st.drawn, st.lost
         FROM mine LEFT JOIN top t ON true
         LEFT JOIN api.team_profiles pr ON pr.team_id = t.team_key
         LEFT JOIN LATERAL (
           SELECT x.* FROM (SELECT team_id, matches, won, drawn, lost,
                                   rank() OVER (ORDER BY points DESC, goals_for - goals_against DESC, goals_for DESC)::int AS position
                            FROM api.team_season WHERE competition_season_id = t.competition_season_id) x
           WHERE x.team_id = t.team_key) st ON true
         ORDER BY t.similarity DESC, t.team_key`,
        [club[1], season, league, Object.keys(STYLE_AXES)],
      );
      if (!rows[0]?.axes) reject(404, "Donnée indisponible.");
      const data = { id: club[1], season, compared: rows[0].compared };
      put(data, "league", league);
      data.similar = rows
        .filter((r) => r.id)
        .map((r) => {
          const row = { id: r.id, name: r.name };
          put(row, "image_url", r.image_url);
          row.similarity = Math.max(0, Math.round(r.similarity));
          row.closest = r.closest.map((key) => STYLE_AXES[key]);
          row.league = { id: r.league_id, name: r.league_name, country: r.country ?? null };
          if (r.position != null) {
            row.position = r.position;
            row.record = { matches: r.matches, won: r.won, drawn: r.drawn, lost: r.lost };
          }
          return row;
        });
      return respond(req, data);
    }
    const similar = path.match(SIMILAR);
    if (similar) {
      validateParams(params, ["season"]);
      const season = params.get("season");
      if (!/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
      // The distances are computed on the vectors alone; only the nearest are then named.
      const rows = await read(
        `WITH me AS (SELECT * FROM api.player_embedding_vectors
                     WHERE season_id=(SELECT k.season_id FROM api.season_keys k WHERE k.season=$2) AND player_key=api.internal_id('player',$1)),
              d AS (SELECT o.season_id, o.player_key, sqrt(${SQUARES}) AS distance FROM api.player_embedding_vectors o
                    JOIN me ON o.season_id=me.season_id AND o.women=me.women AND o.player_key<>me.player_key),
              m AS (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY distance) AS median, count(*)::int AS players FROM d),
              n AS (SELECT * FROM d ORDER BY distance, player_key LIMIT ${SIMILAR_COUNT})
         SELECT p.player_id, p.name, p.image_url, p.minutes, p.role, p.team_id, p.team, p.score, n.distance, m.median, m.players
         FROM n CROSS JOIN m JOIN api.player_embedding_people p ON p.season_id=n.season_id AND p.player_key=n.player_key
         ORDER BY n.distance, n.player_key`,
        [similar[1], season],
      );
      if (!rows.length) reject(404, "Donnée indisponible.");
      return respond(req, {
        id: similar[1], season, compared: rows[0].players,
        similar: rows.map((r) => {
          const row = { id: r.player_id, name: r.name, similarity: similarity(r.distance, r.median), minutes: r.minutes };
          put(row, "image_url", r.image_url);
          put(row, "role", r.role);
          put(row, "position", r.role ? (ROLE_LABEL[r.role] ?? r.role) : null);
          if (r.team_id) row.team = { id: r.team_id, name: r.team };
          put(row, "score", r.score === null || r.score === undefined ? null : Math.round(r.score * 10) / 10);
          return row;
        }),
      });
    }
    if (path === "/api/player-market-values") {
      validateParams(params, ["id"]);
      const id = params.get("id");
      if (!PLAYER.test(`/api/players/${id}`)) reject(400, "Paramètre invalide.");
      const rows = await read(
        `SELECT valued_at::text AS date, value_eur AS "valueEur", club_id, club_name, club_image_url
         FROM api.player_market_values
         WHERE player_id=api.internal_id('player',$1)
         ORDER BY valued_at`,
        [id],
      );
      if (!rows.length) reject(404, "Donnée indisponible.");
      return respond(req, {
        currency: "EUR", source: "Transfermarkt",
        history: rows.map((r) => put({ date: r.date, valueEur: r.valueEur }, "club", namedClub(r.club_id, r.club_name, r.club_image_url))),
      });
    }
    if (path === "/api/players/facts-coverage") {
      validateParams(params, []);
      const [coverage] = await read("SELECT * FROM api.player_fact_coverage");
      return respond(req, coverage);
    }
    const player = path.match(PLAYER), team = path.match(TEAM);
    if (player || team) {
      validateParams(params, []);
      const [r] = player
        ? await read("SELECT * FROM api.player_profiles WHERE player_id=api.internal_id('player',$1)", [player[1]])
        : await read("SELECT * FROM api.team_profiles WHERE team_id=api.internal_id('team',$1)", [team[1]]);
      if (!r) reject(404, "Donnée indisponible.");
      const data = { id: r.public_id, name: r.name };
      for (const k of ["short_name", "country_code", "image_url", "position_id"]) put(data, k, r[k]);
      if (player) {
        put(data, "shirt_number", r.shirt_number === null ? null : String(r.shirt_number));
        put(data, "birth_date", r.birth_date);
        put(data, "height_cm", r.height_cm);
        put(data, "preferred_foot", r.preferred_foot);
        put(data, "contract_until", r.contract_until);
        put(data, "contract_team", r.contract_team);
        put(data, "contract_until_season", r.contract_until_season);
        put(data, "contract_season_competition", r.contract_season_competition);
        put(data, "observed_contract_until", r.observed_contract_until);
        put(data, "observed_contract_team", r.observed_contract_team);
        put(data, "observed_contract_on", r.observed_contract_on);
        put(data, "market_value_eur", r.market_value_eur);
        put(data, "market_value_updated_at", r.market_value_updated_at);
      }
      return respond(req, data);
    }
    if (path === "/api/competitions") {
      validateParams(params, []);
      const rows = await read("SELECT * FROM api.competitions ORDER BY name, id");
      return respond(req, {
        leagues: rows.map((c) => put(put({ id: c.id, name: c.name, seasons: [...(c.seasons || [])].sort() }, "image_url", c.image_url), "country_code", c.country)),
      });
    }
    return null;
  };
}

/**
 * GET /api/matches/{id} and GET /api/matches/{id}/<family> — a match and each of its
 * detail families, in the bodies the site reads today through the legacy provider proxy
 * (`{data}`; legacy /api/pitchapi/matches/{id}[/...]). Routes name what they serve, never a
 * source (030_neutral_reads.sql). Families: lineups, events, shots, stats, players,
 * players/halves, momentum, advanced, advanced/players, advanced/network, heatmaps
 * (`frame=acting_ltr|home_ltr`), h2h. Read from the api views of 031_match_details.sql;
 * the bodies are built by match-families.mjs.
 *
 * Differences with the legacy read, by construction (round-trip tested on a real
 * match, test/match-families.test.mjs):
 * - a value the source sent as null is omitted, as when the source leaves it out;
 * - numbers are the stored ones (reals: the float nearest to the source's value);
 * - players are listed home first in line-up order, network nodes and edges by passes,
 *   heatmap players by side then actions (the source's ties are in no stated order);
 * - a substitute's pitch position is 0, as the source sends it;
 * - head-to-head meetings name the teams without their crests, as the source does;
 * - a family that was not collected, or that the source said was unavailable, is a 404.
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";
import * as F from "../match-families.mjs";

const ROUTE = /^\/api\/matches\/(m_(?:[A-Za-z0-9]{6}|v\d{7}))(\/(?:lineups|events|shots|stats|players|players\/(?:halves|display)|momentum|advanced|advanced\/players|advanced\/network|heatmaps|h2h))?$/;
const FAMILY = {
  "/lineups": "lineups", "/events": "events", "/shots": "shots", "/stats": "team_stats", "/players": "player_stats", "/players/display": "player_stats",
  "/players/halves": "player_halves", "/momentum": "momentum", "/advanced": "advanced", "/advanced/players": "advanced_players",
  "/advanced/network": "network", "/heatmaps": "heatmaps", "/h2h": "h2h",
};
const where = "WHERE season_id=$1 AND match_id=$2";
const missing = () => reject(404, "Donnée indisponible.");

// Reuse the publication's measured-zero policy without changing the raw family or the
// season aggregates. These columns have the same meaning on both read views.
const APPEARANCE_STATS = {
  goals: "goals", assists: "assists", xg: "xg", npxg: "npxg", xgot: "xgot", xa: "xa",
  total_shots: "shots", shots_on_target: "shots_on_target", shots_off_target: "shots_off_target",
  blocked_shots: "blocked_shots", shots_woodwork: "shots_woodwork", chances_created: "chances_created",
  big_chances_created: "big_chances_created", big_chances_missed: "big_chances_missed",
  touches_opp_box: "touches_box", passes_into_final_third: "passes_final_third",
  long_balls_accurate: "long_balls_accurate", long_balls_total: "long_balls_attempted",
  accurate_crosses: "accurate_crosses", accurate_crosses_total: "crosses_attempted",
  corners: "corners", throw_ins: "throws", offsides: "offsides", dispossessed: "dispossessed",
  dribbled_past: "dribbled_past", headed_clearances: "headed_clearances", shot_blocks: "blocks",
  aerials_won: "aerials_won", aerials_total: "aerial_duels", ground_duels_won: "ground_duels_won",
  ground_duels_total: "ground_duels", duels_won: "duels_won", duels_lost: "duels_lost",
  was_fouled: "was_fouled", errors_led_to_goal: "errors_led_to_goal",
  goals_prevented: "goals_prevented", xgot_faced: "xgot_faced",
  dribbles_succeeded: "dribbles", dribbles_total: "dribbles_attempted",
};
const displayColumns = Object.entries(APPEARANCE_STATS).map(([key, column]) => `a.${column} AS ${key}`).join(",");
const byPlayer = (rows) => new Map(rows.map((row) => [row.player_id, row]));

async function displayPlayerRows(read, f, rows) {
  if (f.status !== "finished") return rows;
  const at = [f.season_id, f.match_id];
  const [appearances, carries] = await Promise.all([
    read(`SELECT a.player_id,${displayColumns} FROM api.player_appearances a
          WHERE a.season_id=$1 AND a.match_id=$2 AND a.minutes>0`, at),
    f.advanced_players === "ok"
      ? read(`SELECT player_id,take_ons,take_ons_won FROM api.match_player_advanced_rows ${where}`, at)
      : [],
  ]);
  const published = byPlayer(appearances);
  const advanced = byPlayer(carries);
  return rows.map((row) => {
    if (!(row.minutes_played > 0)) return row;
    const display = { ...row };
    const carries = advanced.get(row.player_id);
    // Keep the base pair when published. Only complete a partial pair when both feeds
    // agree on the component already present.
    if (Number.isInteger(carries?.take_ons_won) && Number.isInteger(carries.take_ons) &&
        carries.take_ons_won >= 0 && carries.take_ons_won <= carries.take_ons &&
        (row.dribbles_succeeded == null || row.dribbles_succeeded === carries.take_ons_won) &&
        (row.dribbles_total == null || row.dribbles_total === carries.take_ons)) {
      display.dribbles_succeeded ??= carries.take_ons_won;
      display.dribbles_total ??= carries.take_ons;
    }
    for (const [key, value] of Object.entries(published.get(row.player_id) || {})) {
      if (key !== "player_id" && value != null) display[key] ??= value;
    }
    return display;
  });
}

async function body(read, f, suffix, params) {
  const at = [f.season_id, f.match_id];
  switch (suffix) {
    case "":
      return F.matchBody(f);
    case "/lineups": {
      const [teams, players] = await Promise.all([
        read(`SELECT * FROM api.match_lineup_rows ${where} ORDER BY side DESC`, at),
        read(`SELECT * FROM api.match_lineup_player_rows ${where}`, at),
      ]);
      return F.lineupsBody(f, teams, players);
    }
    case "/events":
      return F.eventsBody(f.id, await read(`SELECT * FROM api.match_event_rows ${where} ORDER BY seq`, at));
    case "/shots":
      return F.shotsBody(f.id, await read(`SELECT * FROM api.match_shot_rows ${where} ORDER BY shot_no`, at));
    case "/stats": {
      const [stats, pressing] = await Promise.all([
        read(`SELECT * FROM api.match_team_stat_rows ${where}`, at),
        read(`SELECT * FROM api.match_team_pressing_rows ${where}`, at),
      ]);
      // A team's pressing and territory figures of a period (092), beside its other statistics.
      const rows = stats.map((r) => ({ ...r, ...pressing.find((p) => p.team_id === r.team_id && p.period_name === r.period_name) }));
      return {
        match_id: f.id, away_team: { id: f.away_team_id, name: f.away_name, image_url: f.away_image_url },
        home_team: { id: f.home_team_id, name: f.home_name, image_url: f.home_image_url },
        periods: F.teamStatPeriods(rows.filter((r) => r.team_id === f.home_internal_id), rows.filter((r) => r.team_id === f.away_internal_id)),
      };
    }
    case "/players":
    case "/players/display":
    case "/players/halves": {
      const [rows, lineup] = await Promise.all([
        // The whole match's rows carry each player's Vega grade (the halves have none), shown by
        // every reader's one rule: from 20 minutes, or below them when |z| >= 1 (performance.mjs
        // SHOWN, rankings.mjs GRADE_MINUTES, api.player_appearances; FAILURE_MODES §38).
        suffix !== "/players/halves"
          ? read(`SELECT r.*,CASE WHEN g.minutes>=20 OR abs(g.match_index)>=1 THEN g.grade END AS grade
             FROM api.match_player_stat_rows r LEFT JOIN api.match_grades g
               ON g.edition_season=r.season_id AND g.match_key=r.match_id AND g.player_id=r.player_public_id
             WHERE r.season_id=$1 AND r.match_id=$2`, at)
          : read(`SELECT * FROM api.match_player_half_rows ${where}`, at),
        read(`SELECT player_id,is_starter,lineup_order FROM api.match_lineup_player_rows ${where}`, at),
      ]);
      const order = F.playerOrder(f, lineup);
      if (suffix === "/players/halves") return F.halvesBody(f.id, rows, order);
      return F.playersBody(suffix === "/players/display" ? await displayPlayerRows(read, f, rows) : rows, order);
    }
    case "/momentum":
      return F.momentumBody(f.id, await read(`SELECT * FROM api.match_momentum_rows ${where} ORDER BY minute`, at));
    case "/advanced":
      return F.advancedTeamsBody(f, await read(`SELECT * FROM api.match_team_advanced_rows ${where}`, at));
    case "/advanced/players":
      return F.advancedPlayersBody(f.id, await read(`SELECT * FROM api.match_player_advanced_rows ${where}`, at));
    case "/advanced/network": {
      const [teams, nodes, edges] = await Promise.all([
        read(`SELECT * FROM api.match_network_rows ${where}`, at),
        read(`SELECT * FROM api.match_network_node_rows ${where}`, at),
        read(`SELECT * FROM api.match_network_edge_rows ${where}`, at),
      ]);
      return F.networkBody(f, teams, nodes, edges);
    }
    case "/heatmaps":
      return F.heatmapsBody(f.id, await read(`SELECT * FROM api.match_heatmap_rows ${where}`, at), params.get("frame") || "acting_ltr");
    case "/h2h": {
      const [[h], meetings] = await Promise.all([
        read(`SELECT * FROM api.match_h2h_rows ${where}`, at),
        read(`SELECT * FROM api.match_h2h_meeting_rows ${where} ORDER BY seq`, at),
      ]);
      if (!h) missing();
      return F.h2hBody(f, h, meetings);
    }
  }
  return missing();
}

export function createMatchDetailRoute(read) {
  return async (req, path, params) => {
    const m = path.match(ROUTE);
    if (!m) return null;
    const [, id, suffix = ""] = m;
    validateParams(params, suffix === "/heatmaps" ? ["frame", "v"] : ["v"]);
    if (params.has("frame") && !/^(acting_ltr|home_ltr)$/.test(params.get("frame"))) reject(400, "Paramètre invalide.");
    if (params.has("v") && !/^[\w.-]{1,200}$/.test(params.get("v"))) reject(400, "Paramètre invalide.");
    const [f] = await read(
      `SELECT f.*,c.* FROM api.fixtures f LEFT JOIN api.match_family_coverage c ON c.season_id=f.season_id AND c.match_id=f.match_id
       WHERE f.match_id=api.internal_id('match',$1)`,
      [id],
    );
    if (!f) reject(404, "Match introuvable.");
    if (suffix && f[FAMILY[suffix]] !== "ok") missing();
    // Published zeros can change after recalculation without a new raw match revision.
    if (suffix === "/players/display") {
      const data = await body(read, f, suffix, params);
      const etag = `W/"match-display-${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;
      const ttl = f.status === "finished" ? 60 : 15;
      if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl });
      return send(req, { data }, 200, { etag, ttl, maxBytes: 2 * 1024 * 1024 });
    }
    const url = new URL(req.url);
    const etag = `W/"match-v1-${createHash("sha256").update(`${url.pathname}|${params.get("frame") ?? ""}|${f.revision}`).digest("hex")}"`;
    const ttl = f.status === "finished" ? 60 : 15;
    if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl });
    return send(req, { data: await body(read, f, suffix, params) }, 200, { etag, ttl, maxBytes: 2 * 1024 * 1024 });
  };
}

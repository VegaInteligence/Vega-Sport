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

const ROUTE = /^\/api\/matches\/(m_(?:[A-Za-z0-9]{6}|v\d{7}))(\/(?:lineups|events|shots|stats|players|players\/halves|momentum|advanced|advanced\/players|advanced\/network|heatmaps|h2h))?$/;
const FAMILY = {
  "/lineups": "lineups", "/events": "events", "/shots": "shots", "/stats": "team_stats", "/players": "player_stats",
  "/players/halves": "player_halves", "/momentum": "momentum", "/advanced": "advanced", "/advanced/players": "advanced_players",
  "/advanced/network": "network", "/heatmaps": "heatmaps", "/h2h": "h2h",
};
const where = "WHERE season_id=$1 AND match_id=$2";
const missing = () => reject(404, "Donnée indisponible.");

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
      const rows = await read(`SELECT * FROM api.match_team_stat_rows ${where}`, at);
      return {
        match_id: f.id, away_team: { id: f.away_team_id, name: f.away_name, image_url: f.away_image_url },
        home_team: { id: f.home_team_id, name: f.home_name, image_url: f.home_image_url },
        periods: F.teamStatPeriods(rows.filter((r) => r.team_id === f.home_internal_id), rows.filter((r) => r.team_id === f.away_internal_id)),
      };
    }
    case "/players":
    case "/players/halves": {
      const [rows, lineup] = await Promise.all([
        read(`SELECT * FROM api.${suffix === "/players" ? "match_player_stat_rows" : "match_player_half_rows"} ${where}`, at),
        read(`SELECT player_id,is_starter,lineup_order FROM api.match_lineup_player_rows ${where}`, at),
      ]);
      const order = F.playerOrder(f, lineup);
      return suffix === "/players" ? F.playersBody(rows, order) : F.halvesBody(f.id, rows, order);
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
    const url = new URL(req.url);
    const etag = `W/"match-v1-${createHash("sha256").update(`${url.pathname}|${params.get("frame") ?? ""}|${f.revision}`).digest("hex")}"`;
    const ttl = f.status === "finished" ? 60 : 15;
    if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl });
    return send(req, { data: await body(read, f, suffix, params) }, 200, { etag, ttl, maxBytes: 2 * 1024 * 1024 });
  };
}

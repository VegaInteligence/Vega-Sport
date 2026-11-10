/**
 * GET /api/read/presence — where a player was active over at most 200 matches: his
 * activity maps of those matches added up, same parameters and same response as
 * relational-player-presence.js on main, read from api.player_presence (053). A map counts
 * when the player took part in the match for one of its two teams and the map is whole
 * (its cells add up to its actions); it is stored in the direction his team attacks, so
 * nothing is turned here.
 */
import { reject, validateParams } from "../http.mjs";
import { bindValue, checkReadGeneration, parseReadScope, publicationSql, readResponse, scopeWhere } from "../publication.mjs";

const PLAYER = /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/,
  MATCH = /^m_(?:[A-Za-z0-9]{6}|v\d{7})$/;

export function createPresenceRoute(read) {
  return async (req, path, supplied) => {
    if (path !== "/api/read/presence") return null;
    if (!["GET", "HEAD"].includes(req.method)) reject(405, "Méthode non autorisée.");
    validateParams(supplied, ["season", "leagues", "league", "generation", "player", "matches"]);
    const scope = parseReadScope(supplied),
      player = supplied.get("player"),
      raw = supplied.get("matches");
    if (!PLAYER.test(player || "")) reject(400, "Identifiant invalide.");
    if (raw === null) reject(400, "Matchs requis.");
    const matches = [...new Set(raw === "" ? [] : raw.split(","))].sort();
    if (matches.length > 200 || matches.some((id) => !MATCH.test(id))) reject(400, "La sélection accepte au plus 200 matchs natifs.");
    const params = new URLSearchParams(supplied);
    params.set("matches", matches.join(","));
    const values = [],
      publication = publicationSql(scope, values),
      requested = bindValue(values, matches),
      actor = bindValue(values, player),
      appearanceScope = scopeWhere("a", scope, values),
      fence = params.has("generation") ? `AND (SELECT generation FROM publication)=${bindValue(values, params.get("generation"))}` : "";
    const [snapshot] = await read(
      `WITH publication AS MATERIALIZED (${publication}),
       actor AS MATERIALIZED (SELECT api.internal_id('player',${actor}) id),
       requested AS MATERIALIZED (SELECT k AS match_key,api.internal_id('match',k) match_id FROM unnest(${requested}::text[]) k),
       eligible AS MATERIALIZED (
         SELECT r.match_key,a.season_id,a.match_id,min(a.team_id) team_id FROM requested r
         JOIN api.player_appearances a ON a.match_id=r.match_id AND a.player_id=(SELECT id FROM actor)
         WHERE ${appearanceScope} AND a.status='finished' ${fence}
         GROUP BY r.match_key,a.season_id,a.match_id
         HAVING count(DISTINCT a.team_id)=1 AND bool_and(a.team_id IS NOT NULL) AND bool_or(a.minutes IS NULL OR a.minutes>0)
           AND min(a.team_id) IN (min(a.home_team_id),min(a.away_team_id)) AND min(a.home_team_id)<>min(a.away_team_id)
       ),
       chosen AS MATERIALIZED (
         SELECT e.match_key,h.actions,h.cells,h.updated_at FROM eligible e
         JOIN api.player_presence h ON h.season_id=e.season_id AND h.match_id=e.match_id AND h.player_id=(SELECT id FROM actor) AND h.team_id=e.team_id
         WHERE h.actions>0 AND (SELECT sum(v) FROM unnest(h.cells) v)=h.actions
       ),
       summed AS (
         SELECT (u.i-1)%16 x,(u.i-1)/16 y,sum(u.v)::bigint value
         FROM chosen c CROSS JOIN LATERAL unnest(c.cells) WITH ORDINALITY u(v,i) WHERE u.v>0 GROUP BY 1,2
       )
       SELECT publication.*,(SELECT count(*)::int FROM requested) requested,(SELECT count(*)::int FROM chosen) covered,
         coalesce((SELECT sum(actions)::bigint FROM chosen),0) actions,
         coalesce((SELECT jsonb_agg(jsonb_build_array(x,y,value) ORDER BY x,y) FROM summed),'[]'::jsonb) cells,
         coalesce((SELECT string_agg(match_key||':'||(extract(epoch FROM updated_at)*1000)::bigint,'|' ORDER BY match_key) FROM chosen),'') presence_version
       FROM publication`,
      values,
    );
    checkReadGeneration(params, snapshot?.generation);
    // A map collected again changes the answer without a publication: it takes part in validation.
    return readResponse(
      req,
      params,
      snapshot,
      { requested: Number(snapshot.requested), covered: Number(snapshot.covered), actions: Number(snapshot.actions), length: 16, width: 12, cells: snapshot.cells },
      { periodKey: snapshot.presence_version, maxBytes: 64 * 1024, ttl: 30 },
    );
  };
}

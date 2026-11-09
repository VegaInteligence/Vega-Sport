import { query } from "./postgres.js";
import { reject, validateParams } from "./relational-core.js";
import {
  bindValue,
  checkReadGeneration,
  parseReadScope,
  publicationSql,
  readResponse,
  scopeWhere,
} from "./relational-read-utils.js";

export function createPlayerPresenceRoute(read = query) {
  return async function playerPresence(req, path, suppliedParams) {
    if (path !== "/api/read/presence") return null;
    if (!["GET", "HEAD"].includes(req.method))
      reject(405, "Méthode non autorisée.");
    validateParams(suppliedParams, [
      "season",
      "league",
      "leagues",
      "generation",
      "player",
      "matches",
    ]);
    const scope = parseReadScope(suppliedParams),
      player = suppliedParams.get("player"),
      raw = suppliedParams.get("matches");
    if (!/^p_[A-Za-z0-9]{6}$/.test(player || ""))
      reject(400, "Identifiant invalide.");
    if (raw === null) reject(400, "Matchs requis.");
    const matches = [...new Set(raw === "" ? [] : raw.split(","))].sort();
    if (
      matches.length > 200 ||
      matches.some((id) => !/^m_[A-Za-z0-9]{6}$/.test(id))
    )
      reject(400, "La sélection accepte au plus 200 matchs natifs.");
    const params = new URLSearchParams(suppliedParams);
    params.set("matches", matches.join(","));
    const values = [],
      publication = publicationSql(scope, values),
      requested = bindValue(values, matches),
      actor = bindValue(values, player),
      ms = scopeWhere("m", scope, values),
      appearanceScope = scopeWhere("a", scope, values),
      fence = params.has("generation")
        ? `AND (SELECT generation FROM publication)=${bindValue(values, params.get("generation"))}`
        : "";
    const [snapshot] = await read(
      `WITH publication AS MATERIALIZED (${publication}),
      requested AS (SELECT unnest(${requested}::text[]) match_id),
      eligible AS MATERIALIZED (
        SELECT m.id,m.home_id,m.away_id,min(a.team_id) team_id
        FROM requested r JOIN statarena_app.matches m ON m.id=r.match_id
        JOIN statarena_app.appearances a ON a.match_id=m.id AND a.player_id=${actor} AND ${appearanceScope}
        WHERE ${ms} AND m.status='finished' ${fence}
        GROUP BY m.id,m.home_id,m.away_id
        HAVING count(DISTINCT a.team_id)=1 AND bool_and(a.team_id IS NOT NULL)
          AND bool_or(a.minutes IS NULL OR a.minutes>0)
          AND min(a.team_id) IN (m.home_id,m.away_id) AND m.home_id<>m.away_id
      ), families AS MATERIALIZED (
        SELECT e.*,f.resource_id,f.source_digest,f.params,f.status,f.has_data,f.has_error,f.error_object,
          CASE f.params WHEN '{}' THEN 0 WHEN '{"frame":"acting_ltr"}' THEN 1 ELSE 2 END priority
        FROM eligible e JOIN statarena_app.match_families f ON f.match_id=e.id
          AND f.family='heatmaps' AND f.subject_id='' AND f.params IN ('{}','{"frame":"acting_ltr"}','{"frame":"home_ltr"}')
      ), maps AS MATERIALIZED (
        SELECT f.*,s.grid_frame,p.cells,p.actions,p.side,
          p.missing AS player_missing,p.null_groups AS player_null_groups,
          count(*) OVER (PARTITION BY f.resource_id) candidates
        FROM families f
        JOIN LATERAL (
          SELECT s.* FROM statarena_app.heatmap_sheets s
          WHERE s.resource_id=f.resource_id AND s.record_no=0 AND s.match_id=f.id
          LIMIT 1
        ) s ON true
        JOIN LATERAL (
          SELECT p.* FROM statarena_app.player_heatmaps p
          WHERE p.resource_id=f.resource_id AND p.parent_no=s.record_no
            AND p.player_id=${actor} AND p.team_id=f.team_id
          LIMIT 2
        ) p ON true
        WHERE f.status=200 AND f.has_data AND NOT (f.has_error AND f.error_object)
          AND s.grid_length=16 AND s.grid_width=12
          AND ((f.params='{"frame":"home_ltr"}' AND s.grid_frame='home_ltr') OR (f.params IN ('{}','{"frame":"acting_ltr"}') AND s.grid_frame='acting_ltr'))
          AND NOT (s.missing && ARRAY['grid','grid.frame','grid.length','grid.width','players','match_id']::text[])
          AND NOT (s.null_groups && ARRAY['grid','players']::text[])
      ), checked AS MATERIALIZED (
        SELECT m.*, c.n,c.total,c.distinct_cells,c.valid
        FROM maps m CROSS JOIN LATERAL (
          SELECT count(*) n,coalesce(sum(m.cells[i][3]),0) total,
            count(DISTINCT (m.cells[i][1],m.cells[i][2])) distinct_cells,
            coalesce(bool_and(coalesce(m.cells[i][1] BETWEEN 0 AND 15 AND m.cells[i][2] BETWEEN 0 AND 11 AND m.cells[i][3]>=0,false)),false) valid
          FROM generate_subscripts(m.cells,1) i
        ) c
        WHERE m.candidates=1 AND m.actions>0
          AND m.side=CASE WHEN m.team_id=m.home_id THEN 'home' ELSE 'away' END
          AND NOT (m.player_missing && ARRAY['cells','actions','player','player.id','team','team.id','side']::text[])
          AND NOT (m.player_null_groups && ARRAY['cells','player','team']::text[])
          AND array_ndims(m.cells)=2 AND array_length(m.cells,2)=3
      ), chosen AS MATERIALIZED (
        SELECT DISTINCT ON(id) * FROM checked WHERE valid AND n>0 AND n=distinct_cells AND total=actions ORDER BY id,priority
      ), points AS (
        SELECT CASE WHEN c.grid_frame='home_ltr' AND c.team_id=c.away_id THEN 15-c.cells[i][1] ELSE c.cells[i][1] END x,
          CASE WHEN c.grid_frame='home_ltr' AND c.team_id=c.away_id THEN 11-c.cells[i][2] ELSE c.cells[i][2] END y,c.cells[i][3] value
        FROM chosen c CROSS JOIN LATERAL generate_subscripts(c.cells,1) i
      ), summed AS (SELECT x,y,sum(value)::bigint value FROM points WHERE value>0 GROUP BY x,y)
      SELECT publication.*,(SELECT count(*)::int FROM requested) requested,(SELECT count(*)::int FROM chosen) covered,
        coalesce((SELECT sum(actions)::bigint FROM chosen),0) actions,
        coalesce((SELECT jsonb_agg(jsonb_build_array(x,y,value) ORDER BY x,y) FROM summed),'[]'::jsonb) cells,
        coalesce((SELECT string_agg(id||':'||params||':'||source_digest,'|' ORDER BY id,params) FROM families),'') presence_version
      FROM publication`,
      values,
    );
    checkReadGeneration(params, snapshot?.generation);
    return readResponse(
      req,
      params,
      snapshot,
      {
        requested: Number(snapshot.requested),
        covered: Number(snapshot.covered),
        actions: Number(snapshot.actions),
        length: 16,
        width: 12,
        cells: snapshot.cells,
      },
      { periodKey: snapshot.presence_version, maxBytes: 65536, ttl: 30 },
    );
  };
}
export const relationalPlayerPresenceRoute = createPlayerPresenceRoute();

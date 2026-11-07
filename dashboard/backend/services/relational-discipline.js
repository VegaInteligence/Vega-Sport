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
import { summarizeDiscipline } from "../../shared/player-discipline.js";

/** At most 200 exact matches, one publication snapshot and no native HTTP fan-out. */
export function createDisciplineRoute(read = query) {
  return async function relationalDisciplineRoute(req, path, suppliedParams) {
    if (path !== "/api/read/discipline") return null;
    if (!["GET", "HEAD"].includes(req.method))
      reject(405, "Méthode non autorisée.");
    validateParams(suppliedParams, [
      "season",
      "leagues",
      "league",
      "generation",
      "player",
      "matches",
    ]);
    const scope = parseReadScope(suppliedParams),
      player = suppliedParams.get("player"),
      rawMatches = suppliedParams.get("matches");
    if (!/^p_[A-Za-z0-9]{6}$/.test(player || ""))
      reject(400, "Identifiant invalide.");
    if (rawMatches === null) reject(400, "Matchs requis.");
    const matches = [
      ...new Set(rawMatches === "" ? [] : rawMatches.split(",")),
    ].sort();
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
      matchScope = scopeWhere("m", scope, values),
      appearanceScope = scopeWhere("a", scope, values),
      fence = params.has("generation")
        ? `AND (SELECT generation FROM publication)=${bindValue(values, params.get("generation"))}`
        : "";
    const [snapshot] = await read(
      `WITH publication AS MATERIALIZED (${publication}),
       requested AS (SELECT unnest(${requested}::text[]) match_id),
       eligible AS MATERIALIZED (
         SELECT m.id FROM requested r JOIN statarena_app.matches m ON m.id=r.match_id
         WHERE ${matchScope} ${fence} AND EXISTS (
           SELECT 1 FROM statarena_app.appearances a
           WHERE a.match_id=m.id AND a.player_id=${actor} AND ${appearanceScope}
         )
       ),
       selected AS MATERIALIZED (
         SELECT r.match_id,f.resource_id,f.source_digest,s.record_no,
           f.status=200 AND f.has_data AND NOT (f.has_error AND f.error_object)
           AND s.resource_id IS NOT NULL AND NOT ('events'=ANY(s.missing))
           AND NOT ('events'=ANY(s.null_groups)) AS covered
         FROM requested r LEFT JOIN eligible e ON e.id=r.match_id
         LEFT JOIN statarena_app.match_families f ON f.match_id=e.id
           AND f.family='events' AND f.params='{}' AND f.subject_id=''
         LEFT JOIN statarena_app.event_sheets s ON s.resource_id=f.resource_id AND s.record_no=0
       ),
       observations AS (
         SELECT s.match_id,s.source_digest,
           CASE WHEN s.covered THEN jsonb_build_object('events',(
             SELECT coalesce(jsonb_agg(
               jsonb_build_object('event_type',e.event_type,'minute',e.minute,
                 'minute_added',e.minute_added,'period',e.period,
                 'player',jsonb_build_object('id',e.player_id))-e.missing
               ORDER BY e.position),'[]'::jsonb)
             FROM statarena_app.match_events e
             WHERE e.resource_id=s.resource_id AND e.parent_no=s.record_no
               AND e.player_id=${actor} AND NOT ('player'=ANY(e.null_groups))
               AND NOT (e.missing && ARRAY['player','player.id','event_type']::text[])
               AND lower(e.event_type) IN ('yellowcard','secondyellow','redcard')
           )) END AS data
         FROM selected s
       )
       SELECT publication.*,
         coalesce((SELECT jsonb_agg(o.data ORDER BY o.match_id) FROM observations o),'[]'::jsonb) observations,
         coalesce((SELECT string_agg(s.match_id||':'||coalesce(s.source_digest,''),'|' ORDER BY s.match_id)
           FROM selected s),'') events_version
       FROM publication`,
      values,
    );
    checkReadGeneration(params, snapshot?.generation);
    // Event-only corrections need not change the core partition generation.
    // Its family digests therefore participate in conditional validation too.
    return readResponse(
      req,
      params,
      snapshot,
      summarizeDiscipline(player, snapshot.observations),
      { periodKey: snapshot.events_version, maxBytes: 64 * 1024, ttl: 30 },
    );
  };
}

export const relationalDisciplineRoute = createDisciplineRoute();

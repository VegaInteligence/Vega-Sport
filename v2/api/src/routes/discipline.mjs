/**
 * GET /api/read/discipline — a player's cards over at most 200 matches, same
 * parameters and same response as relational-discipline.js on main, read from
 * api.player_cards (023) for the matches whose events were collected.
 */
import { reject, validateParams } from "../http.mjs";
import { bindValue, checkReadGeneration, parseReadScope, publicationSql, readResponse, scopeWhere } from "../publication.mjs";

const PLAYER = /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/,
  MATCH = /^m_(?:[A-Za-z0-9]{6}|v\d{7})$/;

/** shared/player-discipline.js on main, on the v2 event types (one row per card). */
export function summarizeDiscipline(results) {
  const totals = { yellow: 0, directRed: 0, secondYellow: 0 };
  for (const result of results) {
    if (!Array.isArray(result?.events)) continue;
    for (const event of result.events) {
      if (event.event_type === "yellow_card") totals.yellow++;
      if (event.event_type === "second_yellow") totals.secondYellow++;
      if (event.event_type === "red_card") {
        const paired = result.events.some(
          (other) =>
            other.event_type === "second_yellow" &&
            event.minute != null &&
            other.minute === event.minute &&
            (other.minute_added ?? 0) === (event.minute_added ?? 0) &&
            other.period === event.period,
        );
        if (!paired) totals.directRed++;
      }
    }
  }
  return { ...totals, covered: results.filter((r) => Array.isArray(r?.events)).length, total: results.length };
}

export function createDisciplineRoute(read) {
  return async (req, path, supplied) => {
    if (path !== "/api/read/discipline") return null;
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
         SELECT DISTINCT r.match_key,a.season_id,a.match_id FROM requested r
         JOIN api.player_appearances a ON a.match_id=r.match_id AND a.player_id=(SELECT id FROM actor)
         WHERE ${appearanceScope} ${fence}
       ),
       selected AS MATERIALIZED (
         SELECT r.match_key,e.season_id,e.match_id,coalesce(d.events_ok,false) covered,f.revision
         FROM requested r LEFT JOIN eligible e ON e.match_key=r.match_key
         LEFT JOIN api.match_detail_state d ON d.season_id=e.season_id AND d.match_id=e.match_id
         LEFT JOIN api.fixtures f ON f.match_id=e.match_id
       )
       SELECT publication.*,
         coalesce((SELECT jsonb_agg(CASE WHEN s.covered THEN jsonb_build_object('events',(
             SELECT coalesce(jsonb_agg(jsonb_build_object('event_type',c.event_type,'minute',c.minute,'minute_added',c.minute_added,'period',c.period) ORDER BY c.seq),'[]'::jsonb)
             FROM api.player_cards c WHERE c.season_id=s.season_id AND c.match_id=s.match_id AND c.player_id=(SELECT id FROM actor))) END
           ORDER BY s.match_key) FROM selected s),'[]'::jsonb) observations,
         coalesce((SELECT string_agg(s.match_key||':'||coalesce(s.revision::text,''),'|' ORDER BY s.match_key) FROM selected s),'') events_version
       FROM publication`,
      values,
    );
    checkReadGeneration(params, snapshot?.generation);
    // Event-only corrections bump the match revision: it takes part in validation.
    return readResponse(req, params, snapshot, summarizeDiscipline(snapshot.observations), {
      periodKey: snapshot.events_version,
      maxBytes: 64 * 1024,
      ttl: 30,
    });
  };
}

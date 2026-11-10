/**
 * GET /api/search — players and clubs of a season by name, same parameters, same
 * ranking and same response as relational-discovery.js on main.
 *
 * A player is found by a name containing every term (the terms may also match his
 * team or league in the season), or by a curated alias equal to a term; a club by
 * its name or its initials. Ranks: 0 exact name, alias or initials; 1 prefix; 2 other.
 * Only players and clubs present in the season are returned (six and four, with a
 * "has more" flag). Differences with the legacy read: aliases come from
 * core.entity_names; a club's main edition is the one where it played most matches.
 */
import { createHash } from "node:crypto";
import { inEuropeFocus } from "../../../../dashboard/shared/competition-scope.js";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";

const LIMITS = { players: 6, clubs: 4 };
const normalized = (value) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
// Players and clubs are compared on their stored search names (057): the same folding.
const textSql = (column) => `regexp_replace(normalize(lower(${column}),NFD),'[̀-ͯ]','','g')`;
const searchTag = (version, season, needle) =>
  `W/"search-v1-${createHash("sha256").update(JSON.stringify([version, season, needle])).digest("hex")}"`;

// $1 needle, $2 season, $3 %needle%, $4 needle%, $5 %term% patterns, $6 terms, $7 the
// season's id (bound, so only that season's partitions are planned and read).
//
// A short needle matches thousands of names and the season holds a million appearances,
// so the season is read as little as possible:
//  - a term never holds a separator, so it matches "name team league" exactly when it
//    matches one of the three. What a candidate's own name and aliases leave unmatched
//    (missing) can only be matched by a club or a league: the clubs and the season's
//    editions each term names are found once (term_teams, term_leagues), by name;
//  - a candidate whose missing terms no club and no league name is dropped without
//    reading the season; the others are checked on their appearances' ids
//    (api.player_match_keys): the club first, the match's edition only when a league
//    names a term;
//  - the candidates are sorted first (rank, name), then checked in that order, and the
//    check stops at the seventh that passes. The inner ORDER BY ... OFFSET 0 keeps the
//    sorted list as it is (PostgreSQL does not merge it into the outer query), and the
//    CASE is evaluated per row, in order.
const searchSql = `/*vega:v2:search*/
WITH alias_hits AS MATERIALIZED (
 SELECT DISTINCT a.player_id,x.pattern FROM api.player_search_aliases a
 CROSS JOIN LATERAL unnest($6::text[],$5::text[]) AS x(term,pattern)
 WHERE x.term=ANY(string_to_array(a.search_aliases,' '))
), term_teams AS MATERIALIZED (
 SELECT x.pattern,t.team_id FROM unnest($5::text[]) AS x(pattern) JOIN api.team_keys t ON t.search_name LIKE x.pattern
), term_leagues AS MATERIALIZED (
 SELECT x.pattern,e.competition_season_id FROM unnest($5::text[]) AS x(pattern)
 JOIN api.edition_keys e ON e.season_id=$7::smallint AND ${textSql("e.league")} LIKE x.pattern
), answerable AS MATERIALIZED (
 SELECT coalesce(array_agg(DISTINCT u.pattern),'{}') AS patterns
 FROM (SELECT pattern FROM term_teams UNION ALL SELECT pattern FROM term_leagues) u
), player_candidates AS MATERIALIZED (
 SELECT c.player_id,k.public_id AS id,c.label AS name,k.image_url,c.rank FROM (
  SELECT n.player_id,n.label,n.rank FROM (
   SELECT p.player_id,p.name AS label,
   CASE WHEN p.search_name=$1 OR p.player_id IN (SELECT player_id FROM alias_hits) THEN 0
     WHEN p.search_name LIKE $4 THEN 1 ELSE 2 END AS rank,
   ARRAY(SELECT x.pattern FROM unnest($5::text[]) AS x(pattern) WHERE p.search_name NOT LIKE x.pattern
     AND (p.player_id,x.pattern) NOT IN (SELECT player_id,pattern FROM alias_hits)) AS missing
   FROM api.player_keys p
   WHERE p.search_name LIKE ANY($5::text[]) OR p.player_id IN (SELECT player_id FROM alias_hits)
   ORDER BY rank,label OFFSET 0) n
  WHERE CASE
   WHEN n.missing='{}' THEN (SELECT true FROM api.player_match_keys a
     WHERE a.player_id=n.player_id AND a.season_id=$7::smallint LIMIT 1)
   WHEN n.missing<@(SELECT patterns FROM answerable) THEN (SELECT true FROM api.player_match_keys a
     WHERE a.player_id=n.player_id AND a.season_id=$7::smallint
     AND (NOT EXISTS (SELECT 1 FROM unnest(n.missing) AS term(pattern)
         WHERE ((term.pattern,a.team_id) IN (SELECT pattern,team_id FROM term_teams)) IS NOT TRUE)
       OR (EXISTS (SELECT 1 FROM term_leagues) AND NOT EXISTS (SELECT 1 FROM unnest(n.missing) AS term(pattern)
         WHERE ((term.pattern,a.team_id) IN (SELECT pattern,team_id FROM term_teams)) IS NOT TRUE
           AND ((term.pattern,a.competition_season_id) IN (SELECT pattern,competition_season_id FROM term_leagues)) IS NOT TRUE)))
     LIMIT 1)
   END
  ORDER BY n.rank,n.label FETCH FIRST 7 ROWS WITH TIES) c
 JOIN api.player_keys k ON k.player_id=c.player_id
 ORDER BY c.rank,c.label,k.public_id LIMIT 7
), players AS (
 SELECT c.id,c.rank,c.name,c.image_url,a.team,a.league_id,a.league,a.country
 FROM player_candidates c
 CROSS JOIN LATERAL (SELECT a.team,a.league_id,a.league,a.country FROM api.player_appearances a
   WHERE a.player_id=c.player_id AND a.season_id=$7::smallint
   ORDER BY a.date DESC NULLS LAST,a.kickoff_at DESC NULLS LAST,a.match_id DESC LIMIT 1) a
), club_names AS MATERIALIZED (
 SELECT t.team_id,t.public_id AS id,t.name,t.image_url,t.country,
 CASE WHEN t.search_name=$1 OR t.search_initials=$1 THEN 0 WHEN t.search_name LIKE $4 THEN 1 ELSE 2 END AS rank
 FROM api.team_keys t
 WHERE t.search_name LIKE $3 OR t.search_initials LIKE $4
), preferred_clubs AS MATERIALIZED (
 SELECT c.* FROM club_names c WHERE c.rank<2 AND EXISTS (SELECT 1 FROM api.team_editions e WHERE e.team_id=c.team_id AND e.season=$2)
 ORDER BY c.rank,c.name,c.id LIMIT 5
), other_clubs AS MATERIALIZED (
 SELECT c.* FROM club_names c WHERE c.rank=2 AND EXISTS (SELECT 1 FROM api.team_editions e WHERE e.team_id=c.team_id AND e.season=$2)
 ORDER BY c.name,c.id LIMIT (SELECT 5-count(*) FROM preferred_clubs)
), clubs AS (
 SELECT c.id,c.rank,c.name,c.image_url,c.country,e.league_id,e.league,e.league_country
 FROM (SELECT * FROM preferred_clubs UNION ALL SELECT * FROM other_clubs) c
 CROSS JOIN LATERAL (SELECT e.league_id,e.league,e.league_country FROM api.team_editions e
   WHERE e.team_id=c.team_id AND e.season=$2 ORDER BY e.matches DESC,e.league_id LIMIT 1) e
)
SELECT g.generation::text AS version,
 coalesce((SELECT json_agg(p ORDER BY p.rank,p.name,p.id) FROM players p),'[]'::json) AS players,
 coalesce((SELECT json_agg(t ORDER BY t.rank,t.name,t.id) FROM clubs t),'[]'::json) AS clubs
FROM api.publication g`;

function result(rows, kind) {
  return rows.slice(0, LIMITS[kind]).map((row) => ({
    kind,
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    meta: (kind === "players" ? row.team : row.league) || "",
    outside: !inEuropeFocus({ id: row.league_id, name: row.league, country: row.league_country || row.country }),
    rank: Number(row.rank),
  }));
}

export function createSearchRoute(read) {
  return async (req, path, params) => {
    if (path !== "/api/search") return null;
    if (!["GET", "HEAD"].includes(req.method)) reject(405, "Méthode non autorisée.");
    validateParams(params, ["q", "season"]);
    const raw = params.get("q") || "",
      season = params.get("season");
    if (raw.length > 100 || /[\u0000-\u001f\u007f]/.test(raw) || !/^\d{4}(?:\/\d{4})?$/.test(season || "")) reject(400, "Recherche invalide.");
    const needle = normalized(raw);
    if (needle.length < 2) return send(req, { players: [], clubs: [], playersHasMore: false, clubsHasMore: false }, 200);
    const terms = [...new Set(needle.split(/[\s\-'’.]+/).filter(Boolean))];
    if (terms.length > 8) reject(400, "La recherche accepte huit termes au maximum.");
    // The season's id is resolved before the search and bound: a season the database does
    // not know has no player (null matches no partition).
    const [state] = await read(
      "SELECT (SELECT generation::text FROM api.publication) AS version,(SELECT k.season_id FROM api.season_keys k WHERE k.season=$1) AS season_id",
      [season],
    );
    if (state?.version == null) reject(503, "Catalogue indisponible.");
    const conditional = req.headers.get("if-none-match");
    if (req.method === "HEAD" || conditional) {
      const etag = searchTag(state.version, season, needle);
      if (req.method === "HEAD" || matchesEtag(conditional, etag)) return send(req, null, 200, { etag, ttl: 30, maxBytes: 32 * 1024 });
    }
    const escape = (value) => value.replace(/[\\%_]/g, "\\$&");
    const [row] = await read(searchSql, [
      needle,
      season,
      `%${escape(needle)}%`,
      `${escape(needle)}%`,
      terms.map((t) => `%${escape(t)}%`),
      terms,
      state.season_id,
    ]);
    if (row?.version == null) reject(503, "Catalogue indisponible.");
    const body = {
      players: result(row.players, "players"),
      clubs: result(row.clubs, "clubs"),
      playersHasMore: row.players.length > LIMITS.players,
      clubsHasMore: row.clubs.length > LIMITS.clubs,
      generation: row.version,
      season,
    };
    return send(req, body, 200, { etag: searchTag(row.version, season, needle), ttl: 30, maxBytes: 32 * 1024 });
  };
}

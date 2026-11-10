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
const textSql = (column) => `regexp_replace(normalize(lower(${column}),NFD),'[̀-ͯ]','','g')`;
const playerName = textSql("p.name"),
  teamName = textSql("t.name"),
  playerContext = textSql("concat_ws(' ',p.name,a.team,a.league)"),
  teamInitials = `regexp_replace(${teamName},'([[:alpha:]])[[:alpha:]]*[^[:alpha:]]*','\\1','g')`;
const searchTag = (version, season, needle) =>
  `W/"search-v1-${createHash("sha256").update(JSON.stringify([version, season, needle])).digest("hex")}"`;

// $1 needle, $2 season, $3 %needle%, $4 needle%, $5 %term% patterns, $6 terms.
const searchSql = `/*vega:v2:search*/
WITH alias_hits AS MATERIALIZED (
 SELECT DISTINCT a.player_id,x.pattern FROM api.player_search_aliases a
 CROSS JOIN LATERAL unnest($6::text[],$5::text[]) AS x(term,pattern)
 WHERE x.term=ANY(string_to_array(a.search_aliases,' '))
), player_candidates AS MATERIALIZED (
 SELECT p.player_id,p.public_id AS id,p.name AS label,
 CASE WHEN ${playerName}=$1 OR p.player_id IN (SELECT player_id FROM alias_hits) THEN 0
   WHEN ${playerName} LIKE $4 THEN 1 ELSE 2 END AS rank
 FROM api.player_keys p
 WHERE (${playerName} LIKE ANY($5::text[]) OR p.player_id IN (SELECT player_id FROM alias_hits))
 AND EXISTS (SELECT 1 FROM api.player_appearances a WHERE a.player_id=p.player_id AND a.season=$2
   AND NOT EXISTS (SELECT 1 FROM unnest($5::text[]) AS term(pattern) WHERE ${playerContext} NOT LIKE term.pattern
     AND NOT EXISTS (SELECT 1 FROM alias_hits h WHERE h.player_id=p.player_id AND h.pattern=term.pattern)))
 ORDER BY rank,label,id LIMIT 7
), players AS (
 SELECT c.id,c.rank,p.name,p.image_url,a.team,a.league_id,a.league,a.country
 FROM player_candidates c JOIN api.player_keys p ON p.player_id=c.player_id
 CROSS JOIN LATERAL (SELECT a.team,a.league_id,a.league,a.country FROM api.player_appearances a
   WHERE a.player_id=c.player_id AND a.season=$2 ORDER BY a.date DESC NULLS LAST,a.kickoff_at DESC NULLS LAST,a.match_id DESC LIMIT 1) a
), club_names AS MATERIALIZED (
 SELECT t.team_id,t.public_id AS id,t.name,t.image_url,tc.country,
 CASE WHEN ${teamName}=$1 OR ${teamInitials}=$1 THEN 0 WHEN ${teamName} LIKE $4 OR ${teamInitials}=$1 THEN 1 ELSE 2 END AS rank
 FROM api.team_keys t LEFT JOIN api.team_countries tc ON tc.team_id=t.public_id
 WHERE ${teamName} LIKE $3 OR ${teamInitials} LIKE $4
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
    const conditional = req.headers.get("if-none-match");
    if (req.method === "HEAD" || conditional) {
      const [state] = await read("SELECT generation::text AS version FROM api.publication");
      if (state?.version == null) reject(503, "Catalogue indisponible.");
      const etag = searchTag(state.version, season, needle);
      if (req.method === "HEAD" || matchesEtag(conditional, etag)) return send(req, null, 200, { etag, ttl: 30, maxBytes: 32 * 1024 });
    }
    const escape = (value) => value.replace(/[\\%_]/g, "\\$&");
    const [row] = await read(searchSql, [needle, season, `%${escape(needle)}%`, `${escape(needle)}%`, terms.map((t) => `%${escape(t)}%`), terms]);
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

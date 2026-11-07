import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { reject, send, validateParams } from "./relational-core.js";
import { playerAliasIds } from "../../shared/player-aliases.js";
import { inEuropeFocus } from "../../shared/competition-scope.js";

const limits = { players: 6, clubs: 4 };
const normalized = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const textSql = (column) =>
  `regexp_replace(normalize(lower(${column}),NFD),'[̀-ͯ]','','g')`;
const playerName = textSql("p.name"),
  teamName = textSql("t.name");
const playerContext = textSql("concat_ws(' ',p.name,a.team,a.league)");
const teamInitials = `regexp_replace(${teamName},'([[:alpha:]])[[:alpha:]]*[^[:alpha:]]*','\\1','g')`;

// Search identities first, then read at most seven/five small season contexts.
// No season partitions, match details, COUNT(*) over all performances or source
// documents are loaded. The publication and results share one SQL snapshot.
const searchSql = `/*vega:discovery*/
WITH player_candidates AS MATERIALIZED (
 SELECT p.player_id AS id,min(p.name) AS label,
 min(CASE WHEN ${playerName}=$1 OR p.player_id=ANY($4::text[]) THEN 0
   WHEN ${playerName} LIKE $5 THEN 1 ELSE 2 END) AS rank
 FROM statarena_app.players p
 WHERE (${playerName} LIKE ANY($6::text[]) OR p.player_id=ANY($4::text[]))
 AND EXISTS(SELECT 1 FROM statarena_app.appearances a
   WHERE a.player_id=p.player_id AND a.season=$2
   AND NOT EXISTS(SELECT 1 FROM unnest($6::text[]) AS term(pattern)
     WHERE ${playerContext} NOT LIKE term.pattern
     AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset($7::jsonb) AS alias(player_id text,pattern text)
       WHERE alias.player_id=p.player_id AND alias.pattern=term.pattern)))
 GROUP BY p.player_id ORDER BY rank,label,id LIMIT 7
), players AS (
 SELECT c.id,c.rank,p.name,p.image_url,a.team,a.league_id,a.league,co.country
 FROM player_candidates c
 CROSS JOIN LATERAL (SELECT a.player_ref,a.team,a.league_id,a.league
   FROM statarena_app.appearances a WHERE a.player_id=c.id AND a.season=$2
   ORDER BY a.date DESC NULLS LAST,a.id DESC LIMIT 1) a
 JOIN statarena_app.players p ON p.id=a.player_ref
 LEFT JOIN statarena_app.competitions co ON co.id=a.league_id
), club_candidates AS MATERIALIZED (
 SELECT t.id,t.name,t.image_url,t.country,
 CASE WHEN ${teamName}=$1 OR ${teamInitials}=$1 THEN 0
   WHEN ${teamName} LIKE $5 THEN 1 ELSE 2 END AS rank
 FROM statarena_app.teams t
 WHERE (${teamName} LIKE $3 OR ${teamInitials} LIKE $5)
 AND EXISTS(SELECT 1 FROM statarena_app.team_seasons s WHERE s.team_id=t.id AND s.season=$2)
 ORDER BY rank,t.name,t.id LIMIT 5
), clubs AS (
 SELECT c.*,s.league_id,co.name AS league,co.country AS league_country
 FROM club_candidates c
 CROSS JOIN LATERAL (SELECT s.league_id FROM statarena_app.team_seasons s
   WHERE s.team_id=c.id AND s.season=$2 ORDER BY s.sample_matches DESC,s.league_id LIMIT 1) s
 LEFT JOIN statarena_app.competitions co ON co.id=s.league_id
)
SELECT g.generation::text AS version,g.published_at,
 coalesce((SELECT json_agg(p ORDER BY p.rank,p.name,p.id) FROM players p),'[]'::json) AS players,
 coalesce((SELECT json_agg(t ORDER BY t.rank,t.name,t.id) FROM clubs t),'[]'::json) AS clubs
FROM statarena_app.publications g WHERE g.singleton`;

function result(rows, kind) {
  return rows.slice(0, limits[kind]).map((row) => ({
    kind,
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    meta: (kind === "players" ? row.team : row.league) || "",
    outside: !inEuropeFocus({
      id: row.league_id,
      name: row.league,
      country: row.league_country || row.country,
    }),
    rank: Number(row.rank),
  }));
}

// Dependency injection keeps the contract testable without a production DB.
export function createDiscoveryRoute(read = query) {
  return async function relationalDiscoveryRoute(req, path, params) {
    if (path !== "/api/search") return null;
    if (!["GET", "HEAD"].includes(req.method))
      reject(405, "Méthode non autorisée.");
    validateParams(params, ["q", "season"]);
    const raw = params.get("q") || "",
      season = params.get("season");
    if (
      raw.length > 100 ||
      /[\u0000-\u001f\u007f]/.test(raw) ||
      !/^\d{4}(?:\/\d{4})?$/.test(season || "")
    )
      reject(400, "Recherche invalide.");
    const needle = normalized(raw);
    if (needle.length < 2)
      return send(
        req,
        { players: [], clubs: [], playersHasMore: false, clubsHasMore: false },
        200,
      );
    const terms = [...new Set(needle.split(/[\s\-'’.]+/).filter(Boolean))];
    if (terms.length > 8)
      reject(400, "La recherche accepte huit termes au maximum.");
    const escaped = needle.replace(/[\\%_]/g, "\\$&");
    const patterns = terms.map(
      (term) => `%${term.replace(/[\\%_]/g, "\\$&")}%`,
    );
    const aliases = terms.flatMap((term, index) =>
      playerAliasIds(term).map((player_id) => ({
        player_id,
        pattern: patterns[index],
      })),
    );
    const [row] = await read(searchSql, [
      needle,
      season,
      `%${escaped}%`,
      [...new Set(aliases.map((alias) => alias.player_id))],
      `${escaped}%`,
      patterns,
      JSON.stringify(aliases),
    ]);
    if (!row) reject(503, "Catalogue indisponible.");
    const body = {
      players: result(row.players, "players"),
      clubs: result(row.clubs, "clubs"),
      playersHasMore: row.players.length > limits.players,
      clubsHasMore: row.clubs.length > limits.clubs,
      generation: row.version,
      season,
    };
    const etag = `W/"search-v1-${createHash("sha256")
      .update(JSON.stringify([row.version, season, needle]))
      .digest("hex")}"`;
    return send(req, body, 200, { etag, ttl: 30, maxBytes: 32 * 1024 });
  };
}

export const relationalDiscoveryRoute = createDiscoveryRoute();

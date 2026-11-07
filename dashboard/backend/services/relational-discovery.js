import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { reject, send, validateParams } from "./relational-core.js";
import { playerAliasIds } from "../../shared/player-aliases.js";
import { inEuropeFocus } from "../../shared/competition-scope.js";
import { cache } from "./cache.js";
import { matchesEtag } from "./cache-policy.js";

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
const publicationVersion =
  "SELECT generation::text AS version FROM statarena_app.publications WHERE singleton";
const searchTag = (version, season, needle) =>
  `W/"search-v1-${createHash("sha256")
    .update(JSON.stringify([version, season, needle]))
    .digest("hex")}"`;

// Single-term names can be grouped and ordered before season membership. This
// lets the nested-loop read stop at seven eligible identities, rather than
// probing appearances for every substring match before taking the same seven.
// The preferred branch uses the existing normalized-name and provider indexes.
// Read every matching spelling for each preferred ID: its minimum label may
// come from a substring spelling, and must keep the original tie ordering.
const singleTermPlayers = `preferred_player_ids AS MATERIALIZED (
 SELECT DISTINCT p.player_id FROM statarena_app.players p
 WHERE ${playerName} LIKE $5 OR p.player_id=ANY($4::text[])
), preferred_player_names AS MATERIALIZED (
 SELECT p.player_id AS id,min(p.name) AS label,
 min(CASE WHEN ${playerName}=$1 OR p.player_id=ANY($4::text[]) THEN 0
   WHEN ${playerName} LIKE $5 THEN 1 ELSE 2 END) AS rank
 FROM preferred_player_ids preferred JOIN statarena_app.players p USING(player_id)
 WHERE ${playerName} LIKE ANY($6::text[]) OR p.player_id=ANY($4::text[])
 GROUP BY p.player_id ORDER BY rank,label,id
), preferred_players AS MATERIALIZED (
 SELECT n.* FROM preferred_player_names n
 CROSS JOIN LATERAL (SELECT 1 FROM statarena_app.appearances a
   WHERE a.player_id=n.id AND a.season=$2 LIMIT 1) present
 ORDER BY n.rank,n.label,n.id LIMIT 7
), other_players AS MATERIALIZED (
 SELECT n.* FROM (
   SELECT p.player_id AS id,min(p.name) AS label,2 AS rank
   FROM statarena_app.players p
   WHERE ${playerName} LIKE ANY($6::text[])
   AND NOT EXISTS(SELECT 1 FROM preferred_player_ids preferred WHERE preferred.player_id=p.player_id)
   GROUP BY p.player_id ORDER BY label,id
 ) n
 CROSS JOIN LATERAL (SELECT 1 FROM statarena_app.appearances a
   WHERE a.player_id=n.id AND a.season=$2 LIMIT 1) present
 ORDER BY n.label,n.id LIMIT (SELECT 7-count(*) FROM preferred_players)
), player_candidates AS MATERIALIZED (
 SELECT * FROM preferred_players UNION ALL SELECT * FROM other_players
)`;

// Search identities first, then read at most seven/five small season contexts.
// No season partitions, match details, COUNT(*) over all performances or source
// documents are loaded. The publication and results share one SQL snapshot.
const searchSql = (singleTerm) => `/*vega:discovery*/
WITH ${
  singleTerm
    ? singleTermPlayers
    : `player_candidates AS MATERIALIZED (
 SELECT p.player_id AS id,min(p.name) AS label,
 min(CASE WHEN ${playerName}=$1 OR p.player_id=ANY($4::text[]) THEN 0
   WHEN ${playerName} LIKE $5 THEN 1 ELSE 2 END) AS rank
 FROM statarena_app.players p
 CROSS JOIN LATERAL (SELECT 1 FROM statarena_app.appearances a
   WHERE a.player_id=p.player_id AND a.season=$2
   AND NOT EXISTS(SELECT 1 FROM unnest($6::text[]) AS term(pattern)
     WHERE ${playerContext} NOT LIKE term.pattern
     AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset($7::jsonb) AS alias(player_id text,pattern text)
       WHERE alias.player_id=p.player_id AND alias.pattern=term.pattern))
   LIMIT 1) present
 WHERE (${playerName} LIKE ANY($6::text[]) OR p.player_id=ANY($4::text[]))
 GROUP BY p.player_id ORDER BY rank,label,id LIMIT 7
)`
}, players AS (
 SELECT c.id,c.rank,p.name,p.image_url,a.team,a.league_id,a.league,co.country
 FROM player_candidates c
 CROSS JOIN LATERAL (SELECT a.player_ref,a.team,a.league_id,a.league
   FROM statarena_app.appearances a WHERE a.player_id=c.id AND a.season=$2
   ORDER BY a.date DESC NULLS LAST,a.id DESC LIMIT 1) a
 JOIN statarena_app.players p ON p.id=a.player_ref
 LEFT JOIN statarena_app.competitions co ON co.id=a.league_id
), preferred_club_names AS MATERIALIZED (
 SELECT t.id,t.name,t.image_url,t.country,
 CASE WHEN ${teamName}=$1 OR ${teamInitials}=$1 THEN 0
   ELSE 1 END AS rank
 FROM statarena_app.teams t
 WHERE ${teamName} LIKE $5 OR ${teamInitials}=$1
 ORDER BY rank,t.name,t.id
), preferred_clubs AS MATERIALIZED (
 SELECT t.* FROM preferred_club_names t
 CROSS JOIN LATERAL (SELECT 1 FROM statarena_app.team_seasons s
   WHERE s.team_id=t.id AND s.season=$2 LIMIT 1) present
 ORDER BY rank,t.name,t.id LIMIT 5
), other_clubs AS MATERIALIZED (
 SELECT t.* FROM (
   SELECT t.id,t.name,t.image_url,t.country,2 AS rank
   FROM statarena_app.teams t
   WHERE (${teamName} LIKE $3 OR ${teamInitials} LIKE $5)
   AND NOT EXISTS(SELECT 1 FROM preferred_club_names preferred WHERE preferred.id=t.id)
   ORDER BY t.name,t.id
 ) t
 CROSS JOIN LATERAL (SELECT 1 FROM statarena_app.team_seasons s
   WHERE s.team_id=t.id AND s.season=$2 LIMIT 1) present
 ORDER BY t.name,t.id LIMIT (SELECT 5-count(*) FROM preferred_clubs)
), club_candidates AS MATERIALIZED (
 SELECT * FROM preferred_clubs UNION ALL SELECT * FROM other_clubs
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
  const snapshots = cache(2 * 1024 * 1024, {
    name: "search",
    maxEntryBytes: 32 * 1024,
  });
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
    const key = JSON.stringify([season, needle]),
      retained = snapshots.peek(key),
      conditional = req.headers.get("if-none-match");
    let currentVersion;
    if (req.method === "HEAD" || conditional || retained) {
      const [state] = await read(publicationVersion, []);
      if (state?.version == null) reject(503, "Catalogue indisponible.");
      currentVersion = String(state.version);
      const etag = searchTag(currentVersion, season, needle);
      if (req.method === "HEAD" || matchesEtag(conditional, etag))
        return send(req, null, 200, { etag, ttl: 30, maxBytes: 32 * 1024 });
      if (retained && String(retained.version) !== currentVersion)
        snapshots.delete(key);
    }
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
    const values = [
      needle,
      season,
      `%${escaped}%`,
      [...new Set(aliases.map((alias) => alias.player_id))],
      `${escaped}%`,
      patterns,
      JSON.stringify(aliases),
    ];
    const load = async () => {
      // A single term already matched this identity's name or alias. Only its
      // season membership remains to check, using the actor/season index alone.
      const singleTerm = terms.length === 1;
      const [snapshot] = await read(
        searchSql(singleTerm),
        singleTerm ? values.slice(0, 6) : values,
      );
      if (snapshot?.version == null) reject(503, "Catalogue indisponible.");
      return snapshot;
    };
    let row = conditional
      ? await load()
      : await snapshots(key, load, 5 * 60_000);
    if (
      !conditional &&
      currentVersion !== undefined &&
      String(row.version) !== currentVersion
    ) {
      snapshots.delete(key);
      row = await load();
    }
    const body = {
      players: result(row.players, "players"),
      clubs: result(row.clubs, "clubs"),
      playersHasMore: row.players.length > limits.players,
      clubsHasMore: row.clubs.length > limits.clubs,
      generation: row.version,
      season,
    };
    const etag = searchTag(String(row.version), season, needle);
    return send(req, body, 200, { etag, ttl: 30, maxBytes: 32 * 1024 });
  };
}

export const relationalDiscoveryRoute = createDiscoveryRoute();

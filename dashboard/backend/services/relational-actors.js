import { query } from "./postgres.js";
import {
  appearanceRecord,
  assembleMatches,
  camelRow,
  competition,
  fixture,
  reject,
  validateParams,
} from "./relational-core.js";
import {
  bindValue,
  checkReadGeneration,
  parseReadScope,
  publicationSql,
  readPageArgs,
  readResponse,
  readValidator,
  scopeWhere,
} from "./relational-read-utils.js";

const rows = (statement) =>
  `(SELECT coalesce(json_agg(r),'[]'::json) FROM (${statement}) r)`;

function actorQuery(kind, scope, actor, includes, pagination, generation) {
  const values = [],
    publication = publicationSql(scope, values);
  const fence =
    generation === null
      ? ""
      : ` AND EXISTS(SELECT 1 FROM publication WHERE generation=${bindValue(values, generation)})`;
  const actorParam = bindValue(values, actor);
  const matchScope = scopeWhere("m", scope, values);
  let candidates;
  if (kind === "player") {
    const appearanceScope = scopeWhere("a", scope, values);
    candidates = `SELECT m.id,m.day FROM statarena_app.matches m
      WHERE ${matchScope}${fence} AND EXISTS (
        SELECT 1 FROM statarena_app.appearances a
        WHERE a.match_id=m.id AND a.player_id=${actorParam} AND ${appearanceScope})`;
  } else {
    const fixtureScope = scopeWhere("f", scope, values);
    candidates = `SELECT id,min(day) AS day FROM (
      SELECT m.id,m.day FROM statarena_app.matches m WHERE ${matchScope}${fence}
        AND (m.home_id=${actorParam} OR m.away_id=${actorParam})
      UNION ALL
      SELECT f.id,f.day FROM statarena_app.fixtures f WHERE ${fixtureScope}${fence}
        AND (f.home_team_id=${actorParam} OR f.away_team_id=${actorParam})
    ) candidates GROUP BY id`;
  }
  const limit = bindValue(values, pagination.limit),
    offset = bindValue(values, pagination.offset);
  const withAppearances = kind === "player" || includes.has("appearances");
  const appearances = withAppearances
    ? `, page_appearances AS MATERIALIZED (
        SELECT a.*,p.name,p.image_url,s.value_text AS shirt_number_raw,s.value_type AS shirt_number_type
        FROM page k JOIN statarena_app.appearances a ON a.match_id=k.id
        JOIN statarena_app.players p ON p.id=a.player_ref
        LEFT JOIN statarena_app.appearance_shirt_numbers s ON s.appearance_id=a.id
        WHERE a.${kind === "player" ? "player_id" : "team_id"}=${actorParam}
          AND ${scopeWhere("a", scope, values)}),
      appearance_extras AS (
        SELECT e.appearance_id,json_object_agg(e.metric_key,e.value ORDER BY e.metric_key) extras
        FROM statarena_app.appearance_metrics e JOIN page_appearances a ON a.id=e.appearance_id
        GROUP BY e.appearance_id)`
    : "";
  const byPage = (table, order, columns = "r.*") =>
    rows(
      `SELECT ${columns} FROM page p CROSS JOIN LATERAL (
       SELECT * FROM statarena_app.${table} WHERE match_id=p.id ORDER BY ${order}
     ) r ORDER BY r.match_id,${order
       .split(",")
       .map((key) => `r.${key.trim()}`)
       .join(",")}`,
    );
  const teamScope = scopeWhere("s", scope, values);
  const metricScope = scopeWhere("pm", scope, values);
  const sql = `WITH publication AS MATERIALIZED (${publication}),
    actor_matches AS MATERIALIZED (${candidates}),
    page AS MATERIALIZED (SELECT * FROM actor_matches ORDER BY day DESC NULLS LAST,id DESC LIMIT ${limit} OFFSET ${offset}),
    selected_matches AS MATERIALIZED (SELECT m.* FROM page p JOIN statarena_app.matches m USING(id)),
    selected_fixtures AS MATERIALIZED (SELECT f.* FROM page p JOIN statarena_app.fixtures f USING(id)),
    context_teams AS (SELECT home_id AS id FROM selected_matches UNION SELECT away_id FROM selected_matches
      UNION SELECT home_team_id FROM selected_fixtures UNION SELECT away_team_id FROM selected_fixtures),
    context_leagues AS (SELECT league_id AS id FROM selected_matches UNION SELECT league_id FROM selected_fixtures)
    ${appearances}
    SELECT publication.*,(SELECT count(*)::int FROM actor_matches) AS total,
      ${rows("SELECT * FROM selected_matches ORDER BY day DESC NULLS LAST,id DESC")} matches,
      ${rows("SELECT * FROM selected_fixtures ORDER BY day DESC NULLS LAST,id DESC")} fixtures,
      ${withAppearances ? rows("SELECT a.*,e.extras FROM page_appearances a LEFT JOIN appearance_extras e ON e.appearance_id=a.id ORDER BY a.match_id,a.ordinal,a.id") : "'[]'::json"} appearances,
      ${includes.has("shots") ? byPage("shots", "ordinal,id") : "'[]'::json"} shots,
      ${byPage("team_statistics", "ordinal")} stats,
      ${byPage("match_coverage", "coverage_key")} cover,
      ${byPage("match_warnings", "kind,ordinal")} warnings,
      ${withAppearances ? rows("SELECT match_id,id AS appearance_id,ordinal FROM page_appearances ORDER BY match_id,ordinal,id") : "'[]'::json"} players,
      ${rows(`SELECT t.id,t.name,t.image_url,t.country,
          array_agg(DISTINCT s.league_id ORDER BY s.league_id) FILTER (WHERE s.league_id IS NOT NULL) league_ids,
          coalesce(sum(s.sample_matches),0)::int sample_matches
        FROM statarena_app.teams t LEFT JOIN statarena_app.team_seasons s ON s.team_id=t.id AND ${teamScope}
        WHERE t.id IN (SELECT id FROM context_teams) GROUP BY t.id ORDER BY t.id`)} teams,
      ${rows(`SELECT c.*,(SELECT json_agg(native_season ORDER BY ordinal)
          FROM statarena_app.competition_catalog_seasons k WHERE k.competition_id=c.id) catalog_seasons
        FROM statarena_app.competitions c WHERE c.id IN (SELECT id FROM context_leagues) ORDER BY c.id`)} competitions,
      ${rows(`SELECT DISTINCT md.metric_key AS key,md.label,md.unit,md.decimals
        FROM statarena_app.partition_metrics pm JOIN statarena_app.metric_definitions md USING(metric_key)
        WHERE ${metricScope} ORDER BY key`)} metrics
    FROM publication`;
  return { sql, values, withAppearances };
}

/** Dedicated actor reads never fetch other actors' appearances or raw archives. */
export function createActorRoute(read = query) {
  return async function relationalActorRoute(req, path, params) {
    const kind =
      path === "/api/read/player"
        ? "player"
        : path === "/api/read/club"
          ? "club"
          : null;
    if (!kind) return null;
    if (!["GET", "HEAD"].includes(req.method))
      reject(405, "Méthode non autorisée.");
    const actorKey = kind === "player" ? "player" : "team";
    validateParams(params, [
      "season",
      "leagues",
      "league",
      "generation",
      actorKey,
      "page",
      "limit",
      "include",
    ]);
    const actor = params.get(actorKey);
    if (
      !(kind === "player" ? /^p_[A-Za-z0-9]{6}$/ : /^t_[A-Za-z0-9]{6}$/).test(
        actor || "",
      )
    )
      reject(400, "Identifiant invalide.");
    const includes = new Set(
      (params.get("include") || "").split(",").filter(Boolean),
    );
    if (
      [...includes].some((value) => !["appearances", "shots"].includes(value))
    )
      reject(400, "Détail invalide.");
    const scope = parseReadScope(params),
      pagination = readPageArgs(params, 25);
    const cached = await readValidator(req, params, scope, read);
    if (cached) return cached;
    const request = actorQuery(
      kind,
      scope,
      actor,
      includes,
      pagination,
      params.get("generation"),
    );
    const [snapshot] = await read(request.sql, request.values);
    checkReadGeneration(params, snapshot?.generation);
    const data = {
      meta: {
        storage: "aws-relational",
        currentSeason: scope.season,
        source: "AWS",
        retrievedAt: snapshot.source_retrieved_at,
        startDate: snapshot.start_date,
        endDate: snapshot.end_date,
        shotsLoaded: includes.has("shots"),
        appearancesLoaded: request.withAppearances,
        actor: { kind, id: actor },
        notes: [],
      },
      metrics: snapshot.metrics || [],
      competitions: (snapshot.competitions || []).map(competition),
      teams: (snapshot.teams || []).map((team) => ({
        ...camelRow(team),
        seasons: [scope.season],
      })),
      fixtures: (snapshot.fixtures || []).map(fixture),
      matches: assembleMatches({
        ...snapshot,
        matches: snapshot.matches || [],
      }),
      appearances: (snapshot.appearances || []).map(appearanceRecord),
    };
    const total = Number(snapshot.total || 0);
    return readResponse(req, params, snapshot, data, {
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.max(1, Math.ceil(total / pagination.limit)),
      },
      maxBytes: 2 * 1024 * 1024,
    });
  };
}

export const relationalActorRoute = createActorRoute();

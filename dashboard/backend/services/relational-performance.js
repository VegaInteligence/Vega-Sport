import { query } from "./postgres.js";
import {
  appearanceRecord,
  assembleMatches,
  competition,
  reject,
  validateParams,
} from "./relational-core.js";
import {
  bindValue,
  checkReadGeneration,
  finiteSql,
  parseReadScope,
  publicationSql,
  readResponse,
  readValidator,
  scopeWhere,
} from "./relational-read-utils.js";
import {
  performanceProfileFromCounts,
  PROFILE_METRICS,
  MIN_PEER_MINUTES,
} from "../../shared/player-profile.js";

const ranked = Object.keys(PROFILE_METRICS).filter(
  (key) => !["goals", "assists", "xa"].includes(key),
);
const snake = (key) =>
  key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
const number = (column) => `CASE WHEN ${finiteSql(column)} THEN ${column} END`;
function metric(alias, key) {
  const field = `${alias}.${snake(key)}`;
  if (key === "passAccuracy")
    return `CASE WHEN ${finiteSql(`${alias}.passes_accurate`)} AND ${finiteSql(`${alias}.passes_attempted`)} AND ${alias}.passes_attempted>=10 THEN ${alias}.passes_accurate/${alias}.passes_attempted*100 END`;
  if (key === "duelRate")
    return `CASE WHEN ${finiteSql(`${alias}.duels_won`)} AND ${finiteSql(`${alias}.duels_lost`)} AND ${alias}.duels_won+${alias}.duels_lost>=4 THEN ${alias}.duels_won/(${alias}.duels_won+${alias}.duels_lost)*100 END`;
  if (key === "xg" || key === "shotsOnTarget")
    return `CASE WHEN ${finiteSql(field)} THEN ${field} WHEN ${alias}.shots=0 THEN 0 END`;
  return number(field);
}
function positionGroup(alias) {
  const value = `${alias}.position_id`,
    type = `${alias}.position_id_type`;
  const position = `(CASE WHEN ${value} IS NULL OR ${type}='NoneType' THEN NULL
    WHEN ${type}='bool' THEN CASE WHEN ${value}='True' THEN 1 ELSE 0 END
    WHEN btrim(${value})='' THEN 0
    WHEN btrim(${value})~'^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      AND pg_input_is_valid(btrim(${value}),'double precision') THEN btrim(${value})::double precision END)`;
  return `CASE WHEN ${position} IN (0,11) THEN 'G'
    WHEN ${position}=1 OR (${position}>=30 AND ${position}<40) OR ${position} IN (51,59) THEN 'D'
    WHEN ${position}=2 OR (${position}>=50 AND ${position}<80) THEN 'M'
    WHEN (${position}>=80 AND ${position}<120) OR ${position}=3 THEN 'O'
    WHEN ${finiteSql(`${alias}.saves`)} AND ${alias}.saves>0 THEN 'G' ELSE 'F' END`;
}
const rows = (sql) =>
  `(SELECT coalesce(json_agg(r),'[]'::json) FROM (${sql}) r)`;

/** One selected performance, exact peer counts, and match-wide rating rank. */
export function createPerformanceRoute(read = query) {
  return async function relationalPerformanceRoute(req, path, params) {
    if (path !== "/api/read/performance") return null;
    if (!["GET", "HEAD"].includes(req.method))
      reject(405, "Méthode non autorisée.");
    validateParams(params, [
      "season",
      "leagues",
      "league",
      "generation",
      "appearance",
      "include",
    ]);
    const appearance = params.get("appearance");
    if (
      !appearance ||
      appearance.length > 240 ||
      /[\u0000-\u0020\u007f]/.test(appearance)
    )
      reject(400, "Performance invalide.");
    if (params.has("include") && params.get("include") !== "shots")
      reject(400, "Détail invalide.");
    const scope = parseReadScope(params),
      values = [];
    const cached = await readValidator(
      req,
      params,
      scope,
      async (sql, bindings) => {
        // Existence is part of this resource's HEAD/304 contract. Check it in
        // the same small snapshot as the publication, without computing peers.
        const keys = [...bindings];
        const found = `SELECT 1 FROM statarena_app.appearances a
        WHERE a.id=${bindValue(keys, appearance)} AND ${scopeWhere("a", scope, keys)}`;
        const [state] = await read(
          `WITH state AS (${sql})
        SELECT state.*,EXISTS(${found}) AS appearance_exists FROM state`,
          keys,
        );
        checkReadGeneration(params, state?.generation);
        if (!state.appearance_exists)
          reject(404, "Performance indisponible dans ce périmètre.");
        return [state];
      },
    );
    if (cached) return cached;
    const publication = publicationSql(scope, values);
    const fence = params.has("generation")
      ? ` AND EXISTS(SELECT 1 FROM publication WHERE generation=${bindValue(values, params.get("generation"))})`
      : "";
    const target = `SELECT a.*,p.name,p.image_url,s.value_text AS shirt_number_raw,s.value_type AS shirt_number_type,
        (SELECT json_object_agg(e.metric_key,e.value) FROM statarena_app.appearance_metrics e WHERE e.appearance_id=a.id) extras
      FROM statarena_app.appearances a JOIN statarena_app.players p ON p.id=a.player_ref
      LEFT JOIN statarena_app.appearance_shirt_numbers s ON s.appearance_id=a.id
      WHERE a.id=${bindValue(values, appearance)} AND ${scopeWhere("a", scope, values)}${fence}`;
    const cohortScope = scopeWhere("a", scope, values);
    const projection = (alias) =>
      ranked.map((key) => `${metric(alias, key)} AS ${snake(key)}`).join(",");
    const counts = ranked
      .map((key) => {
        const column = snake(key);
        return `'${key}',json_build_object('known',count(p.${column}),'below',count(*) FILTER(WHERE p.${column}<t.${column}),'equal',count(*) FILTER(WHERE p.${column}=t.${column}))`;
      })
      .join(",");
    const children = (table, order) =>
      rows(
        `SELECT r.* FROM target t CROSS JOIN LATERAL (SELECT * FROM statarena_app.${table} WHERE match_id=t.match_id ORDER BY ${order}) r`,
      );
    const sql = `WITH publication AS MATERIALIZED (${publication}),target AS MATERIALIZED (${target}),
      target_values AS MATERIALIZED (SELECT ${positionGroup("t")} AS profile_group,${projection("t")} FROM target t),
      cohort AS NOT MATERIALIZED (SELECT ${positionGroup("a")} AS profile_group,${projection("a")}
        FROM statarena_app.appearances a WHERE ${cohortScope} AND a.minutes>=${MIN_PEER_MINUTES}),
      peers AS (SELECT c.* FROM cohort c CROSS JOIN target_values t
        WHERE c.profile_group=t.profile_group OR (t.profile_group='F' AND c.profile_group<>'G'))
      SELECT publication.*,(SELECT row_to_json(t) FROM target t) AS appearance,
        (SELECT json_build_object('peers',count(*),'metrics',json_build_object(${counts})) FROM peers p CROSS JOIN target_values t) AS profile_counts,
        (SELECT CASE WHEN t.rating IS NOT NULL AND ${finiteSql("t.rating")}
          THEN json_build_object('rank',1+(SELECT count(*) FROM statarena_app.appearances a WHERE a.match_id=t.match_id AND ${finiteSql("a.rating")} AND a.rating>t.rating),
             'total',(SELECT count(*) FROM statarena_app.appearances a WHERE a.match_id=t.match_id AND ${finiteSql("a.rating")})) END FROM target t) AS rank,
        ${rows("SELECT m.* FROM target t JOIN statarena_app.matches m ON m.id=t.match_id")} matches,
        ${params.get("include") === "shots" ? children("shots", "ordinal,id") : "'[]'::json"} shots,
        ${children("team_statistics", "ordinal")} stats,
        ${children("match_coverage", "coverage_key")} cover,
        ${children("match_warnings", "kind,ordinal")} warnings,
        ${rows("SELECT a.match_id,a.id AS appearance_id,a.ordinal FROM target t JOIN statarena_app.appearances a ON a.match_id=t.match_id ORDER BY a.ordinal,a.id")} players,
        ${rows("SELECT c.*,(SELECT json_agg(native_season ORDER BY ordinal) FROM statarena_app.competition_catalog_seasons k WHERE k.competition_id=c.id) catalog_seasons FROM target t JOIN statarena_app.competitions c ON c.id=t.league_id")} competitions
      FROM publication`;
    const [snapshot] = await read(sql, values);
    checkReadGeneration(params, snapshot?.generation);
    if (!snapshot.appearance)
      reject(404, "Performance indisponible dans ce périmètre.");
    const row = appearanceRecord(snapshot.appearance);
    return readResponse(
      req,
      params,
      snapshot,
      {
        row,
        match: assembleMatches(snapshot)[0] || null,
        competition: snapshot.competitions?.length
          ? competition(snapshot.competitions[0])
          : null,
        profile: performanceProfileFromCounts(row, snapshot.profile_counts),
        rank: snapshot.rank || null,
      },
      { maxBytes: 256 * 1024 },
    );
  };
}

export const relationalPerformanceRoute = createPerformanceRoute();

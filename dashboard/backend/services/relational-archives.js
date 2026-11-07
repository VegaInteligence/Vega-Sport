import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { cache } from "./cache.js";
import { matchesEtag } from "./cache-policy.js";
import { reject, send, validateParams } from "./relational-core.js";
import { readPageArgs } from "./relational-read-utils.js";
import { archiveRows, buildArchiveSeason } from "../../shared/archive.js";

const editionSql = `SELECT resource_id,scope,source_digest,updated_at,response_status
  FROM statarena_app.catalog_editions
  WHERE catalog='archive-season' AND edition=$1 AND scope IN ('results','goals')`;
const expectedSql = `SELECT 'results' AS scope FROM statarena_app.catalog_editions idx
  JOIN statarena_app.cat_archive_results_index_seasons s ON s.resource_id=idx.resource_id
  WHERE idx.catalog='archive-index' AND idx.scope='results' AND idx.edition='' AND s.id=$1
  UNION SELECT 'goals' AS scope FROM statarena_app.catalog_editions idx
  JOIN statarena_app.cat_archive_goals_index_seasons s ON s.resource_id=idx.resource_id
  WHERE idx.catalog='archive-index' AND idx.scope='goals' AND idx.edition='' AND s.id=$1`;
export const archiveMetadataQuery = `/*vega:archive-metadata*/
  SELECT (SELECT coalesce(json_agg(e ORDER BY e.scope),'[]'::json) FROM (${editionSql}) e) AS editions,
  (SELECT coalesce(json_agg(scope ORDER BY scope),'[]'::json) FROM (${expectedSql}) e) AS expected_scopes`;

// A cold edition reads only fields used by the exact results/goals matcher.
// Each child family is scanned once by resource_id, without reconstructing
// source documents or calling a recursive catalogue reader for every match.
// These typed contracts remain valid before and after provider-store cutover.
export const archiveEditionQuery = `/*vega:archive-edition*/
WITH editions AS MATERIALIZED (${editionSql}),
expected_editions AS MATERIALIZED (${expectedSql}),
result_headers AS MATERIALIZED (
  SELECT c.record_no,c.position,c.id,c.name,c.country,c.missing,c.null_groups
  FROM editions e
  JOIN statarena_app.cat_archive_results r ON r.resource_id=e.resource_id
  JOIN statarena_app.cat_archive_results_competitions c ON c.resource_id=r.resource_id AND c.parent_no=r.record_no
  WHERE e.scope='results' AND NOT 'competitions'=ANY(r.missing) AND NOT 'competitions'=ANY(r.null_groups)
), goal_headers AS MATERIALIZED (
  SELECT c.record_no,c.position,c.id,c.name,c.country,c."calendarYear",c.missing,c.null_groups
  FROM editions e
  JOIN statarena_app.cat_archive_goals r ON r.resource_id=e.resource_id
  JOIN statarena_app.cat_archive_goals_competitions c ON c.resource_id=r.resource_id AND c.parent_no=r.record_no
  WHERE e.scope='goals' AND NOT 'competitions'=ANY(r.missing) AND NOT 'competitions'=ANY(r.null_groups)
)
SELECT
  (SELECT coalesce(json_agg(e ORDER BY e.scope),'[]'::json) FROM editions e) AS editions,
  (SELECT coalesce(json_agg(scope ORDER BY scope),'[]'::json) FROM expected_editions) AS expected_scopes,
  (SELECT coalesce(json_agg(c ORDER BY c.position),'[]'::json) FROM result_headers c) AS result_headers,
  (SELECT coalesce(json_agg(m ORDER BY m.parent_no,m.position),'[]'::json) FROM (
    SELECT m.parent_no,m.position,m.date,m."dateNote",m.round,m.team1,m.team2,
      m.score_et,m.score_final,m.score_ft,m.score_p,m.status,
      m."sourceFields_neutral",m."sourceFields_nonmatch",m.missing,m.null_groups
    FROM editions e
    JOIN statarena_app.cat_archive_results_competitions_matches m ON m.resource_id=e.resource_id
    JOIN result_headers c ON c.record_no=m.parent_no
    WHERE e.scope='results' AND NOT 'matches'=ANY(c.missing) AND NOT 'matches'=ANY(c.null_groups)
  ) m) AS result_matches,
  (SELECT coalesce(json_agg(c ORDER BY c.position),'[]'::json) FROM goal_headers c) AS goal_headers,
  (SELECT coalesce(json_agg(g ORDER BY g.parent_no,g.position),'[]'::json) FROM (
    SELECT g.parent_no,g.position,g.date,g.match,g.minute,g.player,g.score,
      g."scoreDisagreement",g."sourceSeason",g.team,g.missing
    FROM editions e
    JOIN statarena_app.cat_archive_goals_competitions_events g ON g.resource_id=e.resource_id
    JOIN goal_headers c ON c.record_no=g.parent_no
    WHERE e.scope='goals' AND NOT 'events'=ANY(c.missing) AND NOT 'events'=ANY(c.null_groups)
  ) g) AS goal_events`;

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function snapshot(row) {
  const editions = row?.editions || [];
  if (
    (row?.expected_scopes || []).some(
      (scope) => !editions.some((edition) => edition.scope === scope),
    )
  )
    reject(503, "Cette archive n'est pas encore entièrement publiée.");
  if (!editions.length) reject(404, "Archive introuvable.");
  if (
    editions.some((e) => e.response_status != null && e.response_status !== 200)
  )
    reject(503, "Cette archive n'est pas encore disponible.");
  const sources = Object.fromEntries(
    editions.map((e) => [
      e.scope,
      {
        digest: e.source_digest,
        publishedAt: e.updated_at,
      },
    ]),
  );
  return {
    version: hash(sources),
    sourceDigests: Object.fromEntries(
      editions.map((e) => [e.scope, e.source_digest]),
    ),
    sources,
  };
}

function checkVersion(params, meta) {
  if (params.has("version") && params.get("version") !== meta.version)
    reject(
      409,
      "Les archives ont été actualisées. Rechargez la première page.",
    );
}

function fields(row, keys) {
  const missing = new Set(row.missing || []);
  return Object.fromEntries(
    keys.filter((key) => !missing.has(key)).map((key) => [key, row[key]]),
  );
}

function resultMatch(row) {
  const match = fields(row, [
    "date",
    "dateNote",
    "round",
    "team1",
    "team2",
    "status",
  ]);
  const missing = new Set(row.missing || []),
    nulls = new Set(row.null_groups || []);
  if (!missing.has("score")) {
    match.score = nulls.has("score")
      ? null
      : Object.fromEntries(
          ["et", "final", "ft", "p"]
            .filter((key) => !missing.has(`score.${key}`))
            .map((key) => [key, row[`score_${key}`]]),
        );
  }
  if (!missing.has("sourceFields")) {
    match.sourceFields = nulls.has("sourceFields")
      ? null
      : Object.fromEntries(
          ["neutral", "nonmatch"]
            .filter((key) => !missing.has(`sourceFields.${key}`))
            .map((key) => [key, row[`sourceFields_${key}`]]),
        );
  }
  return match;
}

/** Exactly the browser's historical matcher, with unused provenance removed. */
export function archiveEditionRecord(row, season) {
  const results = new Map(
    (row.result_headers || []).map((header) => [
      header.record_no,
      {
        ...fields(header, ["id", "name", "country"]),
        matches: [],
      },
    ]),
  );
  for (const match of row.result_matches || [])
    results.get(match.parent_no)?.matches.push(resultMatch(match));
  const goals = new Map(
    (row.goal_headers || []).map((header) => [
      header.record_no,
      {
        ...fields(header, ["id", "name", "country", "calendarYear"]),
        events: [],
      },
    ]),
  );
  for (const event of row.goal_events || [])
    goals
      .get(event.parent_no)
      ?.events.push(
        fields(event, [
          "date",
          "match",
          "minute",
          "player",
          "score",
          "scoreDisagreement",
          "sourceSeason",
          "team",
        ]),
      );
  const edition = buildArchiveSeason(
    { season, competitions: [...results.values()] },
    { season, competitions: [...goals.values()] },
  );
  for (const match of edition.matches) delete match.raw;
  const counts = new Map(
    edition.competitions.map((c) => [
      c.id,
      { matches: 0, withGoals: 0, goals: 0 },
    ]),
  );
  let resultsCount = 0,
    withGoals = 0,
    goalCount = 0;
  for (const match of edition.matches) {
    const count = counts.get(match.competitionId),
      goals = match.goals?.length || 0;
    count.matches++;
    count.withGoals += Number(goals > 0);
    count.goals += goals;
    resultsCount += Number(
      match.score.every((score) => Number.isInteger(score) && score >= 0),
    );
    withGoals += Number(goals > 0);
    goalCount += goals;
  }
  edition.competitions = edition.competitions.map((c) => ({
    ...c,
    ...counts.get(c.id),
  }));
  edition.summary = {
    matches: edition.matches.length,
    results: resultsCount,
    withGoals,
    goals: goalCount,
    competitions: edition.competitions.length,
  };
  return edition;
}

export function createArchiveReadRoute(read = query) {
  const editions = cache(32 * 1024 * 1024, {
    name: "archive_edition",
    maxEntryBytes: 20 * 1024 * 1024,
  });
  return async function archiveReadRoute(req, path, params) {
    if (path !== "/api/read/archive") return null;
    if (!["GET", "HEAD"].includes(req.method))
      reject(405, "Méthode non autorisée.");
    validateParams(params, [
      "season",
      "competition",
      "q",
      "page",
      "limit",
      "match",
      "version",
    ]);
    const season = params.get("season"),
      competition = params.get("competition") || "all";
    const q = (params.get("q") || "").trim(),
      matchKey = params.get("match");
    if (!/^\d{4}(?:\/\d{4})?$/.test(season || ""))
      reject(400, "Saison invalide.");
    if (competition.length > 160 || /[\u0000-\u001f]/.test(competition))
      reject(400, "Compétition invalide.");
    if (q.length > 100 || /[\u0000-\u001f]/.test(q))
      reject(400, "Recherche invalide.");
    if (
      matchKey !== null &&
      (!matchKey || matchKey.length > 256 || /[\u0000-\u001f]/.test(matchKey))
    )
      reject(400, "Match invalide.");
    if (params.has("version") && !/^[a-f0-9]{64}$/.test(params.get("version")))
      reject(400, "Publication invalide.");
    const paging = readPageArgs(params, 50);
    for (let attempt = 0; attempt < 2; attempt++) {
      const [header] = await read(archiveMetadataQuery, [season]);
      const meta = snapshot(header);
      checkVersion(params, meta);
      const etag = `W/"archive-v1-${hash([meta.version, [...params].sort(([a], [b]) => a.localeCompare(b))])}"`;
      // Detail HEAD/304 must still establish that the requested key exists.
      if (
        !matchKey &&
        (req.method === "HEAD" ||
          matchesEtag(req.headers.get("if-none-match"), etag))
      )
        return send(req, null, 200, { etag, ttl: 30 });
      try {
        const edition = await editions(
          `${season}:${meta.version}`,
          async () => {
            const [row] = await read(archiveEditionQuery, [season]);
            if (snapshot(row).version !== meta.version) {
              const error = new Error(
                "Archive publication changed while reading",
              );
              error.code = "ESTALE";
              throw error;
            }
            return archiveEditionRecord(row, season);
          },
          15 * 60 * 1000,
        );
        const data = {
          season,
          competitions: edition.competitions,
          summary: edition.summary,
        };
        let pagination;
        if (matchKey) {
          const match = edition.matches.find((item) => item.key === matchKey);
          if (!match?.goals?.length)
            reject(404, "Aucun but archivé pour ce match.");
          data.match = match;
          data.matches = [];
        } else {
          const matches = archiveRows(edition, competition, q),
            total = matches.length;
          const pages = Math.max(1, Math.ceil(total / paging.limit)),
            page = Math.min(paging.page, pages);
          data.matches = matches
            .slice((page - 1) * paging.limit, page * paging.limit)
            .map(({ goals, ...match }) => ({
              ...match,
              hasGoals: Boolean(goals?.length),
              goalCount: goals?.length || 0,
            }));
          pagination = {
            page,
            limit: paging.limit,
            total,
            pages,
            hasMore: page < pages,
            version: meta.version,
          };
        }
        return send(
          req,
          { data, meta, ...(pagination && { pagination }) },
          200,
          { etag, ttl: 30, maxBytes: 512 * 1024 },
        );
      } catch (error) {
        if (error.code !== "ESTALE") throw error;
        if (attempt)
          reject(503, "Les archives sont en cours d'actualisation. Réessayez.");
      }
    }
  };
}

export const relationalArchiveReadRoute = createArchiveReadRoute();

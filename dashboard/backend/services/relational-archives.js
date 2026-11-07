import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { cache } from "./cache.js";
import { matchesEtag } from "./cache-policy.js";
import { reject, send, validateParams } from "./relational-core.js";
import { readPageArgs } from "./relational-read-utils.js";
import { normalizeText } from "../../shared/archive-text.js";
import {
  ARCHIVE_PROJECTION_REVISION,
  archivePublication,
} from "../../shared/archive-projection.js";
import model from "./archive-projection-model.json" with { type: "json" };

export const archiveMetadataQuery = model.metadata;
// Explicit publisher/backfill input only. Public reads never call this query.
export const archiveEditionQuery = model.source;
export const archivePageQuery = model.page;
export const archiveDetailQuery = model.detail;
export { archiveEditionRecord } from "../../shared/archive-projection.js";

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function snapshot(header) {
  const publication = archivePublication(header?.source_fence);
  if (!publication.ready) {
    if (publication.reason === "missing_edition")
      reject(404, "Archive introuvable.");
    reject(503, "Cette archive n'est pas encore entièrement publiée.");
  }
  const { ready, reason, ...meta } = publication;
  return meta;
}

function checkVersion(params, meta) {
  if (params.has("version") && params.get("version") !== meta.version)
    reject(
      409,
      "Les archives ont été actualisées. Rechargez la première page.",
    );
}

export function createArchiveReadRoute(read = query) {
  const pages = cache(8 * 1024 * 1024, {
    name: "archive_pages",
    maxEntryBytes: 512 * 1024,
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
      const projection = header.projection;
      if (
        !projection ||
        projection.revision !== ARCHIVE_PROJECTION_REVISION ||
        projection.version !== meta.version ||
        archivePublication(projection.source_fence).version !== meta.version
      )
        reject(
          503,
          "La lecture de cette archive est en cours d'actualisation.",
        );
      const etag = `W/"archive-v2-${hash([meta.version, [...params].sort(([a], [b]) => a.localeCompare(b))])}"`;
      // Detail HEAD/304 still verifies the first matching positional key.
      if (
        !matchKey &&
        (req.method === "HEAD" ||
          matchesEtag(req.headers.get("if-none-match"), etag))
      )
        return send(req, null, 200, { etag, ttl: 30 });
      const key = JSON.stringify([
        season,
        meta.version,
        competition,
        normalizeText(q).trim(),
        paging.page,
        paging.limit,
        matchKey,
      ]);
      try {
        const page = await pages(
          key,
          async () => {
            const [row] = await read(
              matchKey ? archiveDetailQuery : archivePageQuery,
              matchKey
                ? [season, meta.version, matchKey, ARCHIVE_PROJECTION_REVISION]
                : [
                    season,
                    meta.version,
                    competition,
                    normalizeText(q).trim(),
                    paging.page,
                    paging.limit,
                    ARCHIVE_PROJECTION_REVISION,
                  ],
            );
            if (!row?.ready) {
              const error = new Error(
                "Archive publication changed while reading",
              );
              error.code = "ESTALE";
              throw error;
            }
            return row;
          },
          15 * 60 * 1000,
        );
        const data = {
          season,
          competitions: projection.competitions,
          summary: projection.summary,
        };
        let pagination;
        if (matchKey) {
          if (!page.match?.goals?.length)
            reject(404, "Aucun but archivé pour ce match.");
          const { hasGoals, goalCount, ...match } = page.match.listing;
          data.match = { ...match, goals: page.match.goals };
          data.matches = [];
        } else {
          data.matches = page.matches;
          pagination = { ...page.pagination, version: meta.version };
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

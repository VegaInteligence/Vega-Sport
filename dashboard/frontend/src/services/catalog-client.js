import { json } from "./resources.js";
import { apiUrl } from "../data-url.js";

export const archiveQuery = (params) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(
        ([, value]) => value !== undefined && value !== null && value !== "",
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  ).toString();
const load = (path, params, options) =>
  json(path + "?" + new URLSearchParams(params), options);
export const archiveIndex = (kind, options) =>
  load("/api/archives/index", { kind }, options);
export const archiveSeason = (kind, season, options) =>
  load("/api/archives/season", { kind, season }, options);
export const supportsBoundedArchive = (manifest) =>
  manifest?.capabilities?.boundedArchive === true;

/** One page, its exact totals/facets, or the goals of one selected match. */
export async function archivePage(params, { signal, fetcher = fetch } = {}) {
  const read = async (values) => {
    signal?.throwIfAborted();
    const response = await fetcher(
      apiUrl(`/api/read/archive?${archiveQuery(values)}`),
      { signal },
    );
    if (!response.ok) {
      const error = new Error(
        `Données indisponibles (HTTP ${response.status})`,
      );
      error.status = response.status;
      throw error;
    }
    return response.json();
  };
  try {
    return await read(params);
  } catch (error) {
    // A publication may change between navigation clicks. Replace the entire
    // requested page atomically; no rows or totals from different versions
    // are combined, and an origin failure never downloads both full editions.
    // Match keys contain positions within an edition. Reusing such a key in a
    // newer edition could select a different fixture and must remain an error.
    if (error.status !== 409 || !params.version || params.match) throw error;
    return read({ ...params, version: undefined });
  }
}
export const cupIndex = (kind) => load("/api/cup-index", { kind });
export const cupTable = (competition, season, kind) =>
  load("/api/cup-table", { competition, season, kind });
export const associationRanking = (year) =>
  load("/api/rankings/associations", { year });
export async function clubRanking(club) {
  const result = await load("/api/rankings/club", { club });
  return result.rows ?? null;
}

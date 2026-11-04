import { json } from "./resources.js";
const load = (path, params) => json(path + "?" + new URLSearchParams(params));
export const archiveIndex = (kind) => load("/api/archives/index", { kind });
export const archiveSeason = (kind, season) =>
  load("/api/archives/season", { kind, season });
export const cupIndex = (kind) => load("/api/cup-index", { kind });
export const cupTable = (competition, season, kind) =>
  load("/api/cup-table", { competition, season, kind });
export const associationRanking = (year) =>
  load("/api/rankings/associations", { year });
export async function clubRanking(club) {
  const result = await load("/api/rankings/club", { club });
  return result.rows ?? null;
}

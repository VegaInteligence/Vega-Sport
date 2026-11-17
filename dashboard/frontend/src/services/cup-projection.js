/**
 * A domestic cup's projection (124): read from the edition of the source that holds its rounds, by
 * that edition's Vega id (the cups' index), through /api/forecasts/season.
 */
import { useResource, json } from "./resources.js";
import { cupId } from "./api-routes.js";
import { useSeasonProjection } from "./forecasts.js";
import { GERMAN_CUP_FOLDER } from "./cup-archives.js";

/** The source edition a cup's projection is read from: the German cup's is OpenLigaDB's, which gives its rounds. */
export function cupProjectionSource(competition) {
  if (competition?.source !== "open-matchday" || !competition.folder) return null;
  return competition.folder === GERMAN_CUP_FOLDER ? { kind: "openligadb", key: "germany-cup" } : { kind: "open-matchday", key: competition.folder };
}

/** The cup's projection for `season`, or null (no projection: its round is not drawn, or a club is not rated). */
export function useCupProjection(competition, season) {
  const source = cupProjectionSource(competition);
  const id = useResource(
    `cup-projection-id:${source ? source.kind + ":" + source.key : "none"}`,
    () => cupId(source.kind, source.key, json).catch(() => null),
    Boolean(source),
  ).value;
  return useSeasonProjection(id || null, season);
}

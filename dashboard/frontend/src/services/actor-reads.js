import { compactGeneration, compactQuery } from "./compact-reads.js";
import { aggregateSeason } from "./season-player.js";

export function actorReadParams(
  manifest,
  kind,
  { id, season, leagues = "all", include = "" },
) {
  const summary = manifest?.capabilities?.actorSummary === true && !include;
  return {
    season,
    [kind === "player" ? "player" : "team"]: id,
    leagues,
    include,
    ...(summary ? { detail: "summary", limit: 100 } : {}),
    generation: compactGeneration(manifest),
  };
}

export const actorReadKey = (kind, params) =>
  `compact-actor:${kind}:${compactQuery(params)}`;

/** Reuse only a complete, same-generation season covering every competition. */
export function currentPlayerSeason(context, id, season) {
  const data = context?.data;
  if (
    context?.season !== season ||
    data?.meta?.actor?.kind !== "player" ||
    data.meta.actor.id !== id ||
    data.meta.actorScope !== "all" ||
    data.meta.complete !== true ||
    data.meta.generation !== compactGeneration(context.manifest)
  )
    return undefined;
  return { season, data, profile: aggregateSeason(data.appearances, id) };
}

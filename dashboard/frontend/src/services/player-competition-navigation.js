export function playerCompetitionHref(params, playerId, competitionId) {
  const query = new URLSearchParams(params.toString());
  for (const key of [
    "matchGroup",
    "matchCompetition",
    "careerGroup",
    "careerKey",
  ])
    query.delete(key);
  query.set("id", playerId);
  query.set("playerView", "stats");
  query.set("performanceCompetition", competitionId);
  query.set("performanceSeason", "all");
  return `/joueurs/?${query}`;
}

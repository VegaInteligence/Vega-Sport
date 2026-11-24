import { INTERNATIONAL_SEASONS, parseGoalscorers, parseInternationalResults, parseNationsResults, parseTournamentResults, TOURNAMENT_EDITIONS } from "../../../dashboard/frontend/src/services/nations-results.js";
// competition: the Nations League's leagues B to D (the default), a tournament of TOURNAMENT_EDITIONS, or every other
// international of a season (internationals, 2021/2022 to 2026/2027: the home's week strip, the nation page).
const INTERNATIONALS = new Set(INTERNATIONAL_SEASONS);
const SOURCE = { name: "International Results", url: "https://github.com/martj42/international_results", license: "CC0-1.0" };
const RAW = "https://raw.githubusercontent.com/martj42/international_results/master/";

/** competition=goalscorers (no season): the scorers of goalscorers.csv from the base's first held day (§57). */
async function goalscorers() {
  try {
    const response = await fetch(RAW + "goalscorers.csv", { signal: AbortSignal.timeout(20000), cache: "no-store" });
    if (!response.ok) throw new Error("Source unavailable");
    const goals = parseGoalscorers(await response.text());
    if (!goals.length) throw new Error("Source unavailable");
    return Response.json({ goals, source: SOURCE });
  } catch {
    return Response.json({ error: "Les buteurs sont temporairement indisponibles." }, { status: 502 });
  }
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const season = params.get("season"), competition = params.get("competition") || "nations-league";
  if (competition === "goalscorers") return season ? Response.json({ error: "Édition indisponible." }, { status: 400 }) : goalscorers();
  const tournament = TOURNAMENT_EDITIONS[competition];
  const internationals = competition === "internationals";
  if (competition === "nations-league" ? season !== "2026/2027" : internationals ? !INTERNATIONALS.has(season) : !tournament?.seasons[season])
    return Response.json({ error: "Édition indisponible." }, { status: 400 });
  try {
    const response = await fetch(
      RAW + "results.csv",
      { signal: AbortSignal.timeout(20000), cache: "no-store" },
    );
    if (!response.ok) throw new Error("Source unavailable");
    const text = await response.text();
    const matches = internationals ? parseInternationalResults(text, season)
      : tournament ? parseTournamentResults(text, competition, season) : parseNationsResults(text);
    if (!matches.length) throw new Error("Source unavailable");
    return Response.json(
      {
        ...(tournament ? { name: `${tournament.name} ${season}` } : internationals ? { name: `Matchs internationaux ${season}` } : {}),
        season,
        matches,
        source: SOURCE,
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch {
    return Response.json(
      {
        error:
          "Les résultats de cette édition sont temporairement indisponibles.",
      },
      { status: 502 },
    );
  }
}

import { parseNationsResults, parseTournamentResults, TOURNAMENT_EDITIONS } from "../../../dashboard/frontend/src/services/nations-results.js";
// competition: the Nations League's leagues B to D (the default), or a tournament of TOURNAMENT_EDITIONS.
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const season = params.get("season"), competition = params.get("competition") || "nations-league";
  const tournament = TOURNAMENT_EDITIONS[competition];
  if (competition === "nations-league" ? season !== "2026/2027" : !tournament?.seasons[season])
    return Response.json({ error: "Édition indisponible." }, { status: 400 });
  try {
    const response = await fetch(
      "https://raw.githubusercontent.com/martj42/international_results/master/results.csv",
      { signal: AbortSignal.timeout(20000), cache: "no-store" },
    );
    if (!response.ok) throw new Error("Source unavailable");
    const text = await response.text();
    const matches = tournament ? parseTournamentResults(text, competition, season) : parseNationsResults(text);
    if (!matches.length) throw new Error("Source unavailable");
    return Response.json(
      {
        ...(tournament ? { name: `${tournament.name} ${season}` } : {}),
        season,
        matches,
        source: {
          name: "International Results",
          url: "https://github.com/martj42/international_results",
          license: "CC0-1.0",
        },
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

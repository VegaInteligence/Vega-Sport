import { parseNationsResults } from "../../../src/services/nations-results.js";
export async function GET(request) {
  const season = new URL(request.url).searchParams.get("season");
  if (season !== "2026/2027") return Response.json({ error: "Édition indisponible." }, { status: 400 });
  try {
    const response = await fetch("https://raw.githubusercontent.com/martj42/international_results/master/results.csv", { signal: AbortSignal.timeout(20000), cache: "no-store" });
    if (!response.ok) throw new Error("Source unavailable");
    const matches = parseNationsResults(await response.text());
    if (!matches.length) throw new Error("Source unavailable");
    return Response.json({ season, matches, source: { name: "International Results", url: "https://github.com/martj42/international_results", license: "CC0-1.0" } }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch {
    return Response.json({ error: "Les résultats de cette édition sont temporairement indisponibles." }, { status: 502 });
  }
}

import { parseFranceCup } from "../../../src/services/openfootball-france-cup.js";
import { parseOpenCupText } from "../../../src/services/openfootball-cups.js";
import { NATIONAL_CUP_ARCHIVES } from "../../../src/services/cup-archives.js";

const WORLD_CUP_YEARS = new Set(["1930", "1934", "1938", "1950", "1954", "1958", "1962", "1966", "1970", "1974", "1978", "1982", "1986", "1990", "1994", "1998", "2002", "2006", "2010", "2014", "2018", "2022", "2026"]);
const SOURCES = {
  euro: { repo: "euro.json", seasons: new Set(["2020", "2024", "2028"]), file: "euro.json" },
  "france-cup": { repo: "europe", seasons: new Set(["2024/2025"]), path: "france/2024-25_frcup.txt", format: "text" },
  "club-world-cup": { repo: "worldcup.json", seasons: new Set(["2025"]), file: "clubworldcup.json" },
  "world-cup-history": { repo: "worldcup.json", seasons: WORLD_CUP_YEARS, file: "worldcup.json" },
  ...Object.fromEntries(Object.values(NATIONAL_CUP_ARCHIVES).map((item) => [item.key, { ...item, seasons: new Set([item.season]), format: "cup-text" }])),
};

export async function GET(request) {
  const url = new URL(request.url);
  const competition = url.searchParams.get("competition");
  const season = url.searchParams.get("season");
  const source = Object.hasOwn(SOURCES, competition || "") ? SOURCES[competition] : null;
  if (!source || !source.seasons.has(season))
    return Response.json({ error: "Compétition ou édition indisponible." }, { status: 400 });
  const path = source.path || season + "/" + source.file;
  const upstream = "https://raw.githubusercontent.com/openfootball/" + source.repo + "/master/" + path;
  try {
    const response = await fetch(upstream, { signal: AbortSignal.timeout(15000), next: { revalidate: 3600 } });
    if (!response.ok) throw new Error("Source unavailable");
    const data = source.format === "text" ? { name: "Coupe de France 2024/2025", matches: parseFranceCup(await response.text()) } : source.format === "cup-text" ? { name: competition, matches: parseOpenCupText(await response.text(), 2024, source.rounds) } : await response.json();
    if (!Array.isArray(data.matches) || data.matches.length > 1000) throw new Error("Invalid source data");
    const matches = data.matches.map((match) => ({
      round: match.round, group: match.group, num: match.num, date: match.date,
      team1: match.team1, team2: match.team2, score: match.score,
    }));
    return Response.json({ name: data.name, season, matches, source: { name: "OpenFootball", url: "https://github.com/openfootball/" + source.repo, license: "CC0-1.0" } }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch {
    return Response.json({ error: "Les données de cette édition sont temporairement indisponibles." }, { status: 502 });
  }
}

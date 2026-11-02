import { normalizeOpenLigaMatches } from "../../../src/services/openligadb.js";

const SOURCES = {
  "nations-league": { "2026/2027": ["nla", "2026"] },
  "germany-cup": { "2026/2027": ["dfb", "2026"], "2025/2026": ["dfb", "2025"] },
};
export async function GET(request) {
  const params = new URL(request.url).searchParams, competition = params.get("competition"), season = params.get("season");
  const editions = Object.hasOwn(SOURCES, competition || "") ? SOURCES[competition] : null;
  let source = editions && Object.hasOwn(editions, season || "") ? editions[season] : null;
  if (!source && competition === "germany-cup") {
    const match = /^(\d{4})\/(\d{4})$/.exec(season || "");
    const year = new Date().getUTCFullYear();
    if (match && Number(match[1]) >= 2025 && Number(match[1]) <= year + 1 && Number(match[2]) === Number(match[1]) + 1) source = ["dfb", match[1]];
  }
  if (!source) return Response.json({ error: "Compétition ou édition indisponible." }, { status: 400 });
  try {
    const response = await fetch("https://api.openligadb.de/getmatchdata/" + source.join("/"), {
      headers: { "User-Agent": "STATARENA (+https://github.com/OrionQuantPlatform/STATARENA/issues)" },
      signal: AbortSignal.timeout(15000), next: { revalidate: 900 },
    });
    if (!response.ok) throw new Error("Source unavailable");
    const rows = await response.json(), matches = normalizeOpenLigaMatches(rows, competition);
    if (!matches.length || matches.length !== rows.length) throw new Error("Incomplete source data");
    return Response.json({ competition, season, matches, source: { name: "OpenLigaDB", url: "https://www.openligadb.de/", dataUrl: "https://api.openligadb.de/getmatchdata/" + source.join("/"), license: "ODbL-1.0" } }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=900, stale-while-revalidate=3600" } });
  } catch {
    return Response.json({ error: "Les données de cette édition sont temporairement indisponibles." }, { status: 502 });
  }
}

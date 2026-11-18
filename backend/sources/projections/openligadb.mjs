import { createHash } from "node:crypto";
import { normalizeOpenLigaMatches } from "../../../dashboard/frontend/src/services/openligadb.js";

const SOURCES = {
  "nations-league": { "2026/2027": ["nla", "2026"] },
  "germany-cup": { "2026/2027": ["dfb", "2026"], "2025/2026": ["dfb", "2025"] },
};
export async function GET(request) {
  const params = new URL(request.url).searchParams,
    competition = params.get("competition"),
    season = params.get("season");
  const editions = Object.hasOwn(SOURCES, competition || "")
    ? SOURCES[competition]
    : null;
  let source =
    editions && Object.hasOwn(editions, season || "") ? editions[season] : null;
  if (!source && competition === "germany-cup") {
    const match = /^(\d{4})\/(\d{4})$/.exec(season || "");
    const year = new Date().getUTCFullYear();
    if (
      match &&
      Number(match[1]) >= 2025 &&
      Number(match[1]) <= year + 1 &&
      Number(match[2]) === Number(match[1]) + 1
    )
      source = ["dfb", match[1]];
  }
  if (!source)
    return Response.json(
      { error: "Compétition ou édition indisponible." },
      { status: 400 },
    );
  const typedDfb = competition === "germany-cup" && ["2025/2026", "2026/2027"].includes(season);
  let phaseObservation;
  try {
    const response = await fetch(
      "https://api.openligadb.de/getmatchdata/" + source.join("/"),
      {
        headers: {
          "User-Agent":
            "STATARENA (+https://github.com/OrionQuantPlatform/STATARENA/issues)",
        },
        signal: AbortSignal.timeout(15000),
        next: { revalidate: 900 },
      },
    );
    if (!response.ok) throw new Error("Source unavailable");
    let rows;
    if (typedDfb) {
      const raw = Buffer.from(await response.arrayBuffer());
      phaseObservation = { sourceSha256: createHash("sha256").update(raw).digest("hex") };
      rows = JSON.parse(raw.toString("utf8"));
      if (!Array.isArray(rows) || rows.length > 300) throw new Error("Invalid phase observation");
      phaseObservation.matches = rows.map((row) => ({
        matchID: row?.matchID, date: row?.matchDateTime || row?.matchDateTimeUTC,
        matchIsFinished: row?.matchIsFinished, homeId: row?.team1?.teamId, awayId: row?.team2?.teamId,
        matchResults: row?.matchResults,
      }));
    } else {
      rows = await response.json();
    }
    const matches = normalizeOpenLigaMatches(rows, competition);
    if (typedDfb) {
      const byKey = new Map(phaseObservation.matches.map((row) => [`openliga:${row.matchID}`, row]));
      for (const match of matches) match.results = byKey.get(match.key)?.matchResults;
      const duplicates = matches.filter((match, index) => matches.findIndex((m) => m.key === match.key) !== index);
      if (duplicates.length) {
        return Response.json({ code: "INVALID_PERIODS", detail: "Duplicate match IDs: " + duplicates.map((m) => m.key).join(", "), phaseObservation }, { status: 422 });
      }
    }
    if (!matches.length || matches.length !== rows.length)
      throw new Error("Incomplete source data");
    return Response.json(
      {
        competition,
        season,
        matches,
        ...(phaseObservation && { phaseObservation }),
        source: {
          name: "OpenLigaDB",
          url: "https://www.openligadb.de/",
          dataUrl: "https://api.openligadb.de/getmatchdata/" + source.join("/"),
          license: "ODbL-1.0",
        },
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=0, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  } catch {
    if (phaseObservation) return Response.json({ code: "INVALID_PERIODS", detail: "Unreadable OpenLigaDB phase observation", phaseObservation }, { status: 422 });
    return Response.json(
      {
        error:
          "Les données de cette édition sont temporairement indisponibles.",
      },
      { status: 502 },
    );
  }
}

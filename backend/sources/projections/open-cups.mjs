import { parseFranceCup } from "../../../dashboard/frontend/src/services/openfootball-france-cup.js";
import { parseOpenCupText } from "../../../dashboard/frontend/src/services/openfootball-cups.js";
import { NATIONAL_CUP_ARCHIVES } from "../../../dashboard/frontend/src/services/cup-archives.js";
import { EURO_HISTORY_FOLDERS, parseEuroText } from "../../../dashboard/frontend/src/services/openfootball-euro.js";
import { openFootballScore } from "../../../dashboard/shared/openfootball-history.js";
import { worldCupHalf } from "./world-cup-halves.mjs";

const WORLD_CUP_YEARS = new Set([
  "1930",
  "1934",
  "1938",
  "1950",
  "1954",
  "1958",
  "1962",
  "1966",
  "1970",
  "1974",
  "1978",
  "1982",
  "1986",
  "1990",
  "1994",
  "1998",
  "2002",
  "2006",
  "2010",
  "2014",
  "2018",
  "2022",
  "2026",
]);
// The yearly Club World Cups played since the base's first season (2021/2022), in
// Football.TXT (openfootball/club-worldcup): an edition is played in December of its
// year or in February of the next. The 2025 tournament has its own JSON file.
const CLUB_WORLD_CUP_YEARS = new Set(["2021", "2022", "2023"]);
// The other confederations' club competitions, in Football.TXT (each club written with its
// country, "SE Palmeiras (BRA)"), the editions played since the base's first season. The
// South and North American ones are played within a calendar year, the African one from
// August to May. "N.N." is a team still to be decided.
const CONTINENTAL = {
  "copa-libertadores": { repo: "south-america", name: "Copa Libertadores", seasons: ["2021", "2022", "2023", "2024", "2025", "2026"],
    file: (season) => `copa-libertadores/${season}_copal.txt`, calendar: true },
  "copa-sudamericana": { repo: "south-america", name: "Copa Sudamericana", seasons: ["2021", "2022", "2023", "2024", "2025"],
    file: (season) => `copa-libertadores/${season}_copas.txt`, calendar: true },
  "concacaf-champions": { repo: "world", name: "Coupe des champions de la CONCACAF", seasons: ["2021", "2022", "2023", "2024", "2025"],
    file: (season) => `north-america/champions-league/${season}_concacafcl.txt`, calendar: true },
  "caf-champions-league": { repo: "world", name: "Ligue des champions de la CAF", seasons: ["2023/2024", "2024/2025"],
    file: (season) => `africa/champions-league/${season.slice(0, 4)}-${season.slice(7)}_cafcl.txt`, calendar: false },
};
const UNDECIDED = "N.N.";
// The Euros of 1960 to 2016, from openfootball/euro's text files at the commit the reader was checked against
// (22 November 2026: every match against International Results); 2020 and after from euro.json.
const EURO_HISTORY_COMMIT = "88d150a6c8db43925ea327b87e990f653c999b11";
const SOURCES = {
  euro: {
    repo: "euro.json",
    seasons: new Set(["2020", "2024", "2028", ...Object.keys(EURO_HISTORY_FOLDERS)]),
    file: "euro.json",
    history: { repo: "euro", branch: EURO_HISTORY_COMMIT, format: "euro-text", seasons: new Set(Object.keys(EURO_HISTORY_FOLDERS)),
      file: (season) => `${EURO_HISTORY_FOLDERS[season]}/euro.txt` },
  },
  "france-cup": {
    repo: "europe",
    seasons: new Set(["2024/2025"]),
    path: "france/2024-25_frcup.txt",
    format: "text",
  },
  "club-world-cup": {
    repo: "worldcup.json",
    seasons: new Set(["2025", ...CLUB_WORLD_CUP_YEARS]),
    file: "clubworldcup.json",
    yearly: { repo: "club-worldcup", file: "clubworldcup.txt", format: "year-text" },
  },
  "world-cup-history": {
    repo: "worldcup.json",
    seasons: WORLD_CUP_YEARS,
    file: "worldcup.json",
  },
  ...Object.fromEntries(
    Object.entries(CONTINENTAL).map(([key, item]) => [key, { ...item, seasons: new Set(item.seasons), format: "continental-text" }]),
  ),
  ...Object.fromEntries(
    Object.values(NATIONAL_CUP_ARCHIVES).map((item) => [
      item.key,
      { ...item, seasons: new Set([item.season]), format: "cup-text" },
    ]),
  ),
};

export async function GET(request) {
  const url = new URL(request.url);
  const competition = url.searchParams.get("competition");
  const season = url.searchParams.get("season");
  const found = Object.hasOwn(SOURCES, competition || "")
    ? SOURCES[competition]
    : null;
  const source =
    found?.yearly && CLUB_WORLD_CUP_YEARS.has(season)
      ? { ...found, ...found.yearly }
      : found?.history?.seasons.has(season)
        ? { ...found, ...found.history, seasons: found.seasons }
        : found;
  if (!source || !source.seasons.has(season))
    return Response.json(
      { error: "Compétition ou édition indisponible." },
      { status: 400 },
    );
  const path = source.path || (typeof source.file === "function" ? source.file(season) : season + "/" + source.file);
  const upstream =
    "https://raw.githubusercontent.com/openfootball/" +
    source.repo +
    "/" + (source.branch || "master") + "/" +
    path;
  try {
    const response = await fetch(upstream, {
      signal: AbortSignal.timeout(15000),
      next: { revalidate: 3600 },
    });
    if (!response.ok) throw new Error("Source unavailable");
    const data =
      source.format === "text"
        ? {
            name: "Coupe de France 2024/2025",
            matches: parseFranceCup(await response.text()),
          }
        : source.format === "year-text"
          ? {
              name: "Club World Cup " + season,
              matches: parseOpenCupText(await response.text(), Number(season), {}, { halfTime: true }),
            }
          : source.format === "euro-text"
          ? { name: "Euro " + season, matches: parseEuroText(await response.text(), Number(season)) }
          : source.format === "continental-text"
          ? {
              name: source.name + " " + season,
              matches: parseOpenCupText(await response.text(), Number(season.slice(0, 4)), {}, { calendar: source.calendar }),
            }
          : source.format === "cup-text"
          ? {
              name: competition,
              matches: parseOpenCupText(
                await response.text(),
                2024,
                source.rounds,
              ),
            }
          : await response.json();
    if (!Array.isArray(data.matches) || data.matches.length > 1000)
      throw new Error("Invalid source data");
    const matches = data.matches.map((match) => {
      // One score form, whatever the edition writes ([2, 1] or {ft: [2, 1]}); the source's own
      // status (1938 Sweden–Austria: "canceled") is the cups adapter's to read (FAILURE_MODES.md §19).
      let score = openFootballScore(match.score);
      const half = competition === "world-cup-history" ? worldCupHalf(season, match, score) : null;
      if (half) score = { ...score, ht: half.official_ht };
      // This FFF decision is reviewed. Preserve the other native markers as observations
      // without changing their published treatment while their decisions are unverified.
      const nativeAward = competition === "france-cup" && match.status === "awarded";
      const status = nativeAward && (match.date !== "2024-12-21" || match.team1 !== "Tours FC" || match.team2 !== "FC Lorient")
        ? undefined : match.status;
      return {
        round: match.round,
        group: match.group,
        num: match.num,
        date: match.date,
        team1: match.team1 === UNDECIDED ? null : match.team1,
        team2: match.team2 === UNDECIDED ? null : match.team2,
        ...(score && { score }),
        ...(typeof status === "string" && status && { status }),
        ...(nativeAward && { sourceStatus: "[awarded]" }),
        ...(half && { attestedHalf: { before: half.native_ht, fifaMatchId: half.fifa_match_id } }),
      };
    });
    return Response.json(
      {
        name: data.name,
        season,
        matches,
        source: {
          name: "OpenFootball",
          url: "https://github.com/openfootball/" + source.repo,
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
  } catch (error) {
    return Response.json(
      {
        error:
          "Les données de cette édition sont temporairement indisponibles.",
        // A body that cannot be read names why (the cups adapter records it).
        ...(error?.code === "INVALID_SCORE" && { code: error.code }),
      },
      { status: 502 },
    );
  }
}

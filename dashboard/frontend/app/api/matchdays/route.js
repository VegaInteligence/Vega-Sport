import { dataJson } from "../../../../backend/services/data-store.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const competition = params.get("competition") || "";
  const season = params.get("season") || "";
  if (
    !/^l_[A-Za-z0-9]{6}$/.test(competition) ||
    !/^\d{4}(?:\/\d{4})?$/.test(season)
  )
    return Response.json(
      { error: "Invalid competition or season" },
      { status: 400 },
    );
  const year = Number(season.slice(0, 4));
  const label = season.includes("/")
    ? season.replace("/", "-")
    : `${year}-${year + 1}`;
  try {
    const leagues = await dataJson(`computed/matchdays/${label}.json.gz`);
    return Response.json(
      { matches: leagues[competition] || {} },
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=900",
        },
      },
    );
  } catch {
    // A season may have fixtures in PitchAPI without a corresponding archive.
    return Response.json(
      { matches: {} },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

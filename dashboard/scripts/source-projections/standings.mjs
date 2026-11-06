import {
  SPORTSCORE_LEAGUES,
  normalizeSportscore,
} from "../../frontend/src/services/sportscore-standings.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const id = new URL(request.url).searchParams.get("competition");
  const slug = Object.hasOwn(SPORTSCORE_LEAGUES, id)
    ? SPORTSCORE_LEAGUES[id]
    : null;
  if (!slug) return Response.json({ available: false }, { status: 404 });
  try {
    const url = new URL("https://sportscore.com/api/widget/standings/");
    url.searchParams.set("sport", "football");
    url.searchParams.set("slug", slug);
    const response = await fetch(url, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      return Response.json({ available: false }, { status: 502 });
    const result = normalizeSportscore(await response.json(), slug);
    if (!result) return Response.json({ available: false }, { status: 404 });
    return Response.json(
      { ...result, source: "SportScore", fetchedAt: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=300",
        },
      },
    );
  } catch {
    return Response.json({ available: false }, { status: 502 });
  }
}

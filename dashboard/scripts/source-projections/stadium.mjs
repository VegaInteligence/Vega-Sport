import { stadiumPlans } from "../../frontend/src/services/stadium-plans.js";
import { fetchWikidataStadium } from "../../frontend/src/services/wikidata-stadium.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!/^Q[1-9]\d{0,11}$/.test(id || ""))
    return Response.json({ available: false }, { status: 400 });
  try {
    const stadium = await fetchWikidataStadium(id);
    if (!stadium) return Response.json({ available: false }, { status: 404 });
    return Response.json(
      { ...stadium, plans: stadiumPlans(id) },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=21600, stale-while-revalidate=86400",
        },
      },
    );
  } catch {
    return Response.json({ available: false }, { status: 502 });
  }
}

import { fetchWikidataClub } from "../../frontend/src/services/wikidata-club.js";
import { resolveClubIdentity } from "../../frontend/src/services/wikidata-club-identity.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("uefa"),
    name = params.get("name"),
    country = params.get("country");
  if (
    id
      ? !/^\d{1,12}$/.test(id)
      : !(
          name &&
          name.length >= 2 &&
          name.length <= 100 &&
          /^[A-Z]{3}$/.test(country || "")
        )
  )
    return Response.json({ available: false }, { status: 400 });
  try {
    const identity = id || (await resolveClubIdentity(name, country));
    if (!identity) return Response.json({ available: false }, { status: 404 });
    const club = await fetchWikidataClub(identity);
    if (!club) return Response.json({ available: false }, { status: 404 });
    return Response.json(club, {
      headers: {
        "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return Response.json({ available: false }, { status: 502 });
  }
}

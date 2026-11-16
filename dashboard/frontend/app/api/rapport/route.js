import { loadReport } from "../../../src/server/report-data.js";

export const dynamic = "force-dynamic";

/** GET /api/rapport?id=p_…|t_…|m_…[&season=2026/2027]: what the report of a player, a club or a match says. */
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  try {
    const report = await loadReport(params.get("id"), { season: params.get("season") });
    if (!report) return Response.json({ error: "Rapport indisponible." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json(report, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } });
  } catch (error) {
    console.error("report failed", params.get("id"), error?.message);
    return Response.json({ error: "Rapport momentanément indisponible." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

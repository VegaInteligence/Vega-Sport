import { matchObservation, profileObservation } from "./services/database.js";
import { publicFile, response } from "./services/files.js";
import { handlePitchApi } from "./services/pitchapi.js";
import { query, canonical, configured, cache } from "./services/neon.js";
import { instrumentRequest, serializeJson } from "./services/metrics.js";
import { cacheHeaders, noStoreHeaders } from "./services/cache-policy.js";
const assetLookup = cache(4 * 1024 * 1024, { name: "asset" });
export function handleRequest(request) {
  return instrumentRequest(request, async () => {
    const out = await routeRequest(request);
    if (request.method !== "HEAD" || !out.body) return out;
    await out.body.cancel();
    return new Response(null, { status: out.status, headers: out.headers });
  });
}
const json = (value, head, status = 200, headers = {}) =>
  response(head ? null : serializeJson(value), status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
async function routeRequest(request) {
  const head = request.method === "HEAD";
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return response("Invalid path", 400);
  }
  if (!pathname.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(pathname))
    return response("Invalid path", 400);
  if (pathname.split("/").some((x) => x.startsWith(".")))
    return response("Forbidden", 403);
  if (!["GET", "HEAD"].includes(request.method))
    return response("Method not allowed", 405, { Allow: "GET, HEAD" });
  try {
    if (pathname === "/api/health") {
      const [state] = await query(
        "SELECT value,updated_at FROM statarena.state WHERE name='revision'",
      );
      return json(
        { status: "ok", source: "Neon", revision: state?.value },
        head,
      );
    }
    if (pathname === "/api/settings") {
      const rows = await query(
        "SELECT name,value,updated_at FROM statarena.state WHERE name IN('daily','pulse','historical','revision')",
      );
      return json(
        {
          provider: "Neon",
          configured: configured(),
          schedule: {
            cron: "35 22 * * *",
            crons: ["35 22 * * *", "10 6 * * *"],
            timezone: "UTC",
            runner: "GitHub Actions",
          },
          sync: rows,
          workflowUrl:
            "https://github.com/OrionQuantPlatform/STATARENA/actions/workflows/daily-sync.yml",
        },
        head,
      );
    }
    if (pathname === "/api/assets") {
      const url = new URL(request.url).searchParams.get("url");
      if (!url || url.length > 2048) return response("Invalid asset", 400);
      const row = await assetLookup(
        url,
        async () =>
          (
            await query("SELECT path FROM statarena.assets WHERE url=$1", [url])
          )[0] || null,
        60 * 1000,
      );
      return row
        ? publicFile(row.path, request, { mutableAlias: true })
        : response("Not found", 404);
    }
    if (
      /^\/api\/(standings|open-cups|openligadb|nations-results|club-wikidata|coach-portrait|stadium|player-honours)$/.test(
        pathname,
      )
    ) {
      const params = new URL(request.url).searchParams;
      if (
        [...params].length > 4 ||
        [...params].some(([k, v]) => k.length > 40 || v.length > 200) ||
        new Set(params.keys()).size !== [...params].length
      )
        return response("Invalid parameters", 400);
      const row = (
        await query(
          `SELECT ${head ? "1 AS present" : "body"} FROM statarena.projections WHERE name=$1 AND params=$2`,
          [pathname.slice(5), canonical(Object.fromEntries(params))],
        )
      )[0];
      return row
        ? json(row.body, head, 200, {
            "Content-Type": "application/json",
            "X-Data-Source": "Neon",
            ...cacheHeaders(300, 60),
          })
        : json(
            {
              available: false,
              error: "Donnée absente de Neon.",
            },
            head,
            404,
          );
    }
    const profile = pathname.match(
      /^\/api\/archive\/profiles\/(leagues|teams|players)\/([ltp]_[A-Za-z0-9]{6})$/,
    );
    const match = pathname.match(
      /^\/api\/archive\/matches\/(m_[A-Za-z0-9]{6})$/,
    );
    if (profile || match) {
      if (
        profile &&
        profile[2][0] !== { leagues: "l", teams: "t", players: "p" }[profile[1]]
      )
        return response("Not found", 404);
      const record = profile
        ? await profileObservation(profile[1], profile[2])
        : await matchObservation(match[1]);
      return record
        ? json(record, head, 200, {
            "Content-Type": "application/json",
            "X-Data-Source": "Neon",
            ...(profile && record.status !== 200
              ? noStoreHeaders
              : cacheHeaders(60, 30)),
          })
        : response("Not found", 404);
    }
    if (pathname === "/api" || pathname.startsWith("/api/"))
      return handlePitchApi(request);
    if (pathname === "/data/dashboard-manifest.json")
      return publicFile("computed/dashboard/index.json", request);
    if (pathname === "/data/football-manifest.json")
      return publicFile("raw/index.json", request);
    if (/^\/data\/(raw|computed)\//.test(pathname))
      return publicFile(pathname.slice(6), request);
    return response("Not found", 404);
  } catch (e) {
    console.error("Neon request failed", e.name);
    return response("Neon data unavailable", 503);
  }
}

/**
 * Read API: Fetch-API handler (`handleRequest(Request) -> Response`). Routes are
 * tried in order; a path no route claims is a 404.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { errorResponse, reject } from "./http.mjs";
import { withResolvedMedia } from "./media.mjs";
import { createSystemRoute } from "./routes/system.mjs";
import { createOpsRoute } from "./routes/ops.mjs";
import { createClubReadRoute } from "./routes/clubs.mjs";
import { createEuropeRoute } from "./routes/europe.mjs";
import { createPlayerReadRoute } from "./routes/players.mjs";
import { createMatchRoute } from "./routes/matches.mjs";
import { createMatchDetailRoute } from "./routes/match-details.mjs";
import { createProfileRoute } from "./routes/profiles.mjs";
import { createPartitionRoute } from "./routes/partition.mjs";
import { createReferenceRoute } from "./routes/reference.mjs";
import { createDisciplineRoute } from "./routes/discipline.mjs";
import { createPresenceRoute } from "./routes/presence.mjs";
import { createPerformanceRoute } from "./routes/performance.mjs";
import { createActorRoute } from "./routes/actors.mjs";
import { createHomeFavouritesRoute, createHomeReadRoute } from "./routes/home.mjs";
import { createSearchRoute } from "./routes/search.mjs";
import { createArchiveRoute } from "./routes/archives.mjs";
import { createRankingRoute } from "./routes/rankings.mjs";
import { createSupportRoute } from "./routes/support.mjs";
import { createCupRoute } from "./routes/cups.mjs";
import { compactHomePresentation } from "./home-presentation.mjs";

/** The compact home cards (media=1), plus what the choice of « Prochains matchs »
 * reads (home-upcoming.js on the site): each offered match's editorial weight and cup
 * flag, and every club's rank, a favourite's match coming from the personal read. */
export function presentHome(data) {
  const out = compactHomePresentation(data);
  if (!out || !data) return out;
  if (Array.isArray(out.highlights))
    out.highlights = out.highlights.map((h, i) => ({ ...h, weight: data.highlights[i]?.weight, europe: data.highlights[i]?.europe }));
  if (Array.isArray(data.ranks)) out.ranks = data.ranks.map(([id, v]) => [id, { rank: v?.rank, form: v?.form }]);
  return out;
}

function pathOf(req) {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "?";
  }
}

/** `mediaBase`: the CloudFront origin of the image copies (https://…/); none, no media map.
 * `clock`: the home page's notion of now (tests pin it).
 * `opsKey`: the key of /api/ops/status (the private status page); none, no such route. */
export function createHandler({ read: query, mediaBase = null, clock = Date.now, opsKey = null }) {
  // What each request spent, in its answer (Server-Timing): the whole of it, and its
  // queries (their sum: queries run together count each for its own time). It tells a
  // slow read from a far one without the function's logs.
  const spent = new AsyncLocalStorage();
  const read = async (...args) => {
    const request = spent.getStore(),
      started = performance.now();
    try {
      return await query(...args);
    } finally {
      if (request) {
        request.db += performance.now() - started;
        request.queries++;
      }
    }
  };
  const routes = [createSystemRoute(read), createOpsRoute(read, { key: opsKey, clock }), createClubReadRoute(read), createPlayerReadRoute(read), createMatchRoute(read), createMatchDetailRoute(read), createProfileRoute(read), createPartitionRoute(read), createReferenceRoute(read), createDisciplineRoute(read), createPresenceRoute(read), createPerformanceRoute(read), createActorRoute(read), createHomeReadRoute(read, clock), createHomeFavouritesRoute(read, clock), createSearchRoute(read), createArchiveRoute(read), createRankingRoute(read), createSupportRoute(read, { mediaBase }), createCupRoute(read), createEuropeRoute(read)];
  async function route(req) {
    const url = new URL(req.url),
      path = url.pathname;
    if (!["GET", "HEAD"].includes(req.method)) reject(405, "Méthode non autorisée.");
    if (!path.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(path)) reject(400, "Chemin invalide.");
    if (path.split("/").some((part) => part.startsWith("."))) reject(404, "Ressource introuvable.");
    for (const handle of routes) {
      const response = await handle(req, path, url.searchParams);
      if (response) return response;
    }
    reject(404, "Ressource introuvable.");
  }
  async function answer(req) {
    try {
      return (await withResolvedMedia(req, route, read, mediaBase, { present: presentHome })) || (await route(req));
    } catch (error) {
      // The path alone, never the query: it says which read failed without logging what was asked.
      if (!(error.status >= 400 && error.status <= 599)) console.error("read failed", error.code || error.name, pathOf(req));
      return errorResponse(req, error);
    }
  }
  return async function handleRequest(req) {
    const request = { db: 0, queries: 0 },
      started = performance.now();
    const response = await spent.run(request, () => answer(req));
    const ms = (value) => (Math.round(value * 10) / 10).toFixed(1);
    try {
      response.headers.set("Server-Timing", `total;dur=${ms(performance.now() - started)}, db;dur=${ms(request.db)};desc="${request.queries} quer${request.queries === 1 ? "y" : "ies"}"`);
    } catch {
      /* a response whose headers cannot be changed keeps them */
    }
    return response;
  };
}

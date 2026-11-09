/**
 * v2 read API: Fetch-API handler, same entry point as aws-app.js on main
 * (`handleRequest(Request) -> Response`). Routes are tried in order; a path no
 * route claims is a 404, as today. CloudFront moves route families to this
 * handler one at a time (doc "Bascule route par route").
 */
import { errorResponse, reject } from "./http.mjs";
import { withResolvedMedia } from "./media.mjs";
import { createSystemRoute } from "./routes/system.mjs";
import { createClubReadRoute } from "./routes/clubs.mjs";
import { createPlayerReadRoute } from "./routes/players.mjs";
import { createMatchRoute } from "./routes/matches.mjs";
import { createReferenceRoute } from "./routes/reference.mjs";
import { createDisciplineRoute } from "./routes/discipline.mjs";
import { createPerformanceRoute } from "./routes/performance.mjs";
import { createActorRoute } from "./routes/actors.mjs";

/** `mediaBase`: the CloudFront origin of the image copies (https://…/); none, no media map. */
export function createHandler({ read, mediaBase = null }) {
  const routes = [createSystemRoute(read), createClubReadRoute(read), createPlayerReadRoute(read), createMatchRoute(read), createReferenceRoute(read), createDisciplineRoute(read), createPerformanceRoute(read), createActorRoute(read)];
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
  return async function handleRequest(req) {
    try {
      return (await withResolvedMedia(req, route, read, mediaBase)) || (await route(req));
    } catch (error) {
      if (!(error.status >= 400 && error.status <= 599)) console.error("v2 read failed", error.code || error.name);
      return errorResponse(req, error);
    }
  };
}

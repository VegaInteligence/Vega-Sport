/** Read-only PitchAPI gateway shared by the hosted Worker and local server. */
import {
  savedResource,
  fixtureResource,
  archivedResource,
} from "./database.js";
import { configured, query } from "./neon.js";
const API_PREFIX = "/api/pitchapi";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ID = "[A-Za-z0-9]{6}";
const MATCH = `m_${ID}`;
const PLAYER = `p_${ID}`;

// These are the documented GET resources at https://pitchapi.dev/.
// Keep the base origin and allowed routes in code: a visitor cannot supply a URL.
const ROUTES = [
  { pattern: /^\/leagues$/, ttl: 900 },
  { pattern: new RegExp(`^/leagues/l_${ID}$`), ttl: 900 },
  {
    pattern: new RegExp(`^/leagues/l_${ID}/matches$`),
    query: ["season", "status"],
    ttl: 180,
  },
  {
    pattern: /^\/date\/\d{4}-\d{2}-\d{2}$/,
    query: ["status"],
    ttl: 120,
    date: true,
  },
  { pattern: new RegExp(`^/teams/t_${ID}$`), ttl: 3600 },
  { pattern: new RegExp(`^/players/${PLAYER}$`), ttl: 3600 },
  { pattern: new RegExp(`^/matches/${MATCH}$`), ttl: 120 },
  {
    pattern: new RegExp(
      `^/matches/${MATCH}/(?:shots|momentum|events|players|players/halves|stats|h2h|advanced|advanced/players|advanced/network)$`,
    ),
    ttl: 300,
  },
  { pattern: new RegExp(`^/matches/${MATCH}/lineups$`), ttl: 60 },
  {
    pattern: new RegExp(`^/matches/${MATCH}/heatmaps$`),
    query: ["frame"],
    ttl: 300,
  },
  { pattern: new RegExp(`^/matches/${MATCH}/shots/s_${ID}$`), ttl: 300 },
  {
    pattern: new RegExp(
      `^/matches/${MATCH}/players/${PLAYER}(?:/halves|/shots)?$`,
    ),
    ttl: 300,
  },
  {
    pattern: new RegExp(`^/matches/${MATCH}/advanced/players/${PLAYER}$`),
    ttl: 300,
  },
];

const ERROR_MESSAGES = {
  INVALID_PARAMETER: "Un paramètre de la requête est invalide.",
  RESOURCE_NOT_FOUND: "Cette ressource est introuvable.",
  ANALYTICS_UNAVAILABLE:
    "L’analyse avancée n’est pas disponible pour ce match.",
  HALVES_UNAVAILABLE:
    "Les statistiques par mi-temps ne sont pas disponibles pour ce match.",
  RATE_LIMIT_EXCEEDED: "Trop de requêtes : réessayez dans un instant.",
  PITCHAPI_NOT_CONFIGURED:
    "Les données en direct ne sont pas disponibles pour le moment.",
  PITCHAPI_AUTH_FAILED:
    "Les données en direct ne sont pas disponibles pour le moment.",
  PITCHAPI_UNAVAILABLE:
    "Les données en direct sont temporairement indisponibles. Réessayez dans un instant.",
  PITCHAPI_INVALID_RESPONSE: "Les données reçues sont inexploitables.",
  ROUTE_NOT_FOUND: "Cette route de données n’est pas disponible.",
  METHOD_NOT_ALLOWED: "Seules les requêtes GET sont acceptées.",
  GATEWAY_BUSY:
    "Plusieurs données sont en cours de chargement. Réessayez dans un instant.",
};

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function apiError(code, status, retryAfter) {
  const error = {
    code,
    message: ERROR_MESSAGES[code] || ERROR_MESSAGES.PITCHAPI_UNAVAILABLE,
  };
  const headers = {};
  if (retryAfter !== undefined) {
    error.retryAfter = retryAfter;
    headers["Retry-After"] = String(retryAfter);
  }
  if (status === 405) headers.Allow = "GET";
  return jsonResponse({ ok: false, error }, status, headers);
}

function validDate(value) {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function validateResource(url) {
  const resource = url.pathname.slice(API_PREFIX.length);
  const route = ROUTES.find((candidate) => candidate.pattern.test(resource));
  if (!route) return { error: apiError("ROUTE_NOT_FOUND", 404) };
  if (route.date && !validDate(resource.slice("/date/".length))) {
    return { error: apiError("INVALID_PARAMETER", 400) };
  }
  const parameters = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (!route.query?.includes(key) || parameters.has(key)) {
      return { error: apiError("INVALID_PARAMETER", 400) };
    }
    if (key === "season" && !/^\d{4}(?:\/\d{4})?$/.test(value)) {
      return { error: apiError("INVALID_PARAMETER", 400) };
    }
    if (key === "status" && !["played", "upcoming", "all"].includes(value)) {
      return { error: apiError("INVALID_PARAMETER", 400) };
    }
    if (key === "frame" && !["acting_ltr", "home_ltr"].includes(value)) {
      return { error: apiError("INVALID_PARAMETER", 400) };
    }
    parameters.set(key, value);
  }
  parameters.sort();
  const query = parameters.toString();
  return { resource, query: query ? `?${query}` : "", ttl: route.ttl };
}

/** Compatibility routes backed exclusively by indexed Neon observations. */
export async function handlePitchApi(request) {
  const url = new URL(request.url);
  if (!["GET", "HEAD"].includes(request.method))
    return apiError("METHOD_NOT_ALLOWED", 405);
  if (url.pathname === "/api/status")
    return jsonResponse({
      configured: configured(),
      source: "Neon",
      basePath: API_PREFIX,
    });
  if (!url.pathname.startsWith(API_PREFIX + "/"))
    return apiError("ROUTE_NOT_FOUND", 404);
  const checked = validateResource(url);
  if (checked.error) return checked.error;
  if (!configured()) return apiError("PITCHAPI_NOT_CONFIGURED", 503);
  try {
    const params = Object.fromEntries(url.searchParams);
    const indexed = await fixtureResource(checked.resource, params);
    let saved = indexed?.data?.matches?.length
      ? indexed
      : await savedResource(checked.resource, params);
    if (!saved && !Object.keys(params).length)
      saved = await archivedResource(checked.resource);
    if (!saved) saved = indexed;
    if (!saved && checked.resource === "/leagues") {
      const manifest = (await import("./data-store.js")).dataJson;
      const index = await manifest("computed/dashboard/index.json");
      const leagues = [
        ...new Map(
          index.seasons
            .flatMap((s) => s.chunks.flatMap((c) => c.competitions || []))
            .map((c) => [c.id, c]),
        ).values(),
      ];
      saved = { status: 200, data: { leagues } };
    }
    if (!saved) return apiError("RESOURCE_NOT_FOUND", 404);
    const payload =
      saved.status === 200
        ? { data: saved.data }
        : {
            ok: false,
            error: saved.error || {
              code: "RESOURCE_NOT_FOUND",
              message: "Donnée indisponible dans Neon.",
            },
          };
    const out = jsonResponse(payload, saved.status, {
      "X-Data-Source": "Neon",
      "Cache-Control":
        saved.status === 200
          ? "public, max-age=0, s-maxage=60, stale-while-revalidate=30"
          : "no-store",
    });
    return request.method === "HEAD"
      ? new Response(null, { status: out.status, headers: out.headers })
      : out;
  } catch (e) {
    console.error("Neon resource unavailable", e.name);
    return apiError("PITCHAPI_UNAVAILABLE", 503);
  }
}

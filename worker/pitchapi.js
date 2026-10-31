/** Read-only PitchAPI gateway shared by the hosted Worker and local server. */
const PROVIDER_ORIGIN = 'https://api.pitchapi.dev';
const API_PREFIX = '/api/pitchapi';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ID = '[A-Za-z0-9]{6}';
const MATCH = `m_${ID}`;
const PLAYER = `p_${ID}`;

// These are the documented GET resources at https://pitchapi.dev/.
// Keep the base origin and allowed routes in code: a visitor cannot supply a URL.
const ROUTES = [
  { pattern: /^\/leagues$/, ttl: 900 },
  { pattern: new RegExp(`^/leagues/l_${ID}$`), ttl: 900 },
  { pattern: new RegExp(`^/leagues/l_${ID}/matches$`), query: ['season', 'status'], ttl: 180 },
  { pattern: /^\/date\/\d{4}-\d{2}-\d{2}$/, query: ['status'], ttl: 120, date: true },
  { pattern: new RegExp(`^/teams/t_${ID}$`), ttl: 3600 },
  { pattern: new RegExp(`^/players/${PLAYER}$`), ttl: 3600 },
  { pattern: new RegExp(`^/matches/${MATCH}$`), ttl: 120 },
  { pattern: new RegExp(`^/matches/${MATCH}/(?:shots|momentum|events|players|players/halves|stats|h2h|advanced|advanced/players|advanced/network)$`), ttl: 300 },
  { pattern: new RegExp(`^/matches/${MATCH}/lineups$`), ttl: 60 },
  { pattern: new RegExp(`^/matches/${MATCH}/heatmaps$`), query: ['frame'], ttl: 300 },
  { pattern: new RegExp(`^/matches/${MATCH}/shots/s_${ID}$`), ttl: 300 },
  { pattern: new RegExp(`^/matches/${MATCH}/players/${PLAYER}(?:/halves|/shots)?$`), ttl: 300 },
  { pattern: new RegExp(`^/matches/${MATCH}/advanced/players/${PLAYER}$`), ttl: 300 },
];

const ERROR_MESSAGES = {
  INVALID_PARAMETER: 'Un paramètre de la requête est invalide.',
  RESOURCE_NOT_FOUND: 'Cette ressource est introuvable dans PitchAPI.',
  ANALYTICS_UNAVAILABLE: 'PitchAPI ne fournit pas d’analyse avancée pour ce match.',
  HALVES_UNAVAILABLE: 'PitchAPI ne fournit pas de statistiques par mi-temps pour ce match.',
  RATE_LIMIT_EXCEEDED: 'PitchAPI demande de patienter avant la prochaine requête.',
  PITCHAPI_NOT_CONFIGURED: 'La connexion PitchAPI attend sa clé dans la configuration du serveur.',
  PITCHAPI_AUTH_FAILED: 'La clé PitchAPI du serveur doit être vérifiée.',
  PITCHAPI_UNAVAILABLE: 'PitchAPI est temporairement indisponible. Réessayez dans un instant.',
  PITCHAPI_INVALID_RESPONSE: 'PitchAPI a renvoyé une réponse inexploitable.',
  ROUTE_NOT_FOUND: 'Cette route de données n’est pas disponible.',
  METHOD_NOT_ALLOWED: 'Seules les requêtes GET sont acceptées.',
  GATEWAY_BUSY: 'Plusieurs données sont en cours de chargement. Réessayez dans un instant.',
};

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function apiError(code, status, retryAfter) {
  const error = { code, message: ERROR_MESSAGES[code] || ERROR_MESSAGES.PITCHAPI_UNAVAILABLE };
  const headers = {};
  if (retryAfter !== undefined) {
    error.retryAfter = retryAfter;
    headers['Retry-After'] = String(retryAfter);
  }
  if (status === 405) headers.Allow = 'GET';
  return jsonResponse({ ok: false, error }, status, headers);
}

function configuredKey(env) {
  const key = env?.PITCHAPI_API_KEY;
  return typeof key === 'string' && key.length <= 512 && /^pk_(?:live|test)_[A-Za-z0-9_-]+$/.test(key) ? key : null;
}

function validDate(value) {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function validateResource(url) {
  const resource = url.pathname.slice(API_PREFIX.length);
  const route = ROUTES.find(candidate => candidate.pattern.test(resource));
  if (!route) return { error: apiError('ROUTE_NOT_FOUND', 404) };
  if (route.date && !validDate(resource.slice('/date/'.length))) {
    return { error: apiError('INVALID_PARAMETER', 400) };
  }
  const parameters = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (!route.query?.includes(key) || parameters.has(key)) {
      return { error: apiError('INVALID_PARAMETER', 400) };
    }
    if (key === 'season' && !/^\d{4}(?:\/\d{4})?$/.test(value)) {
      return { error: apiError('INVALID_PARAMETER', 400) };
    }
    if (key === 'status' && !['played', 'upcoming', 'all'].includes(value)) {
      return { error: apiError('INVALID_PARAMETER', 400) };
    }
    if (key === 'frame' && !['acting_ltr', 'home_ltr'].includes(value)) {
      return { error: apiError('INVALID_PARAMETER', 400) };
    }
    parameters.set(key, value);
  }
  parameters.sort();
  const query = parameters.toString();
  return { resource, query: query ? `?${query}` : '', ttl: route.ttl };
}

/** A bounded fallback for local development; Cloudflare uses caches.default. */
export function createMemoryCache({ maxEntries = 48, maxBytes = 8 * 1024 * 1024, now = Date.now } = {}) {
  const entries = new Map();
  let bytes = 0;
  function remove(key) {
    const entry = entries.get(key);
    if (entry) bytes -= entry.size;
    entries.delete(key);
  }
  return {
    async match(request) {
      const entry = entries.get(request.url);
      if (!entry) return undefined;
      if (entry.expires <= now()) {
        remove(request.url);
        return undefined;
      }
      entries.delete(request.url);
      entries.set(request.url, entry);
      return new Response(entry.body, { status: 200, headers: entry.headers });
    },
    async put(request, response) {
      if (response.status !== 200) return;
      const ttl = Number(response.headers.get('Cache-Control')?.match(/\bmax-age=(\d+)/)?.[1] || 0);
      if (!ttl) return;
      const body = await response.text();
      const size = new TextEncoder().encode(body).byteLength;
      if (size > maxBytes) return;
      remove(request.url);
      for (const [key, entry] of entries) if (entry.expires <= now()) remove(key);
      while (entries.size && (entries.size >= maxEntries || bytes + size > maxBytes)) remove(entries.keys().next().value);
      if (maxEntries < 1) return;
      entries.set(request.url, { body, headers: [...response.headers], size, expires: now() + ttl * 1000 });
      bytes += size;
    },
  };
}

function retryDelay(header, now) {
  if (!header) return 30;
  const seconds = /^\d+$/.test(header.trim()) ? Number(header) : Math.ceil((Date.parse(header) - now()) / 1000);
  return Number.isFinite(seconds) ? Math.max(1, Math.min(seconds, 86400)) : 30;
}

async function readBounded(response) {
  if (Number(response.headers.get('Content-Length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error('Response limit');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Response limit');
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/** Dependencies can be injected for deterministic tests without API requests. */
export function createPitchApiHandler({ fetcher = globalThis.fetch, cache, now = Date.now, timeoutMs = 15000 } = {}) {
  const memoryCache = createMemoryCache({ now });
  const pending = new Map();

  async function upstream(resource, key) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(`${PROVIDER_ORIGIN}/v1${resource.resource}${resource.query}`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'X-API-KEY': key },
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status === 429) {
        await response.body?.cancel();
        return apiError('RATE_LIMIT_EXCEEDED', 429, retryDelay(response.headers.get('Retry-After'), now));
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        return apiError('PITCHAPI_AUTH_FAILED', 502);
      }
      if (response.status >= 500 || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel();
        return apiError('PITCHAPI_UNAVAILABLE', 502);
      }
      let payload;
      let body;
      try {
        body = await readBounded(response);
        // Refuse unexpected credential-bearing responses; never echo provider errors.
        if (body.includes(key) || /pk_(?:live|test)_[A-Za-z0-9_-]+/.test(body)) {
          return apiError('PITCHAPI_INVALID_RESPONSE', 502);
        }
        payload = JSON.parse(body);
      } catch {
        return apiError('PITCHAPI_INVALID_RESPONSE', 502);
      }
      if (response.status === 404) {
        const code = ['RESOURCE_NOT_FOUND', 'ANALYTICS_UNAVAILABLE', 'HALVES_UNAVAILABLE'].includes(payload?.error?.code)
          ? payload.error.code : 'RESOURCE_NOT_FOUND';
        return apiError(code, 404);
      }
      if (response.status === 400) return apiError('INVALID_PARAMETER', 400);
      if (!response.ok || !payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.hasOwn(payload, 'data') || Object.hasOwn(payload, 'error')) {
        return apiError('PITCHAPI_INVALID_RESPONSE', 502);
      }
      return jsonResponse({ data: payload.data }, 200, {
        'Cache-Control': `public, max-age=${resource.ttl}`,
        'X-PitchAPI-Fetched-At': new Date(now()).toISOString(),
      });
    } catch {
      // Fetch/timeout exceptions can contain URLs or headers. Do not serialize them.
      return apiError('PITCHAPI_UNAVAILABLE', 502);
    } finally {
      clearTimeout(timer);
    }
  }

  return async function handle(request, env = {}) {
    if (request.method !== 'GET') return apiError('METHOD_NOT_ALLOWED', 405);
    let url;
    try { url = new URL(request.url); } catch { return apiError('INVALID_PARAMETER', 400); }
    if (url.pathname === '/api/status') {
      return jsonResponse({
        ok: true,
        source: 'PitchAPI',
        configured: Boolean(configuredKey(env)),
        basePath: API_PREFIX,
        documentation: 'https://pitchapi.dev/',
      });
    }
    if (!url.pathname.startsWith(`${API_PREFIX}/`)) return apiError('ROUTE_NOT_FOUND', 404);
    const resource = validateResource(url);
    if (resource.error) return resource.error;
    const key = configuredKey(env);
    if (!key) return apiError('PITCHAPI_NOT_CONFIGURED', 503);

    // Same-origin cache keys contain public resource parameters, never credentials.
    const cacheRequest = new Request(`${url.origin}${API_PREFIX}${resource.resource}${resource.query}`);
    const responseCache = cache === undefined ? (globalThis.caches?.default || memoryCache) : cache;
    try {
      const cached = await responseCache?.match(cacheRequest);
      if (cached?.status === 200) {
        const result = new Response(cached.body, cached);
        result.headers.set('X-PitchAPI-Cache', 'HIT');
        return result;
      }
    } catch { /* A cache failure must not disable data access. */ }

    const existing = pending.get(cacheRequest.url);
    if (existing) return (await existing).clone();
    if (pending.size >= 8) return apiError('GATEWAY_BUSY', 503, 1);
    const operation = (async () => {
      const response = await upstream(resource, key);
      if (response.status === 200) {
        try { await responseCache?.put(cacheRequest, response.clone()); } catch { /* Best-effort cache. */ }
      }
      response.headers.set('X-PitchAPI-Cache', 'MISS');
      return response;
    })();
    pending.set(cacheRequest.url, operation);
    try { return (await operation).clone(); } finally { pending.delete(cacheRequest.url); }
  };
}

export const handlePitchApi = createPitchApiHandler();

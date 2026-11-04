import { apiUrl } from "../data-url.js";

const TOKEN = /^pro1\.([1-9][0-9]{0,18})\.[a-f0-9]{64}$/;
const MATCH = /^m_[A-Za-z0-9]{6}$/;
const copy = (value) => structuredClone(value);

function validToken(value) {
  const match = typeof value === "string" && TOKEN.exec(value);
  return Boolean(match && BigInt(match[1]) <= 9223372036854775807n);
}

function invalid(message = "Réponse de données invalide.") {
  const error = new Error(message);
  error.code = "INVALID_REPRESENTATION";
  return error;
}

export function isProManifest(value) {
  return value?.storage === "aws-orion-pro" &&
    value.schemaVersion === 4 &&
    value.capabilities?.frozenRepresentations === true &&
    Array.isArray(value.editions);
}

async function readJson(fetcher, path, validate) {
  const response = await fetcher(apiUrl(path), {
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  let value;
  try { value = JSON.parse(text); }
  catch { throw invalid("La réponse du service est illisible."); }
  if (!response.ok || value?.error) {
    const error = new Error(value?.error?.message || `Données indisponibles (HTTP ${response.status}).`);
    error.status = response.status;
    error.code = value?.error?.code;
    error.state = value?.error?.state;
    throw error;
  }
  validate(value);
  return { value, bytes: new TextEncoder().encode(text).byteLength };
}

/** Retain successful bounded values; pending requests cannot evict useful data. */
export function createProMatchCache({ maxBytes = 8 * 1024 * 1024, maxEntries = 48 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      !Number.isSafeInteger(maxEntries) || maxEntries < 1)
    throw new Error("Limite de cache invalide.");
  const scopes = new WeakMap();
  return Object.freeze({
    async load(fetcher, key, loader) {
      if (!scopes.has(fetcher)) scopes.set(fetcher, { entries: new Map(), pending: new Map(), bytes: 0 });
      const state = scopes.get(fetcher);
      if (state.entries.has(key)) {
        const entry = state.entries.get(key);
        state.entries.delete(key); state.entries.set(key, entry);
        return copy(entry.value);
      }
      let promise = state.pending.get(key);
      if (!promise) {
        promise = Promise.resolve().then(loader).then((entry) => {
          if (entry.bytes <= maxBytes) {
            const old = state.entries.get(key);
            if (old) state.bytes -= old.bytes;
            state.entries.delete(key); state.entries.set(key, entry); state.bytes += entry.bytes;
            while (state.entries.size > maxEntries || state.bytes > maxBytes) {
              const oldest = state.entries.keys().next().value;
              state.bytes -= state.entries.get(oldest).bytes;
              state.entries.delete(oldest);
            }
          }
          return entry.value;
        }).finally(() => {
          if (state.pending.get(key) === promise) state.pending.delete(key);
        });
        if (state.pending.size < maxEntries) state.pending.set(key, promise);
      }
      return copy(await promise);
    },
  });
}

const sharedCache = createProMatchCache();

export async function loadProManifest(fetcher = fetch) {
  const { value } = await readJson(fetcher, "/api/dashboard/manifest", (manifest) => {
    if (!isProManifest(manifest)) throw invalid("Ce manifeste ne fournit pas de représentations figées.");
    if (manifest.editions.some((e) => !e || typeof e.leagueId !== "string" ||
        typeof e.season !== "string" || !validToken(e.representationToken))) throw invalid();
  });
  return value;
}

/** One edition and one immutable representation, with no archive fallback. */
export class ProMatchClient {
  constructor({ manifest, leagueId, season, fetcher = fetch, cache = sharedCache }) {
    if (!isProManifest(manifest) || typeof fetcher !== "function" || typeof cache?.load !== "function")
      throw invalid("Configuration de lecture indisponible.");
    const editions = manifest.editions.filter((e) => e.leagueId === leagueId && e.season === season);
    if (editions.length !== 1 || !validToken(editions[0].representationToken))
      throw invalid("Édition indisponible ou ambiguë.");
    this.leagueId = leagueId;
    this.season = season;
    this.representationToken = editions[0].representationToken;
    this.fetcher = fetcher;
    this.cache = cache;
  }

  resourceKey(kind, id = "") {
    return JSON.stringify(["orion-pro", this.representationToken, kind, id]);
  }

  async request(path, parameters, validate) {
    const params = new URLSearchParams({ ...parameters, v: this.representationToken });
    params.sort();
    const url = `${path}?${params}`;
    return this.cache.load(this.fetcher, apiUrl(url), () => readJson(this.fetcher, url, validate));
  }

  page(filters = {}) {
    const allowed = new Set(["limit", "cursor", "status", "from", "to", "q"]);
    if (Object.keys(filters).some((key) => !allowed.has(key))) throw invalid("Filtre de page invalide.");
    const limit = filters.limit ?? 30;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
        (filters.cursor != null && (typeof filters.cursor !== "string" || !filters.cursor)))
      throw invalid("Pagination invalide.");
    const parameters = { ...filters, limit: String(limit), league: this.leagueId, season: this.season };
    if (parameters.cursor == null) delete parameters.cursor;
    for (const key of Object.keys(parameters)) if (parameters[key] == null) delete parameters[key];
    return this.request("/api/fixtures", parameters, (body) => {
      const rows = body?.data?.matches, page = body?.pagination;
      if (!Array.isArray(rows) || page?.generation !== this.representationToken ||
          !Object.hasOwn(page, "nextCursor") ||
          (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor)) ||
          rows.some((row) => typeof row?.id !== "string" || !row.id) ||
          new Set(rows.map((row) => row.id)).size !== rows.length) throw invalid();
    });
  }

  async summary(id) {
    if (!MATCH.test(id)) throw invalid("Identifiant de match invalide.");
    const body = await this.request(`/api/matches/${id}/summary`, {}, (value) => {
      if (value?.data?.representationToken !== this.representationToken ||
          value.data.version !== 1 || value.data.match?.id !== id ||
          value.data.match.summaryVersion !== 1) throw invalid();
    });
    return { ...body.data.match, representationToken: this.representationToken };
  }

  async shots(id) {
    if (!MATCH.test(id)) throw invalid("Identifiant de match invalide.");
    const body = await this.request(`/api/pitchapi/matches/${id}/shots`, {}, (value) => {
      const data = value?.data;
      if (data?.representationToken !== this.representationToken ||
          !["present", "empty"].includes(data.collectionState) || !Array.isArray(data.periods) ||
          data.periods.some((period) => !Array.isArray(period?.shots))) throw invalid();
      const count = data.periods.reduce((total, period) => total + period.shots.length, 0);
      if ((data.collectionState === "empty") !== (count === 0)) throw invalid();
    });
    return body.data;
  }
}

import { normalizeArchive } from "./format.js";
import { apiUrl, dataUrl } from "../data-url.js";
import { completeFixtures } from "./fixture-pages.js";
import { cupWorkerSnapshot } from "./cup-worker-client.js";
import { SAUDI_PRO_LEAGUE, reconcileSaudiFixtures } from "./saudi-fixtures.js";
import { createResourceCache } from "./resource-cache.js";
import {
  matchReadSource,
  matchResourceKey,
  readMatchResource,
  validateMatchPublication,
} from "./match-resources.js";
/** Data access only: no view builders, document selectors or event delegation. */
let clientSequence = 0;
export class FootballDataClient {
  constructor({ data, manifest, redraw = () => {} }) {
    this.id = ++clientSequence;
    Object.assign(this, { data, redraw });
    this.manifest = manifest || {
      storage: data.meta.storage,
      publicationVersion: data.meta.generation,
      retrievedAt: data.meta.retrievedAt,
    };
    this.catalog = data.competitions;
    this.configured = false;
    this.statusKnown = false;
    this.statusPromise = Promise.resolve();
    this.fixtures = new Map();
    this.fixtureIndex = new Map();
    this.payloads = new Map();
    this.payloadKeys = new Map();
    this.endpointReads = createResourceCache();
    this.day = data.meta.endDate;
    this.browseMode = "catalog";
  }
  async checkStatus() {
    if (this.statusKnown) return;
    try {
      const r = await fetch(apiUrl("/api/status"));
      this.configured = r.ok && (await r.json()).configured === true;
    } catch {
      this.configured = false;
    }
    this.statusKnown = true;
  }
  async init() {
    this.statusPromise = this.checkStatus();
    await this.statusPromise;
    if (this.configured) {
      try {
        const response = await this.request("leagues");
        if (Array.isArray(response.data?.leagues))
          this.catalog = response.data.leagues.map((l) => ({
            ...l,
            country:
              this.data.competitions.find((x) => x.id === l.id)?.country ||
              l.country_code,
            imageUrl: l.image_url,
            sampleMatches:
              this.data.competitions.find((x) => x.id === l.id)
                ?.sampleMatches || 0,
          }));
      } catch {
        /* Keep the traceable local catalogue. */
      }
    }
    this.redraw();
  }
  async request(path, { signal } = {}) {
    const response = await fetch(apiUrl(`/api/pitchapi/${path}`), {
      headers: { Accept: "application/json" },
      signal,
    });
    let body;
    try {
      body = await response.json();
    } catch (error) {
      signal?.throwIfAborted();
      if (error?.name === "AbortError") throw error;
      const unavailable = new Error(
        "La connexion aux données est momentanément indisponible.",
      );
      unavailable.status = response.status;
      throw unavailable;
    }
    if (!response.ok || body.error) {
      const error = new Error(
        body.error?.message || "Les données ne sont pas disponibles.",
      );
      error.code = body.error?.code;
      error.status = response.status;
      throw error;
    }
    return body;
  }
  localFixtures(leagueId, season) {
    if (Array.isArray(this.data.fixtures))
      return this.data.fixtures.filter(
        (m) =>
          (!leagueId || m.league?.id === leagueId) &&
          (!season || m.season === season),
      );
    return this.data.matches
      .filter(
        (m) =>
          (!leagueId || m.leagueId === leagueId) &&
          (!season || m.season === season),
      )
      .map((m) => ({
        id: m.id,
        date: m.date,
        time_utc: m.timeUtc,
        status: m.status,
        home_team: { ...m.home, image_url: m.home.imageUrl },
        away_team: { ...m.away, image_url: m.away.imageUrl },
        score_home: m.home.score,
        score_away: m.away.score,
        league: { id: m.leagueId, name: m.league },
        season: m.season,
      }));
  }
  async loadFixtures({ signal } = {}) {
    const { browseMode, day, competitionId, season } = this;
    const league =
      this.catalog.find((x) => x.id === competitionId) || this.competition;
    const key =
      browseMode === "day" ? `date:${day}` : `${competitionId}:${season}`;
    if (this.fixtures.has(key)) return;
    this.fixtures.set(key, { loading: true });
    await this.statusPromise;
    let result;
    if (browseMode !== "day" && this.useCupSnapshot) {
      try {
        const saved = await cupWorkerSnapshot(
          "native",
          competitionId,
          season,
          null,
          { signal },
        );
        result = {
          matches: saved.matches,
          rounds: saved.rounds || {},
          source: "snapshot",
        };
      } catch (error) {
        if (error.name === "AbortError") {
          this.fixtures.delete(key);
          throw error;
        }
        /* Older editions can still use the provider or local archive. */
      }
    }
    if (!result) {
      try {
        if (!this.configured)
          throw new Error("Les données en direct ne sont pas disponibles.");
        const matches = await completeFixtures(
          browseMode === "day" ? { day } : { league: league.id, season },
          { signal },
        );
        result = {
          matches:
            browseMode === "day"
              ? matches
              : matches.map((match) => ({
                  ...match,
                  league: match.league || {
                    id: league.id,
                    name: league.name,
                  },
                  season: match.season ?? season,
                })),
          source: "api",
        };
      } catch (error) {
        if (error.name === "AbortError") {
          this.fixtures.delete(key);
          throw error;
        }
        const matches =
          browseMode === "day"
            ? this.localFixtures().filter((m) => m.date === day)
            : this.localFixtures(competitionId, season);
        result = { matches, source: "snapshot", error: error.message };
      }
    }
    if (browseMode !== "day" && competitionId === SAUDI_PRO_LEAGUE)
      result.matches = reconcileSaudiFixtures(result.matches);
    for (const match of result.matches) this.fixtureIndex.set(match.id, match);
    this.fixtures.set(key, result);
    this.redraw();
  }
  async loadSupplemental() {
    this.supplementalLoading = true;
    this.supplementalError = null;
    try {
      if (this.data.meta?.storage === "json-packed") {
        const indexResponse = await fetch(
          dataUrl("raw/supplemental-index.json"),
        );
        if (!indexResponse.ok) throw new Error(`HTTP ${indexResponse.status}`);
        const index = await indexResponse.json();
        if (!Array.isArray(index.competitions) || !index.meta)
          throw new Error("Format de données invalide");
        const competitions = new Array(index.competitions.length);
        let cursor = 0;
        await Promise.all(
          Array.from({ length: Math.min(4, competitions.length) }, async () => {
            while (cursor < competitions.length) {
              const position = cursor++,
                { tables, ...item } = index.competitions[position];
              for (const [kind, ref] of Object.entries(tables || {})) {
                const response = await fetch(dataUrl(ref.path));
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                if (typeof DecompressionStream === "undefined")
                  throw new Error(
                    "Ce navigateur ne peut pas décompresser les données.",
                  );
                item[kind] = await new Response(
                  response.body.pipeThrough(new DecompressionStream("gzip")),
                ).json();
              }
              competitions[position] = item;
            }
          }),
        );
        this.supplementalData = { meta: index.meta, competitions };
        this.supplementalLoading = false;
        this.redraw();
        return;
      }
      const response = await fetch(apiUrl("/api/supplemental"));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = await response.json();
      if (!Array.isArray(value.competitions) || !value.meta)
        throw new Error("Format de données invalide");
      this.supplementalData = value;
    } catch (error) {
      this.supplementalError = error.message;
    }
    this.supplementalLoading = false;
    this.redraw();
  }
  resourceKey(kind, subject, ...parameters) {
    return matchResourceKey(this.manifest, kind, subject, ...parameters);
  }
  async loadShard(id, { signal, force = false } = {}) {
    return readMatchResource(
      this.fetcher || fetch,
      this.resourceKey("archive", id),
      async ({ signal: sharedSignal }) => {
        const response = await fetch(
          apiUrl("/api/archive/matches/" + encodeURIComponent(id)),
          { signal: sharedSignal },
        );
        if (response.ok) return normalizeArchive(await response.json());
        if ([404, 405, 501].includes(response.status)) return null;
        const error = new Error(
          `Données indisponibles (HTTP ${response.status})`,
        );
        error.status = response.status;
        throw error;
      },
      { signal, force },
    );
  }
  async endpointResponse(match, section, { signal, force = false } = {}) {
    await this.statusPromise;
    signal?.throwIfAborted();
    let apiError;
    if (matchReadSource(this.manifest, this.configured) === "native") {
      try {
        const payload = await this.request(
          `matches/${match.id}${section === "match" ? "" : `/${section}`}`,
          { signal },
        );
        signal?.throwIfAborted();
        return { data: payload.data, source: "api" };
      } catch (error) {
        // A connectivity check is not evidence that an advertised native
        // backend is legacy. Only an explicitly absent endpoint permits this.
        if (
          this.pro ||
          ![404, 405, 501].includes(error.status) ||
          signal?.aborted
        )
          throw error;
        apiError = error;
      }
    }
    const shard = await this.loadShard(match.id, { signal, force });
    signal?.throwIfAborted();
    if (shard?.[section] && Object.hasOwn(shard[section], "data"))
      return {
        data: shard[section].data,
        source: "snapshot",
        warning: apiError?.message,
      };
    const error = new Error(
      apiError?.message ||
        (matchReadSource(this.manifest, this.configured) === "native"
          ? "Ces données ne sont pas disponibles pour ce match."
          : "Ces données ne figurent pas dans l’instantané. Elles se chargeront dès que la connexion aux données sera active."),
    );
    error.code = apiError?.code || "NOT_COLLECTED";
    throw error;
  }
  async ensureEndpoint(match, section, force = false, { signal } = {}) {
    signal?.throwIfAborted();
    validateMatchPublication(this.manifest, match);
    const key = `${match.id}:${section}`;
    const responseKey = this.resourceKey(
      "family",
      match,
      section,
      matchReadSource(this.manifest, this.configured),
    );
    if (
      this.payloads.has(key) &&
      this.payloads.get(key).error &&
      this.payloadKeys.get(key) === responseKey &&
      !force
    )
      return this.payloads.get(key);
    // Different widgets can need the same family, or different families from
    // one legacy archive. Only the last reader leaving may cancel shared work.
    return this.endpointReads.read(
      responseKey,
      async ({ signal: sharedSignal }) => {
        const previous = this.payloads.get(key);
        const previousKey = this.payloadKeys.get(key);
        const pending = { loading: true };
        const restore = () => {
          if (this.payloads.get(key) !== pending) return;
          if (previous && !previous.loading) {
            this.payloads.set(key, previous);
            this.payloadKeys.set(key, previousKey);
          } else {
            this.payloads.delete(key);
            this.payloadKeys.delete(key);
          }
        };
        this.payloads.set(key, pending);
        this.payloadKeys.set(key, responseKey);
        sharedSignal.addEventListener("abort", restore, { once: true });
        try {
          sharedSignal.throwIfAborted();
          const entry = await readMatchResource(
            this.fetcher || fetch,
            responseKey,
            ({ signal: responseSignal }) =>
              this.endpointResponse(match, section, {
                signal: responseSignal,
                force,
              }),
            { signal: sharedSignal, force },
          );
          sharedSignal.throwIfAborted();
          // The requesting client must receive its own payload entry even
          // when another route/client populated the shared response cache.
          if (this.payloads.get(key) === pending) this.payloads.set(key, entry);
          this.redraw();
          return entry;
        } catch (error) {
          if (sharedSignal.aborted || error?.name === "AbortError") {
            restore();
            throw sharedSignal.reason || error;
          }
          const entry = { error: error.message, code: error.code };
          if (this.payloads.get(key) === pending) this.payloads.set(key, entry);
          this.redraw();
          return entry;
        } finally {
          sharedSignal.removeEventListener("abort", restore);
        }
      },
      { signal, age: 0 },
    );
  }
  normalizedRemote(match) {
    return {
      id: match.id,
      leagueId: match.league?.id || match.leagueId,
      league:
        typeof match.league === "string" ? match.league : match.league?.name,
      season: match.season,
      home: {
        ...match.home_team,
        imageUrl: match.home_team?.image_url,
        score: match.score_home,
      },
      away: {
        ...match.away_team,
        imageUrl: match.away_team?.image_url,
        score: match.score_away,
      },
      date: match.date,
      timeUtc: match.time_utc,
      status: match.status,
      coverage: {},
      shots: [],
      stats: [],
      warnings: [],
    };
  }
}

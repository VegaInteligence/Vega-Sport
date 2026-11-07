import { publicApiFetch } from "./public-api-fetch.js";
import { FootballDataClient } from "./football-client.js";
import { ProMatchClient } from "./pro-match-data.js";
import { apiUrl } from "../data-url.js";

/** Match views use published SQL representations, with no document fallback. */
export class ProFootballDataClient extends FootballDataClient {
  constructor({ data, manifest, leagueId, season, fetcher = fetch, redraw }) {
    super({ data, manifest, redraw });
    this.fetcher = fetcher;
    this.matchEditions = new Map();
    this.pro = true;
    this.manifest = manifest;
    this.leagueId = leagueId;
    this.season = season;
    this.id = JSON.stringify([
      "orion-pro",
      season,
      manifest.editions.map((e) => e.representationToken).sort(),
    ]);
    this.configured = true;
    this.statusKnown = true;
  }

  edition(leagueId = this.leagueId, season = this.season) {
    const editions = this.manifest.editions.filter(
      (e) =>
        e.season === season &&
        (!leagueId || leagueId === "all" || e.leagueId === leagueId),
    );
    if (editions.length !== 1) throw new Error("Choisissez une compétition.");
    return new ProMatchClient({
      manifest: this.manifest,
      leagueId: editions[0].leagueId,
      season,
      fetcher: this.fetcher,
    });
  }

  async init() {
    return this.checkStatus();
  }
  async checkStatus() {
    this.statusKnown = true;
  }
  matchEdition(id) {
    const match = this.data.matches?.find((item) => item.id === id) ||
      this.fixtureIndex.get(id) || this.matchEditions.get(id);
    const league = match?.leagueId || match?.league?.id || this.leagueId;
    const season = match?.season || this.season;
    const editions = this.manifest.editions.filter((item) =>
      item.season === season && (!league || league === "all" || item.leagueId === league));
    return editions.length === 1 ? editions[0] : null;
  }

  async read(path, { signal } = {}) {
    const response = await publicApiFetch(apiUrl(path), { headers: { Accept: "application/json" }, signal }, this.fetcher);
    let body;
    try { body = await response.json(); }
    catch (error) {
      signal?.throwIfAborted();
      if (error?.name === "AbortError") throw error;
      throw new Error("La réponse du service est illisible.");
    }
    if (!response.ok || body.error) {
      const error = new Error(body.error?.message || "Données indisponibles.");
      Object.assign(error, { status: response.status, code: body.error?.code, state: body.error?.state });
      throw error;
    }
    return body;
  }

  async summary(id, options = {}) {
    if (!/^m_[A-Za-z0-9]{6}$/.test(id)) throw new Error("Identifiant de match invalide.");
    const edition = this.matchEdition(id);
    const body = await this.read(`/api/matches/${id}/summary${edition ? `?v=${edition.representationToken}` : ""}`, options);
    const { match, representationToken } = body.data || {};
    if (match?.id !== id || !this.manifest.editions.some((item) => item.representationToken === representationToken))
      throw new Error("La version du match a changé. Actualisez les données.");
    this.matchEditions.set(id, match);
    return { ...match, representationToken };
  }

  async request(path, options = {}) {
    if (typeof path !== "string" || !/^(leagues|teams|players|matches)(?:\/|$|\?)/.test(path))
      throw new Error("Ressource invalide.");
    const url = new URL(apiUrl("/api/pitchapi/" + path), "https://statarena.invalid");
    const id = /^matches\/(m_[A-Za-z0-9]{6})(?:[/?]|$)/.exec(path)?.[1];
    const edition = this.matchEdition(id);
    if (edition) url.searchParams.set("v", edition.representationToken);
    return this.read(url.pathname + url.search, options);
  }

  async ensureEndpoint(match, section, force = false, options = {}) {
    this.matchEditions.set(match.id, match);
    return super.ensureEndpoint(match, section, force, options);
  }

  // Native endpoints own each detail; no raw object archive is used by the site.
  async loadShard() { return null; }

  async loadFixtures() {
    const { browseMode, day, competitionId, season } = this;
    const key = browseMode === "day" ? `date:${day}` : `${competitionId}:${season}`;
    if (this.fixtures.has(key)) return;
    this.fixtures.set(key, { loading: true });
    try {
      const editions = this.manifest.editions.filter((item) =>
        item.season === (season || this.season) && (browseMode === "day" || item.leagueId === competitionId));
      const matches = [];
      for (const edition of editions) {
        const client = this.edition(edition.leagueId, edition.season), seen = new Set();
        let cursor;
        do {
          const page = await client.page({ limit: 100, status: "all", ...(cursor ? { cursor } : {}),
            ...(browseMode === "day" ? { from: day, to: day } : {}) });
          for (const match of page.data.matches) {
            const fixture = { ...match, league: { id: edition.leagueId, name: match.league }, season: edition.season,
              home_team: { ...match.home, image_url: match.home?.imageUrl },
              away_team: { ...match.away, image_url: match.away?.imageUrl },
              score_home: match.home?.score, score_away: match.away?.score, time_utc: match.timeUtc };
            matches.push(fixture); this.fixtureIndex.set(match.id, fixture);
          }
          cursor = page.pagination.nextCursor;
          if (cursor && seen.has(cursor)) throw new Error("Curseur de données invalide.");
          if (cursor) seen.add(cursor);
        } while (cursor);
      }
      this.fixtures.set(key, { matches, source: "api" });
    } catch (error) {
      this.fixtures.set(key, { matches: [], source: "api", error: error.message });
    }
    this.redraw();
  }
}

import { normalizeArchive } from "./format.js";
import { apiUrl } from "../data-url.js";
import { completeFixtures } from "./fixture-pages.js";
import { cupWorkerSnapshot } from "./cup-worker-client.js";
import { SAUDI_PRO_LEAGUE, reconcileSaudiFixtures } from "./saudi-fixtures.js";
/** Data access only: no view builders, document selectors or event delegation. */
let clientSequence = 0;
export class FootballDataClient {
  constructor({ data, redraw = () => {} }) {
    this.id = ++clientSequence;
    Object.assign(this, { data, redraw });
    this.catalog = data.competitions;
    this.configured = false;
    this.statusKnown = false;
    this.statusPromise = Promise.resolve();
    this.fixtures = new Map();
    this.fixtureIndex = new Map();
    this.payloads = new Map();
    this.shards = new Map();
    this.day = data.meta.endDate;
    this.browseMode = "catalog";
  }
  async checkStatus() {
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
  async request(path) {
    const response = await fetch(apiUrl(`/api/pitchapi/${path}`), {
      headers: { Accept: "application/json" },
    });
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(
        "La connexion aux données est momentanément indisponible.",
      );
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
  async loadFixtures() {
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
        const saved = await cupWorkerSnapshot("native", competitionId, season);
        result = {
          matches: saved.matches,
          rounds: saved.rounds || {},
          source: "snapshot",
        };
      } catch {
        /* Older editions can still use the provider or local archive. */
      }
    }
    if (!result) {
      try {
        if (!this.configured)
          throw new Error("Les données en direct ne sont pas disponibles.");
        const matches = await completeFixtures(
          browseMode === "day" ? { day } : { league: league.id, season },
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
  async loadShard(id) {
    if (!this.shards.has(id))
      this.shards.set(
        id,
        (async () => {
          const response = await fetch(
            apiUrl("/api/archive/matches/" + encodeURIComponent(id)),
          );
          if (response.ok) return normalizeArchive(await response.json());
          return null;
        })().catch(() => {
          this.shards.delete(id);
          return null;
        }),
      );
    return await this.shards.get(id);
  }
  async ensureEndpoint(match, section, force = false) {
    const key = `${match.id}:${section}`;
    if (this.payloads.has(key) && !force) return;
    this.payloads.set(key, { loading: true });
    if (force) this.shards.delete(match.id);
    await this.statusPromise;
    let apiError;
    if (this.configured) {
      try {
        const payload = await this.request(
          `matches/${match.id}${section === "match" ? "" : `/${section}`}`,
        );
        this.payloads.set(key, { data: payload.data, source: "api" });
        this.redraw();
        return;
      } catch (error) {
        apiError = error;
      }
    }
    if (
      apiError &&
      [400, 403, 404, 410, 413, 422, 429].includes(apiError.status)
    ) {
      this.payloads.set(key, { error: apiError.message, code: apiError.code });
      this.redraw();
      return;
    }
    const shard = await this.loadShard(match.id);
    if (shard?.[section] && Object.hasOwn(shard[section], "data"))
      this.payloads.set(key, {
        data: shard[section].data,
        source: "snapshot",
        warning: apiError?.message,
      });
    else
      this.payloads.set(key, {
        error:
          apiError?.message ||
          (this.configured
            ? "Ces données ne sont pas disponibles pour ce match."
            : "Ces données ne figurent pas dans l’instantané. Elles se chargeront dès que la connexion aux données sera active."),
        code: apiError?.code || "NOT_COLLECTED",
      });
    this.redraw();
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

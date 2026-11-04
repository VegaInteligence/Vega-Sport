import { FootballDataClient } from "./football-client.js";
import { ProMatchClient } from "./pro-match-data.js";

const unavailable = () =>
  Object.assign(
    new Error("Ces données ne sont pas disponibles pour ce match."),
    { code: "NOT_COLLECTED", status: 404 },
  );

/** Match views use published SQL representations, with no document fallback. */
export class ProFootballDataClient extends FootballDataClient {
  constructor({ data, manifest, leagueId, season }) {
    super({ data });
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
    });
  }

  async init() {
    return this.checkStatus();
  }
  async checkStatus() {
    this.statusKnown = true;
  }
  async summary(id) {
    return this.edition().summary(id);
  }
  async request() {
    throw unavailable();
  }
  async ensureEndpoint() {
    throw unavailable();
  }
  async loadShard() {
    throw unavailable();
  }
  async loadFixtures() {
    throw unavailable();
  }
  async loadSupplemental() {
    throw unavailable();
  }
}

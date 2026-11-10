/**
 * /api/health, /api/status and /api/dashboard/manifest in the legacy shapes
 * (aws-app.js and relational-core.js on main), read from api.publication,
 * api.editions, api.competitions and api.team_countries.
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const tag = (req, version) =>
  'W/"core-v3-' + digest(new URL(req.url).pathname + new URL(req.url).search + "|" + version) + '"';
const manifestTag = (req, version) => tag(req, `manifest-v5|v2|${version}`);
const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);
const day = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value ?? null);

/** A season edition's counts, and the digest the manifest names its partition by. */
export const editionCounts = (p) => ({
  matchCount: Number(p.match_count),
  expectedFinishedMatches: Number(p.finished_count),
  collectedMatches: Number(p.collected_count),
  teamCount: Number(p.team_count),
});
export const editionDigest = (p) => digest(JSON.stringify([p.season, p.league_id, iso(p.retrieved_at), editionCounts(p)]));

/** The compact reads this API serves; the others stay on the current API until ported. */
export const COMPACT_READS = { home: true, players: true, clubs: true, player: true, club: true, performance: true, discipline: true, presence: true };

/** The latest season already started: a calendar published ahead (a league's next
 * calendar year) is not the default. */
export function defaultSeason(seasons, today) {
  const ids = [...seasons.keys()];
  return ids.find((id) => seasons.get(id).chunks.some((c) => c.meta.startDate && c.meta.startDate <= today)) ?? ids[0] ?? null;
}

export function createSystemRoute(read) {
  return async (req, path, params) => {
    if (path === "/api/health") {
      validateParams(params, []);
      const [r] = await read(
        "SELECT generation::text AS revision, EXISTS(SELECT 1 FROM api.editions) AS ready FROM api.publication",
      );
      return send(req, { source: "AWS", status: r?.ready ? "ok" : "pending", revision: r?.revision ?? null }, r?.ready ? 200 : 503);
    }
    if (path === "/api/status") {
      validateParams(params, []);
      return send(req, { source: "AWS", configured: true, basePath: "/api/matches", schema: "v2" });
    }
    if (path !== "/api/dashboard/manifest") return null;
    validateParams(params, ["v"]);
    const [state] = await read("SELECT generation::text AS version, published_at FROM api.publication");
    if (!state) reject(503, "Publication indisponible.");
    const etag = manifestTag(req, state.version);
    if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag))
      return send(req, null, 200, { etag, ttl: 15 });
    const [editions, competitions, countries] = await Promise.all([
      read(`SELECT season, league_id, start_date, end_date, match_count, finished_count, collected_count, team_count, retrieved_at
            FROM api.editions ORDER BY season DESC, league_id`),
      read("SELECT id, name, country, image_url, seasons FROM api.competitions ORDER BY name, id"),
      read("SELECT team_id, country FROM api.team_countries"),
    ]);
    const catalog = competitions.map((c) => ({
      id: c.id,
      name: c.name,
      country: c.country,
      providerCountry: c.country,
      imageUrl: c.image_url,
      seasons: c.seasons || [],
    }));
    const byId = new Map(catalog.map((c) => [c.id, c]));
    const seasons = new Map();
    for (const p of editions) {
      if (!seasons.has(p.season)) seasons.set(p.season, { id: p.season, chunks: [] });
      const c = byId.get(p.league_id);
      const counts = editionCounts(p);
      seasons.get(p.season).chunks.push({
        leagueId: p.league_id,
        sourceDigest: editionDigest(p),
        meta: { ...counts, retrievedAt: iso(p.retrieved_at), startDate: day(p.start_date), endDate: day(p.end_date), publishedAt: iso(state.published_at) },
        competitions: c ? [{ ...c, sampleMatches: counts.matchCount, sampleSeasons: counts.matchCount ? [p.season] : [] }] : [],
      });
    }
    return send(
      req,
      {
        schemaVersion: 4,
        // What the site reads to choose its reads (dashboard/frontend: compact-reads.js,
        // season_data.js, actor-reads.js, global-search-client.js, season-version.js). Any
        // other storage makes it load whole seasons through /api/seasons/partition, the
        // home included: that is what "aws-relational-v2" did when the site was first
        // pointed at this API on 10 November 2026.
        storage: "aws-relational",
        capabilities: {
          boundedSearch: true, // /api/search
          fixturePaginationOrder: true, // /api/fixtures: order, cursor
          versionedPartitions: true, // /api/seasons/partition: v
          playerRatingRanking: true, // /api/read/players: ranking=rating
          actorSummary: true, // /api/read/player and /api/read/club: detail=summary
          // The site would add media=1 to every compact read; only /api/read/clubs takes it.
          resolvedMedia: false,
          boundedArchive: true,
          compactReads: COMPACT_READS,
        },
        defaultSeason: defaultSeason(seasons, new Date().toISOString().slice(0, 10)),
        retrievedAt: iso(state.published_at),
        publishedAt: iso(state.published_at),
        publicationVersion: state.version,
        seasons: [...seasons.values()],
        competitions: catalog,
        clubCountries: Object.fromEntries(countries.map((r) => [r.team_id, r.country])),
        scouting: { version: 2, sourceDigest: state.version },
      },
      200,
      { etag, ttl: 15 },
    );
  };
}

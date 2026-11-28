/**
 * /api/health, /api/status and /api/dashboard/manifest in the legacy shapes
 * (aws-app.js and relational-core.js on main), read from api.publication,
 * api.editions, api.competitions and api.team_countries (the manifest in one statement,
 * GH141; its HEAD and revalidations from the publication alone first).
 */
import { createHash } from "node:crypto";
import { timestamp } from "../db.mjs";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";

const CONSTANT_HEADERS = {
  "Cache-Control": "public, max-age=3600, s-maxage=3600",
  "CDN-Cache-Control": "public, s-maxage=3600",
  "Vercel-CDN-Cache-Control": "public, s-maxage=3600",
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const tag = (req, version) =>
  'W/"core-v3-' + digest(new URL(req.url).pathname + new URL(req.url).search + "|" + version) + '"';

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);
const day = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value ?? null);

/** A season edition's counts, and the digest the manifest names its partition by. */
export const editionCounts = (p) => ({
  matchCount: Number(p.match_count),
  expectedFinishedMatches: Number(p.finished_count),
  collectedMatches: Number(p.collected_count),
  teamCount: Number(p.team_count),
});
/** What changes when an edition does: the manifest gives it, the partition reads send it
 * back as `v`. 16 hexadecimal characters (it was the 64 of the whole hash: 304 of them
 * were a quarter of the manifest once compressed, on 11 November 2026). */
export const editionDigest = (p) => digest(JSON.stringify([p.season, p.league_id, iso(p.retrieved_at), editionCounts(p)])).slice(0, 16);

/** The compact reads this API serves; the others stay on the current API until ported. */
export const COMPACT_READS = { home: true, "home-local": true, players: true, clubs: true, player: true, club: true, league: true, performance: true, discipline: true, presence: true };

/** What the site reads to choose its reads (dashboard/frontend: compact-reads.js,
 * season_data.js, actor-reads.js, global-search-client.js, season-version.js,
 * club-scout.js). */
export const CAPABILITIES = {
  boundedSearch: true, // /api/search
  fixturePaginationOrder: true, // /api/fixtures: order, cursor
  seasonFixtures: true, // /api/fixtures/season: a competition's season in one read (GH129)
  matchFamilyRoutes: true, // every match family has its route, a 404 is the family's absence; no /api/archive/matches (GH129-g)
  versionedPartitions: true, // /api/seasons/partition: v
  playerGradeRanking: true, // /api/read/players: ranking=grade
  actorSummary: true, // /api/read/player and /api/read/club: detail=summary
  wholeSelection: true, // /api/read/players: whole=1
  roleGroups: true, // /api/read/players: group
  playerProfiles: true, // /api/read/players: detail=profile, v
  marketValues: true, // /api/player-market-values
  // The reads validated by their own version when they name no publication (v).
  // /api/read/league, /api/read/club, /api/read/player, /api/clubs/europe/matches
  versionedReads: { league: true, club: true, player: true, europeMatches: true },
  playedLeague: true, // /api/read/league: played=1
  // Off: the site addresses a provider image's copy itself (resolved-media.js), and
  // with this on it adds media=1 to every compact read, a query each (media.mjs).
  resolvedMedia: false,
  boundedArchive: true,
  compactReads: COMPACT_READS,
};
const SCHEMA_VERSION = 5;
/**
 * What this code puts around a publication in the manifest; its validator names both. A
 * deploy that added a capability kept the validator of the manifest before it: until the
 * next publication, the distribution and the browsers were told theirs was still good
 * (five minutes without the new reads on 11 November 2026).
 */
export const manifestShape = (schemaVersion, capabilities) => digest(JSON.stringify([schemaVersion, capabilities])).slice(0, 12);
const manifestTag = (req, version) => tag(req, `manifest|${manifestShape(SCHEMA_VERSION, CAPABILITIES)}|${version}`);

const PUBLICATION_SQL = "SELECT generation::text AS version, published_at FROM api.publication";
/** The manifest's publication and its three lists in one statement, so one snapshot: the
 * lists are those of the publication they are served with (GH141). Each edition is the row
 * the editions statement gave, its watermark as its text (parsed by the reader's own
 * timestamp parser below: the typed column's Date) and its dates as their text. */
const MANIFEST_SQL = `SELECT p.generation::text AS version, p.published_at,
  (SELECT coalesce(json_agg(json_build_object('season',e.season,'league_id',e.league_id,'start_date',e.start_date::text,
     'end_date',e.end_date::text,'match_count',e.match_count,'finished_count',e.finished_count,'collected_count',e.collected_count,
     'team_count',e.team_count,'retrieved_at',e.retrieved_at::text) ORDER BY e.season DESC,e.league_id),'[]'::json)
   FROM api.editions e) AS editions,
  (SELECT coalesce(json_agg(json_build_object('id',c.id,'name',c.name,'country',c.country,'image_url',c.image_url,'seasons',c.seasons)
     ORDER BY c.name,c.id),'[]'::json) FROM api.competitions c) AS competitions,
  (SELECT coalesce(json_agg(json_build_array(t.team_id,t.country)),'[]'::json) FROM api.team_countries t) AS countries
  FROM api.publication p`;

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
      // The package it runs (api.yaml: VEGA_RELEASE, releases/v2-api/<sha256>.zip): the end of a Deploy checks the
      // distribution serves the one it uploaded (infra/aws/verify-deploy.mjs, GH202); null outside a package.
      const release = /^releases\/v2-api\/([a-f0-9]{64})\.zip$/.exec(process.env.VEGA_RELEASE || "")?.[1] ?? null;
      return send(req, { source: "AWS", status: r?.ready ? "ok" : "pending", revision: r?.revision ?? null, release }, r?.ready ? 200 : 503);
    }
    if (path === "/api/status") {
      validateParams(params, []);
      // The same answer until the next deploy, asked by every page: the browser keeps it
      // an hour (it was never kept, a call to the function for each page).
      return send(req, { source: "AWS", configured: true, basePath: "/api/matches", schema: "v2" }, 200, { headers: CONSTANT_HEADERS });
    }
    if (path !== "/api/dashboard/manifest") return null;
    validateParams(params, ["v"]);
    // A HEAD, or a request holding a tag, asks the publication alone first: unchanged, that
    // one statement answers it.
    if (req.method === "HEAD" || req.headers.get("if-none-match")) {
      const [state] = await read(PUBLICATION_SQL);
      if (!state) reject(503, "Publication indisponible.");
      const etag = manifestTag(req, state.version);
      if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag))
        return send(req, null, 200, { etag, ttl: 15 });
    }
    const [state] = await read(MANIFEST_SQL);
    if (!state) reject(503, "Publication indisponible.");
    // The tag of the publication the lists were read with, which may be newer than the
    // one checked above.
    const etag = manifestTag(req, state.version);
    const editions = state.editions.map((p) => ({ ...p, retrieved_at: timestamp(p.retrieved_at) }));
    const catalog = state.competitions.map((c) => ({
      id: c.id,
      name: c.name,
      country: c.country,
      providerCountry: c.country,
      imageUrl: c.image_url,
      seasons: c.seasons || [],
    }));
    // A league's entry of a season says what is its own. Until schema 5 it also repeated
    // its competition as the catalogue below gives it, and the publication's date: half of
    // the manifest, on every page. The site puts them back (services/manifest-shape.js).
    const seasons = new Map();
    for (const p of editions) {
      if (!seasons.has(p.season)) seasons.set(p.season, { id: p.season, chunks: [] });
      seasons.get(p.season).chunks.push({
        leagueId: p.league_id,
        sourceDigest: editionDigest(p),
        meta: { ...editionCounts(p), retrievedAt: iso(p.retrieved_at), startDate: day(p.start_date), endDate: day(p.end_date) },
      });
    }
    return send(
      req,
      {
        schemaVersion: SCHEMA_VERSION,
        // What the site reads to choose its reads (dashboard/frontend: compact-reads.js,
        // season_data.js, actor-reads.js, global-search-client.js, season-version.js). Any
        // other storage makes it load whole seasons through /api/seasons/partition, the
        // home included: that is what "aws-relational-v2" did when the site was first
        // pointed at this API on 10 November 2026.
        storage: "aws-relational",
        capabilities: CAPABILITIES,
        defaultSeason: defaultSeason(seasons, new Date().toISOString().slice(0, 10)),
        retrievedAt: iso(state.published_at),
        publishedAt: iso(state.published_at),
        publicationVersion: state.version,
        seasons: [...seasons.values()],
        competitions: catalog,
        clubCountries: Object.fromEntries(state.countries),
        scouting: { version: 2, sourceDigest: state.version },
      },
      200,
      { etag, ttl: 15 },
    );
  };
}

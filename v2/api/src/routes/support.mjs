/**
 * Support reads of main (aws-app.js `support`, relational-support.js): /api/club-wikidata,
 * /api/coach-portrait and /api/stadium, same parameters and bodies, read from
 * api.club_facts, api.coach_portraits, api.stadiums and api.stadium_plans (027), which
 * vega_v2/sources/wikidata.py fills with main's own Wikidata and Commons readers.
 *
 * Differences with the legacy read: a club found by name and country is the v2 club of
 * that exact name and country (legacy: main's Wikidata name search); a coach's photo may
 * come from the portrait search as well as from Wikidata.
 */
import { createHash } from "node:crypto";
import { cacheHeaders, matchesEtag, reject, send, validateParams } from "../http.mjs";
import { cloudFrontObjectUrl, immutableFile } from "../media.mjs";
import { MESSI_ID, mergeMessiHonours } from "../../../../dashboard/scripts/materialize_curated.mjs";
import { projectionGroups } from "../../../../dashboard/shared/honour-display.js";

const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
const SPEC = {
  "club-wikidata": { uefa: /^\d{1,12}$/, name: /^[^\u0000-\u001f\u007f]{1,200}$/, country: /^[^\u0000-\u001f\u007f]{1,200}$/ },
  "coach-portrait": { name: /^[^\u0000-\u001f\u007f]{1,200}$/ },
  stadium: { id: /^Q\d{1,16}$/ },
  "player-honours": { id: /^p_[A-Za-z0-9]{6}$/ },
};

function validate(p, spec) {
  validateParams(p, Object.keys(spec));
  for (const [k, v] of p) if (!spec[k].test(v)) reject(400, "Paramètre invalide.");
  return Object.fromEntries(p);
}
const missing = () => reject(404, "Donnée indisponible.");

function respond(req, body) {
  const etag = `W/"support-v1-${createHash("sha256").update(JSON.stringify(body)).digest("hex")}"`;
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl: 60 });
  return send(req, body, 200, { etag, ttl: 60 });
}

const photo = (url, author, license, sourceUrl) => (url ? { url, sourceUrl, author: author ?? "", license: license ?? "" } : null);

export function clubFacts(r) {
  return {
    sourceUrl: `https://www.wikidata.org/entity/${r.wikidata_id}`,
    fetchedAt: iso(r.fetched_at),
    stadium: r.stadium ?? null,
    stadiumId: r.stadium_id ?? null,
    stadiumAlias: r.stadium_alias ?? null,
    coach: r.coach ? { name: r.coach, photo: photo(r.coach_photo_url, r.coach_photo_author, r.coach_photo_license, r.coach_photo_source) } : null,
    founded: r.founded_year != null ? String(r.founded_year) : null,
  };
}

/** Player honours (main's player_honours.py projection); Messi's page shows main's curated list. */
export function honoursBody(r) {
  const body = {
    available: true,
    source: "Wikipédia",
    identitySourceUrl: `https://www.wikidata.org/wiki/${r.wikidata_id}`,
    sourceUrl: r.source_url,
    revision: r.revision != null ? Number(r.revision) : null,
    fetchedAt: iso(r.fetched_at),
    honours: r.honours,
  };
  if (r.public_id === MESSI_ID) body.displayGroups = mergeMessiHonours(projectionGroups(body.honours));
  return body;
}

const IMAGE_TYPES = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

export function createSupportRoute(read, { mediaBase = null } = {}) {
  return async (req, path, params) => {
    if (path === "/api/player-honours") {
      const p = validate(params, SPEC["player-honours"]);
      if (!p.id) reject(400, "Paramètre manquant.");
      const [r] = await read("SELECT * FROM api.player_honours WHERE public_id=$1", [p.id]);
      if (!r) missing();
      return respond(req, honoursBody(r));
    }
    if (path === "/api/assets") {
      // An image URL of a response -> its copy behind CloudFront (main: the same 307).
      validateParams(params, ["url"]);
      const src = params.get("url");
      if (!src || src.length > 2048) reject(400, "URL manquante.");
      const [row] = await read("SELECT s3_key AS path,content_type FROM api.media_assets WHERE source_url=$1", [src]);
      const type = row && IMAGE_TYPES[String(row.path).split(".").at(-1).toLowerCase()];
      if (!row || !mediaBase || !immutableFile(row.path) || type !== row.content_type) missing();
      return new Response(null, { status: 307, headers: { Location: cloudFrontObjectUrl(row.path, mediaBase), ...cacheHeaders(60, 0) } });
    }
    if (path === "/api/club-wikidata") {
      const p = validate(params, SPEC["club-wikidata"]);
      let rows;
      if (p.uefa) rows = await read("SELECT * FROM api.club_facts WHERE uefa_id=$1", [p.uefa]);
      else if (p.name && p.country)
        rows = await read("SELECT * FROM api.club_facts WHERE lower(name)=lower($1) AND country_code=$2", [p.name, p.country]);
      else reject(400, "Paramètre manquant.");
      if (rows.length !== 1) missing(); // unknown, or a name that designates several clubs
      return respond(req, clubFacts(rows[0]));
    }
    if (path === "/api/coach-portrait") {
      const p = validate(params, SPEC["coach-portrait"]);
      if (!p.name) reject(400, "Paramètre manquant.");
      const rows = await read("SELECT * FROM api.coach_portraits WHERE lowered=lower($1) ORDER BY photo_url IS NULL, name LIMIT 1", [p.name]);
      if (!rows.length) missing();
      const r = rows[0];
      return respond(req, { name: r.name, lookupVersion: r.lookup_version, photo: photo(r.photo_url, r.author, r.license, r.source_page_url) });
    }
    if (path === "/api/stadium") {
      const p = validate(params, SPEC.stadium);
      if (!p.id) reject(400, "Paramètre manquant.");
      const [s] = await read("SELECT * FROM api.stadiums WHERE id=$1", [p.id]);
      if (!s) missing();
      const plans = await read("SELECT * FROM api.stadium_plans WHERE venue_id=$1 ORDER BY seq", [s.venue_id]);
      return respond(req, {
        id: s.id,
        sourceUrl: `https://www.wikidata.org/wiki/${s.id}`,
        fetchedAt: iso(s.fetched_at),
        capacity: s.capacity ?? null,
        capacityAsOf: s.capacity_observed ?? null,
        opened: s.opened ?? null,
        created: s.created ?? null,
        coordinates: s.latitude != null && s.longitude != null ? { lat: s.latitude, lon: s.longitude } : null,
        plans: plans.map((plan) => ({
          title: plan.title,
          ...(plan.source != null && { source: plan.source }),
          ...(plan.detail != null && { detail: plan.detail }),
          ...(plan.url != null && { url: plan.url }),
          ...(plan.image_url != null && { imageUrl: plan.image_url }),
          ...(plan.is_embedded && { embedded: true }),
          ...(plan.allow_geolocation && { allowGeolocation: true }),
          ...(plan.format != null && { format: plan.format }),
        })),
      });
    }
    return null;
  };
}

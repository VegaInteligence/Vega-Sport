import { createHash } from "node:crypto";
import { query, configured, cache } from "./services/postgres.js";
import { instrumentRequest } from "./services/metrics.js";
import { matchesEtag, cacheHeaders } from "./services/cache-policy.js";
import {
  relationalResource,
  relationalMatchObservation,
} from "./services/relational-match.js";
import { getSupporting } from "./services/relational-support.js";
import { getCatalog, getProfile } from "./services/relational-catalog.js";
import { cloudFrontObjectUrl, immutableFile } from "./services/cdn.js";
import { orionProRoute } from "./services/orion-pro.js";
import { orionProMatchDetailRoute } from "./services/orion-pro-match-details.js";
import { orionProEntityRoute } from "./services/orion-pro-entities.js";
import { orionProOperationalRoute } from "./services/orion-pro-operations.js";
import { orionProAppearanceRoute } from "./services/orion-pro-appearances.js";
import { orionProFixtureAliasRoute } from "./services/orion-pro-fixture-aliases.js";
import { orionProCompetitionRoute } from "./services/orion-pro-competitions.js";
import { orionProArchiveRoute } from "./services/orion-pro-archives.js";
import {
  manifest,
  partitionPage,
  fixturePage,
  summary,
  scouting,
  send,
  reject,
  validateParams,
} from "./services/relational-core.js";

const year = /^\d{4}(?:\/\d{4})?$/,
  player = /^p_[A-Za-z0-9]{6}$/,
  team = /^t_[A-Za-z0-9]{6}$/,
  league = /^l_[A-Za-z0-9]{6}$/,
  key = /^[\w:-]{1,100}$/,
  text = /^[^\u0000-\u001f\u007f]{1,200}$/;
const support = {
  standings: { competition: league, season: year },
  "open-cups": { competition: key, season: year },
  openligadb: { competition: key, season: year },
  "nations-results": { season: year },
  "club-wikidata": { uefa: /^\d{1,12}$/, name: text, country: text },
  "coach-portrait": { name: text },
  stadium: { id: /^Q\d{1,16}$/ },
  "player-honours": { id: player },
};
const catalog = {
  "archives/index": { kind: /^(results|goals)$/ },
  "archives/season": { kind: /^(results|goals)$/, season: year },
  "rankings/index": {},
  "rankings/edition": {
    kind: /^(uefa-clubs|uefa-associations|fifa-men)$/,
    edition: /^(?:\d{4}\.uefa|\d{4}-\d{2}-\d{2}\.(?:fifa|sportsapi))$/,
  },
  "rankings/associations": { year: /^\d{4}$/ },
  "rankings/club": { club: team },
  "club-links": { club: team },
  "cup-index": { kind: /^(worker|supplemental)$/ },
  "cup-table": { competition: key, season: year, kind: /^(results|fixtures)$/ },
  "cup-snapshot": {
    competition: key,
    season: year,
    kind: /^(native|standings|open-cups|openligadb|nations-results)$/,
  },
  matchdays: { competition: league, season: year },
  supplemental: {},
};
function validate(p, spec, required = false) {
  validateParams(p, Object.keys(spec));
  for (const [k, v] of p)
    if (!spec[k].test(v)) reject(400, "Paramètre invalide.");
  if (required && Object.keys(spec).some((k) => !p.has(k)))
    reject(400, "Paramètre manquant.");
  return Object.fromEntries(p);
}
const missing = () => reject(404, "Donnée indisponible.");
const contentTag = (body) =>
  'W/"value-v1-' +
  createHash("sha256").update(JSON.stringify(body)).digest("hex") +
  '"';
const assetAliases = cache(2 * 1024 * 1024, {
  name: "asset_alias",
  maxEntryBytes: 4096,
});
const shareFor = (record) =>
  (record.status ?? 200) === 200 &&
  record.ready !== false &&
  record.value?.available !== false
    ? 60
    : 0;
async function resolved(req, read, { pitch = false, maxBytes = 0 } = {}) {
  let metadata;
  if (req.method === "HEAD" || req.headers.get("if-none-match")) {
    const m = await read({ head: true, deferBody: req.method !== "HEAD" });
    metadata = m;
    if (!m) missing();
    const status = pitch ? (m.status ?? 200) : 200;
    if (
      req.method === "HEAD" ||
      (status === 200 &&
        m.etag &&
        matchesEtag(req.headers.get("if-none-match"), m.etag))
    )
      return send(req, null, status, { etag: m.etag, ttl: shareFor(m) });
  }
  const r = metadata?.readBody
    ? await metadata.readBody()
    : await read({ withMeta: true });
  if (r == null) missing();
  const body = r.value;
  if (!body) missing();
  let status = 200,
    out = body;
  if (pitch) {
    status = body.status ?? 200;
    out =
      status === 200
        ? { data: body.data }
        : {
            ok: false,
            error: body.error || {
              code: "RESOURCE_NOT_FOUND",
              message: "Donnée indisponible.",
            },
          };
  }
  return send(req, out, status, {
    etag: r.etag ?? contentTag(out),
    ttl: shareFor(r),
    maxBytes,
  });
}
async function pitch(req, path, p) {
  const resource = path.slice("/api/pitchapi".length);
  const date = resource.match(/^\/date\/(\d{4}-\d{2}-\d{2})$/),
    schedule = resource.match(/^\/leagues\/(l_[A-Za-z0-9]{6})\/matches$/);
  if (date || schedule) {
    validate(
      p,
      date
        ? { status: /^(all|upcoming|played)$/ }
        : { season: year, status: /^(all|upcoming|played)$/ },
    );
    const f = new URLSearchParams(p);
    if (date) {
      f.set("from", date[1]);
      f.set("to", date[1]);
    } else f.set("league", schedule[1]);
    return fixturePage(req, f, { legacy: true });
  }
  const profile = resource.match(
    /^\/(leagues|teams|players)(?:\/([ltp]_[A-Za-z0-9]{6}))?$/,
  );
  if (profile) {
    validate(p, {});
    const [, kind, id] = profile;
    if (
      (!id && kind !== "leagues") ||
      (id && !{ leagues: league, teams: team, players: player }[kind].test(id))
    )
      missing();
    return resolved(req, (o) => getProfile(kind, id, o), {
      pitch: true,
      maxBytes: 2 * 1024 * 1024,
    });
  }
  if (/^\/matches\/m_[A-Za-z0-9]{6}(?:\/|$)/.test(resource)) {
    const params = validate(
      p,
      resource.endsWith("/heatmaps")
        ? { frame: /^(acting_ltr|home_ltr)$/ }
        : {},
    );
    return resolved(req, (o) => relationalResource(resource, params, o), {
      pitch: true,
      maxBytes: 2 * 1024 * 1024,
    });
  }
  missing();
}
async function route(req) {
  if (!["GET", "HEAD"].includes(req.method))
    return send(req, { error: { code: "METHOD_NOT_ALLOWED" } }, 405, {
      headers: { Allow: "GET, HEAD" },
    });
  let url, path;
  try {
    url = new URL(req.url);
    path = decodeURIComponent(url.pathname);
  } catch {
    reject(400, "Chemin invalide.");
  }
  if (!path.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(path))
    reject(400, "Chemin invalide.");
  if (path.split("/").some((v) => v.startsWith(".")))
    reject(403, "Chemin interdit.");
  const p = url.searchParams;
  if (path.startsWith("/data/"))
    reject(410, "Cette route de données a été retirée.");
  if (!path.startsWith("/api/")) missing();
  const proMode = process.env.STATARENA_PRO_API === "1";
  if (proMode) {
    const operational = await orionProOperationalRoute(req, path, p, {
      mediaBase: process.env.STATARENA_CLOUDFRONT_URL,
    });
    if (operational) return operational;
    const pro = await orionProRoute(req, path, p);
    if (pro) return pro;
    const matchDetail = await orionProMatchDetailRoute(req, path, p);
    if (matchDetail) return matchDetail;
    const entity = await orionProEntityRoute(req, path, p, {
      mediaBase: process.env.STATARENA_CLOUDFRONT_URL,
    });
    if (entity) return entity;
    const appearance = await orionProAppearanceRoute(req, path, p, {
      mediaBase: process.env.STATARENA_CLOUDFRONT_URL,
    });
    if (appearance) return appearance;
    const fixtureAlias = await orionProFixtureAliasRoute(req, path, p);
    if (fixtureAlias) return fixtureAlias;
    const competition = await orionProCompetitionRoute(req, path, p, {
      mediaBase: process.env.STATARENA_CLOUDFRONT_URL,
    });
    if (competition) return competition;
    const archive = await orionProArchiveRoute(req, path, p);
    if (archive) return archive;
    if (!["/api/health", "/api/status", "/api/assets"].includes(path))
      return send(
        req,
        {
          ok: false,
          available: false,
          error: {
            code: "PRO_ROUTE_NOT_IMPLEMENTED",
            message: "Ces données ne sont pas encore disponibles en mode Pro.",
          },
        },
        501,
      );
  }
  const name = path.slice(5);
  if (name === "health") {
    validate(p, {});
    const [r] = await query(
      "SELECT generation::text AS revision, EXISTS(SELECT 1 FROM statarena_app.partitions) ready FROM statarena_app.publications WHERE singleton",
    );
    return send(
      req,
      {
        source: "AWS",
        status: r?.ready ? "ok" : "pending",
        revision: r?.revision ?? null,
      },
      r?.ready ? 200 : 503,
    );
  }
  if (name === "status") {
    validate(p, {});
    return send(req, {
      source: "AWS",
      configured: configured(),
      basePath: "/api/pitchapi",
    });
  }
  if (name === "settings") {
    validate(p, {});
    const rows = await query(
      "SELECT * FROM statarena_app.workflow_state ORDER BY workflow",
    );
    return send(req, {
      provider: "AWS",
      configured: configured(),
      schedule: {
        cron: "35 22 * * *",
        crons: ["35 22 * * *", "10 6 * * *"],
        timezone: "UTC",
        runner: "GitHub Actions",
      },
      sync: rows.map((r) => ({
        name: r.workflow,
        value: r,
        updated_at: r.updated_at,
      })),
      workflowUrl:
        "https://github.com/OrionQuantPlatform/STATARENA/actions/workflows/daily-sync.yml",
    });
  }
  if (name === "dashboard/manifest") {
    validate(p, {});
    return manifest(req);
  }
  if (name === "seasons/partition") return partitionPage(req, p);
  if (name === "fixtures") return fixturePage(req, p);
  if (name === "scouting/routes") return scouting(req, p);
  const summaryId = name.match(/^matches\/(m_[A-Za-z0-9]{6})\/summary$/);
  if (summaryId) {
    validate(p, {});
    return summary(req, summaryId[1]);
  }
  if (name === "assets") {
    validateParams(p, ["url"]);
    const src = p.get("url");
    if (!src || src.length > 2048) reject(400, "URL manquante.");
    const alias = await assetAliases(
      proMode ? `pro-image:${src}` : src,
      async () => {
        const [r] = await query(
          proMode
            ? "SELECT path,content_type FROM statarena_app.assets WHERE url=$1"
            : "SELECT path FROM statarena_app.assets WHERE url=$1",
          [src],
        );
        if (
          !r ||
          !immutableFile(r.path) ||
          !/\.(?:webp|png|jpe?g)$/i.test(r.path) ||
          (proMode &&
            r.content_type !==
              {
                webp: "image/webp",
                png: "image/png",
                jpg: "image/jpeg",
                jpeg: "image/jpeg",
              }[r.path.split(".").at(-1)])
        )
          missing();
        return {
          location: cloudFrontObjectUrl(
            r.path,
            process.env.STATARENA_CLOUDFRONT_URL,
          ),
          expires: Math.floor(Date.now() / 1000) + 60,
        };
      },
      60000,
    );
    const ttl = Math.max(0, alias.expires - Math.floor(Date.now() / 1000));
    return new Response(null, {
      status: 307,
      headers: { Location: alias.location, ...cacheHeaders(ttl, 0) },
    });
  }
  if (Object.hasOwn(support, name)) {
    const params = validate(p, support[name]);
    return resolved(req, (o) => getSupporting(name, params, o), {});
  }
  if (Object.hasOwn(catalog, name)) {
    const params = validate(p, catalog[name], true);
    return resolved(req, (o) => getCatalog(name, params, o));
  }
  const archive = name.match(/^archive\/matches\/(m_[A-Za-z0-9]{6})$/);
  if (archive) {
    validate(p, {});
    return resolved(req, (o) => relationalMatchObservation(archive[1], o), {});
  }
  const profile = name.match(
    /^archive\/profiles\/(leagues|teams|players)\/([ltp]_[A-Za-z0-9]{6})$/,
  );
  if (
    profile &&
    { leagues: league, teams: team, players: player }[profile[1]].test(
      profile[2],
    )
  ) {
    validate(p, {});
    return resolved(req, (o) => getProfile(profile[1], profile[2], o));
  }
  if (name.startsWith("pitchapi/")) return pitch(req, path, p);
  missing();
}
export function handleRequest(req) {
  return instrumentRequest(req, async () => {
    try {
      return await route(req);
    } catch (error) {
      const status =
        error.status >= 400 && error.status <= 599 ? error.status : 503;
      if (status === 503)
        console.error("AWS serving query failed", error.code || error.name);
      return send(
        req,
        {
          ok: false,
          available: false,
          error: {
            code:
              {
                400: "INVALID_PARAMETER",
                404: "RESOURCE_NOT_FOUND",
                409: "PUBLICATION_CHANGED",
              }[status] || "DATA_UNAVAILABLE",
            message: status === 503 ? "Données indisponibles." : error.message,
          },
        },
        status,
      );
    }
  });
}

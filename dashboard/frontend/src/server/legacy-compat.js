import { createHash } from "node:crypto";
import { cupSnapshotPath } from "../../../shared/cup-worker.js";
import { decodeTables } from "../packed_data.js";
import { restoreLegacyTables } from "../season_data.js";

const leagueId = /^l_[A-Za-z0-9]{6}$/;
const playerId = /^p_[A-Za-z0-9]{6}$/;
const teamId = /^t_[A-Za-z0-9]{6}$/;
const seasonId = /^\d{4}(?:\/\d{4})?$/;
const scopeKey = /^[\w:-]{1,100}$/;
const digest = (value) => createHash("sha256").update(value).digest("hex");

function error(status, message) {
  const failure = new Error(message);
  failure.status = status;
  throw failure;
}

function parameters(params, allowed) {
  if (
    [...params].some(([key, value]) => !allowed.includes(key) || value.length > 2048) ||
    new Set(params.keys()).size !== params.size
  )
    error(400, "Paramètres invalides.");
}

function savedPath(path) {
  if (
    typeof path !== "string" ||
    !/^(raw|computed)\/[A-Za-z0-9_./-]+$/.test(path) ||
    path.split("/").some((part) => part.startsWith("."))
  )
    error(503, "Référence de données invalide.");
  return path;
}

function response(request, value, status = 200) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Data-Source": "Neon",
  };
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > 2 * 1024 * 1024 && status === 200)
    return response(request, { error: { code: "PAGE_TOO_LARGE", message: "Réduisez la taille de page." } }, 413);
  return new Response(request.method === "HEAD" ? null : body, { status, headers });
}

function sourceRequest(request, path, method = request.method) {
  return new Request(new URL(path, request.url), {
    method,
    headers: request.headers,
    signal: request.signal,
  });
}

function acceptsGzip(request) {
  const value = request.headers.get("accept-encoding");
  if (value === null) return true;
  const codings = new Map(value.split(",").map((entry) => {
    const [coding, ...parameters] = entry.trim().toLowerCase().split(";");
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const match = quality?.trim().match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/);
    return [coding.trim(), quality === undefined ? 1 : match ? Number(match[1]) : 0];
  }));
  return (codings.get("gzip") ?? codings.get("*") ?? 0) > 0;
}

async function mapLimited(values, limit, callback) {
  const result = new Array(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        result[index] = await callback(values[index]);
      }
    }),
  );
  return result;
}

async function fixturePage(request, params, { handleLegacy, readJson }) {
  parameters(params, ["league", "season", "from", "to", "status", "limit", "cursor"]);
  const league = params.get("league"), season = params.get("season"),
    from = params.get("from"), to = params.get("to"), status = params.get("status") || "all",
    rawLimit = params.get("limit") || "50", limit = Number(rawLimit);
  const day = from && to && from === to ? from : null;
  if (
    !/^[1-9]\d{0,2}$/.test(rawLimit) || limit > 100 ||
    !["all", "played", "upcoming"].includes(status) ||
    (league && !leagueId.test(league)) || (season && !seasonId.test(season)) ||
    (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day)) ||
    (from || to) && !day || (!day && !league) || (day && (league || season))
  ) error(400, "Filtres invalides.");
  const scope = digest(JSON.stringify([league, season, day, status, limit]));
  let cursor = null;
  if (params.has("cursor")) {
    try {
      const text = params.get("cursor");
      if (!/^[A-Za-z0-9_-]{1,1024}$/.test(text)) throw Error();
      cursor = JSON.parse(Buffer.from(text, "base64url").toString());
      if (cursor.scope !== scope || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || typeof cursor.generation !== "string") throw Error();
    } catch { error(400, "Curseur invalide."); }
  }
  let paths;
  if (day) paths = ["/api/pitchapi/date/" + day + "?status=all"];
  else {
    let seasons = season ? [season] : null;
    if (!seasons) {
      const manifest = await readJson("raw/index.json");
      if (!Array.isArray(manifest.seasons) || manifest.seasons.length > 100) error(503, "Index des saisons indisponible.");
      seasons = manifest.seasons.filter((item) => (item.chunks || []).some((chunk) => chunk.leagueId === league)).map((item) => item.id);
      if (seasons.some((item) => !seasonId.test(item))) error(503, "Index des saisons invalide.");
    }
    paths = seasons.map((item) => "/api/pitchapi/leagues/" + league + "/matches?" + new URLSearchParams({ season: item, status: "all" }));
  }
  const arrays = await mapLimited(paths, 3, async (path) => {
    const source = await handleLegacy(sourceRequest(request, path, "GET"));
    if (!source.ok) error(source.status === 404 ? 404 : 503, "Rencontres enregistrées indisponibles.");
    const body = await source.json();
    if (!Array.isArray(body?.data?.matches) || body.data.matches.length >= 20000)
      error(503, "Liste de rencontres incomplète.");
    if (body.data.matches.some((item) => !item || typeof item.id !== "string" || !item.id))
      error(503, "Identifiant de rencontre absent.");
    return body.data.matches;
  });
  const rows = [...new Map(arrays.flat().map((item) => [item.id, item])).values()]
    .filter((item) => status === "all" || (status === "played" ? item.status === "finished" : item.status === "not_started"))
    .sort((a, b) => (a.date == null) - (b.date == null) || String(a.date || "").localeCompare(String(b.date || "")) || a.id.localeCompare(b.id));
  const generation = digest(JSON.stringify([scope, rows]));
  if (cursor && cursor.generation !== generation) error(409, "La publication a changé. Rechargez la première page.");
  const offset = cursor?.offset || 0, matches = rows.slice(offset, offset + limit);
  const nextCursor = offset + limit < rows.length
    ? Buffer.from(JSON.stringify({ scope, generation, offset: offset + limit })).toString("base64url")
    : null;
  return response(request, { data: { matches }, pagination: { limit, generation, nextCursor } });
}

/** Adapt current public reads to already saved Neon data until AWS acceptance. */
export async function legacyCompatibility(request, { handleLegacy, readJson }) {
  if (!["GET", "HEAD"].includes(request.method))
    return response(request, { error: { code: "METHOD_NOT_ALLOWED" } }, 405);
  let url;
  try { url = new URL(request.url); } catch { return response(request, { error: { code: "INVALID_PARAMETER" } }, 400); }
  const path = url.pathname, p = url.searchParams;
  try {
    if (path === "/api/dashboard/manifest") {
      parameters(p, []);
      return handleLegacy(sourceRequest(request, "/data/dashboard-manifest.json"));
    }
    if (path === "/api/fixtures") return await fixturePage(request, p, { handleLegacy, readJson });
    const summary = path.match(/^\/api\/matches\/(m_[A-Za-z0-9]{6})\/summary$/);
    if (summary) {
      parameters(p, []);
      const saved = await handleLegacy(sourceRequest(request, `/api/archive/matches/${summary[1]}`, "GET"));
      if (!saved.ok) error(saved.status === 404 ? 404 : 503, "Match enregistré indisponible.");
      const observation = await saved.json();
      const season = observation.fixture?.season || observation.season;
      const league = observation.fixture?.league?.id || observation.competition_id;
      if (!seasonId.test(season || "") || !leagueId.test(league || "")) error(404, "Résumé introuvable.");
      const manifest = await readJson("computed/dashboard/index.json");
      const chunk = manifest.seasons?.find((item) => item.id === season)?.chunks?.find((item) => item.leagueId === league);
      if (!chunk?.path) error(404, "Résumé introuvable.");
      const packed = await readJson(savedPath(chunk.path));
      const partition = restoreLegacyTables(decodeTables(packed), packed);
      const match = partition.matches.find((item) => item.id === summary[1]);
      if (!match) error(404, "Résumé introuvable.");
      const leadingPlayers = partition.appearances
        .filter((item) => item.matchId === match.id && item.minutes > 0 && Number.isFinite(item.rating))
        .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))
        .slice(0, 5)
        .map(({ id, playerId, matchId, teamId, team, name, imageUrl, minutes, rating, goals, assists }) =>
          ({ id, playerId, matchId, teamId, team, name, imageUrl, minutes, rating, goals, assists }));
      const { players: ignored, ...value } = match;
      return response(request, { data: { version: 1, state: "ready", match: { ...value, summaryVersion: 1, leadingPlayers } } });
    }
    if (path === "/api/scouting/routes") {
      parameters(p, ["player", "team"]);
      const ids = (key, pattern) => {
        const values = p.get(key) ? p.get(key).split(",") : [];
        if (values.length > 8 || values.some((value) => !pattern.test(value))) error(400, "Identifiants invalides.");
        return [...new Set(values)];
      };
      const players = ids("player", playerId), teams = ids("team", teamId);
      if (!players.length && !teams.length) error(400, "Précisez les identifiants.");
      const manifest = await readJson("computed/dashboard/index.json");
      const index = await readJson(savedPath(manifest.scouting?.playerRoutes?.path));
      return response(request, {
        routes: Object.fromEntries(players.filter((id) => Object.hasOwn(index.routes || {}, id)).map((id) => [id, index.routes[id]])),
        clubRoutes: Object.fromEntries(teams.filter((id) => Object.hasOwn(index.clubRoutes || {}, id)).map((id) => [id, index.clubRoutes[id]])),
      });
    }
    if (path === "/api/archives/index" || path === "/api/archives/season") {
      parameters(p, path.endsWith("index") ? ["kind"] : ["kind", "season"]);
      const kind = p.get("kind"), season = p.get("season");
      if (!["results", "goals"].includes(kind) || (path.endsWith("season") && !seasonId.test(season || ""))) error(400, "Archive invalide.");
      const index = await readJson(kind === "results" ? "raw/openfootball/index.json" : "raw/historical-goals/index.json");
      if (path.endsWith("index")) return response(request, { ...index, seasons: index.seasons.map(({ path: ignored, ...entry }) => entry) });
      const entry = index.seasons.find((item) => item.id === season);
      if (!entry) error(404, "Archive introuvable.");
      const saved = savedPath(entry.path);
      if (!saved.endsWith(".gz") || !acceptsGzip(request)) {
        const result = response(request, await readJson(saved));
        result.headers.set("Vary", "Accept-Encoding");
        return result;
      }
      const source = await handleLegacy(sourceRequest(request, "/data/" + saved));
      if (![200, 304].includes(source.status)) return source;
      if (source.status === 200) {
        const length = source.headers.get("content-length");
        if (!/^\d+$/.test(length || "") || !Number.isSafeInteger(Number(length))) {
          await source.body?.cancel();
          error(503, "Taille de l’archive indisponible.");
        }
        if (Number(length) > 2 * 1024 * 1024) {
          await source.body?.cancel();
          return response(request, { error: { code: "PAGE_TOO_LARGE", message: "Archive trop volumineuse." } }, 413);
        }
      }
      const headers = new Headers(source.headers);
      headers.set("Content-Type", "application/json; charset=utf-8");
      headers.set("Content-Encoding", "gzip");
      headers.set("Vary", [...new Set([...(headers.get("vary") || "").split(",").filter(Boolean).map((name) => name.trim()), "Accept-Encoding"])].join(", "));
      return new Response(request.method === "HEAD" ? null : source.body, { status: source.status, headers });
    }
    if (path === "/api/rankings/associations") {
      parameters(p, ["year"]);
      const year = p.get("year"); if (!/^\d{4}$/.test(year || "")) error(400, "Année invalide.");
      return response(request, await readJson(`raw/rankings/uefa-associations/${year}.uefa.json`));
    }
    if (path === "/api/club-links" || path === "/api/rankings/club") {
      parameters(p, ["club"]);
      const club = p.get("club"); if (!teamId.test(club || "")) error(400, "Club invalide.");
      const links = await readJson("raw/rankings/club-links.json"), link = links.links?.[club];
      if (path === "/api/club-links") return response(request, { links: link ? { [club]: link } : {} });
      if (!link) return response(request, { rows: null });
      const index = await readJson("raw/rankings/index.json");
      const editions = index.editions.filter((item) => item.kind === "uefa-clubs" && item.provider === "UEFA");
      const rows = await mapLimited(editions, 4, async (edition) => {
        const value = await readJson(savedPath(edition.path));
        const { path: ignored, ...publicEdition } = edition;
        return { edition: publicEdition, row: value.rows.find((item) => item.entityId === link.entityId) || null };
      });
      return response(request, { rows });
    }
    if (path === "/api/cup-index") {
      parameters(p, ["kind"]);
      const kind = p.get("kind"); if (!["worker", "supplemental"].includes(kind)) error(400, "Index invalide.");
      const index = await readJson(kind === "worker" ? "raw/cup-worker/index.json" : "raw/supplemental-index.json");
      return response(request, { ...index, competitions: index.competitions.map((item) => ({ ...item, tables: Object.fromEntries(Object.entries(item.tables || {}).map(([name, ref]) => [name, { rows: ref.rows }])) })) });
    }
    if (path === "/api/cup-table") {
      parameters(p, ["competition", "season", "kind"]);
      const competition = p.get("competition"), season = p.get("season"), kind = p.get("kind");
      if (!scopeKey.test(competition || "") || !seasonId.test(season || "") || !["results", "fixtures"].includes(kind)) error(400, "Coupe invalide.");
      const indexes = await Promise.all([readJson("raw/cup-worker/index.json"), readJson("raw/supplemental-index.json")]);
      const entries = indexes.flatMap((index) => index.competitions || []).filter((item) => item.folder === competition);
      const label = season.replace("/", "-");
      const ref = entries.map((item) => item.editions?.[season]?.[kind] ||
        (item.season === season ? item.tables?.[kind] : null) ||
        (!item.season && item.tables?.[kind]?.path?.startsWith(`raw/seasons/${label}/`) ? item.tables[kind] : null))
        .find((item) => item?.path);
      if (!ref) error(404, "Table de coupe introuvable.");
      const rows = await readJson(savedPath(ref.path));
      if (!Array.isArray(rows)) error(503, "Table de coupe invalide.");
      return response(request, rows);
    }
    if (path === "/api/cup-snapshot") {
      parameters(p, ["kind", "competition", "season"]);
      let saved;
      try { saved = cupSnapshotPath(p.get("kind"), p.get("competition"), p.get("season")); }
      catch { error(400, "Coupe invalide."); }
      return response(request, await readJson(savedPath(saved)));
    }
    if (path === "/api/supplemental") {
      parameters(p, []);
      const index = await readJson("raw/supplemental-index.json");
      const competitions = await mapLimited(index.competitions, 4, async ({ tables, ...item }) => {
        const entries = await mapLimited(Object.entries(tables || {}), 3, async ([kind, ref]) => [kind, await readJson(savedPath(ref.path))]);
        return { ...item, ...Object.fromEntries(entries) };
      });
      return response(request, { meta: index.meta, competitions });
    }
    if (path === "/api/matchdays") {
      parameters(p, ["competition", "season"]);
      const competition = p.get("competition"), season = p.get("season");
      if (!leagueId.test(competition || "") || !seasonId.test(season || "")) error(400, "Compétition ou saison invalide.");
      const year = Number(season.slice(0, 4)), label = season.includes("/") ? season.replace("/", "-") : `${year}-${year + 1}`;
      const value = await readJson(`computed/matchdays/${label}.json.gz`);
      if (!Object.hasOwn(value, competition)) error(404, "Journées introuvables.");
      return response(request, { matches: value[competition] });
    }
    return await handleLegacy(request);
  } catch (failure) {
    const status = failure.status || (failure.code === "ENOENT" ? 404 : 503);
    return response(request, { error: { code: status === 400 ? "INVALID_PARAMETER" : status === 404 ? "RESOURCE_NOT_FOUND" : status === 409 ? "PUBLICATION_CHANGED" : "DATA_UNAVAILABLE", message: failure.status ? failure.message : "Données indisponibles." } }, status);
  }
}

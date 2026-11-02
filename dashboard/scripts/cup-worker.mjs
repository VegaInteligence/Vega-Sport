/** Refresh cup fixtures and source-backed rounds without a request per visitor. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { cupSnapshotPath, CUP_WORKER_ROOT } from "../shared/cup-worker.js";
import { OPEN_CUP_CATALOG, WORLD_CUP_FALLBACK, WORLD_CUP_ID } from "../frontend/src/services/cup-catalog.js";
import { NATIONAL_CUP_ARCHIVES } from "../frontend/src/services/cup-archives.js";
import { FEATURED_EUROPE_IDS } from "../frontend/src/services/competition-selector.js";
import { GET as openCupRoute } from "../frontend/app/api/open-cups/route.js";
import { GET as openLigaRoute } from "../frontend/app/api/openligadb/route.js";
import { GET as nationsRoute } from "../frontend/app/api/nations-results/route.js";
import { GET as standingsRoute } from "../frontend/app/api/standings/route.js";

const ORIGIN = "https://raw.githubusercontent.com/oladeeayo/open-matchday/";
const INDEX = `${CUP_WORKER_ROOT}/index.json`;
const USER_AGENT = "STATARENA-Cup-Worker/1.0 (+https://github.com/OrionQuantPlatform/STATARENA/issues)";
const sha = (body) => createHash("sha256").update(body).digest("hex");
const serial = (value) => JSON.stringify(value);
const absolute = (root, relative) => path.join(root, ...relative.split("/"));
async function read(file) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function write(file, value) {
  const text = serial(value) + "\n";
  try { if (await fs.readFile(file, "utf8") === text) return false; } catch (error) { if (error.code !== "ENOENT") throw error; }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + ".tmp";
  await fs.writeFile(tmp, text); await fs.rename(tmp, file); return true;
}
async function request(fetcher, url, options = {}) {
  const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response;
}

/** RFC 4180 CSV fields, including quoted commas, quotes and line breaks. */
export function parseCupCsv(text) {
  if (typeof text !== "string" || text.length > 20 * 1024 * 1024) throw new Error("Invalid CSV");
  const records = []; let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === "," && !quoted) { row.push(value); value = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(value); value = ""; if (row.some(Boolean)) records.push(row); row = []; }
    else value += c;
  }
  if (quoted) throw new Error("Unterminated CSV field");
  if (value || row.length) { row.push(value); records.push(row); }
  const header = records.shift()?.map((x) => x.replace(/^\uFEFF/, "").trim()) || [];
  if (!["date", "home", "away"].every((name) => header.includes(name)) || new Set(header).size !== header.length) throw new Error("Invalid CSV header");
  if (records.length > 10000 || records.some((r) => r.length !== header.length)) throw new Error("Invalid CSV rows");
  const keep = new Set(["date", "time", "home", "away", "ft_home", "ft_away", "round", "round_name", "stage"]);
  return records.map((values) => Object.fromEntries(header.flatMap((name, i) => keep.has(name) ? [[name, values[i]]] : [])));
}
function seasonLabel(code) {
  if (!/^\d{4}$/.test(String(code || ""))) throw new Error("Invalid source season");
  const start = 2000 + Number(String(code).slice(0, 2)), end = 2000 + Number(String(code).slice(2));
  if (end !== start + 1) throw new Error("Invalid source season");
  return `${start}/${end}`;
}
function currentSeason(now) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Paris", year: "numeric", month: "numeric" }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year").value), month = Number(parts.find((p) => p.type === "month").value), start = month >= 7 ? year : year - 1;
  return `${start}/${start + 1}`;
}
function planSources(now) {
  const current = currentSeason(now), year = now.getUTCFullYear(), requests = [];
  for (const cup of OPEN_CUP_CATALOG.filter((item) => item.source === "openfootball"))
    for (const season of cup.seasons) requests.push({ kind: "open-cups", key: cup.sourceKey, season, active: Number(String(season).slice(0, 4)) >= year });
  for (const season of WORLD_CUP_FALLBACK.seasons) requests.push({ kind: "open-cups", key: "world-cup-history", season, active: Number(season) >= year });
  for (const item of Object.values(NATIONAL_CUP_ARCHIVES)) requests.push({ kind: "open-cups", key: item.key, season: item.season, active: false });
  const previousStart = Number(current.slice(0, 4)) - 1;
  for (const season of [current, `${previousStart}/${previousStart + 1}`]) requests.push({ kind: "openligadb", key: "germany-cup", season, active: season === current });
  requests.push({ kind: "openligadb", key: "nations-league", season: "2026/2027", active: current === "2026/2027" });
  requests.push({ kind: "nations-results", key: "nations-league", season: "2026/2027", active: current === "2026/2027" });
  for (const id of FEATURED_EUROPE_IDS) requests.push({ kind: "standings", key: id, season: current, active: true });
  if (year <= Number(WORLD_CUP_FALLBACK.seasons[0])) requests.push({ kind: "standings", key: WORLD_CUP_ID, season: WORLD_CUP_FALLBACK.seasons[0], active: true });
  return [...new Map(requests.map((x) => [[x.kind, x.key, x.season].join(":"), x])).values()];
}
async function routeSource(item) {
  const path = item.kind === "nations-results" ? `/api/nations-results?season=${encodeURIComponent(item.season)}` : item.kind === "standings" ? `/api/standings?competition=${encodeURIComponent(item.key)}` : `/api/${item.kind}?competition=${encodeURIComponent(item.key)}&season=${encodeURIComponent(item.season)}`;
  const handler = item.kind === "open-cups" ? openCupRoute : item.kind === "openligadb" ? openLigaRoute : item.kind === "standings" ? standingsRoute : nationsRoute;
  const response = await handler(new Request("http://localhost" + path));
  if (!response.ok) throw new Error("HTTP " + response.status);
  const data = await response.json();
  if (!Array.isArray(item.kind === "standings" ? data.tables : data.matches)) throw new Error("Invalid source payload");
  if (item.kind === "standings") delete data.fetchedAt;
  return data;
}
async function saveSnapshot(root, item, payload, now, coldCheck = false) {
  const relative = cupSnapshotPath(item.kind, item.key, item.season), file = absolute(root, relative), old = await read(file);
  const previous = old ? { ...old } : null; if (previous) delete previous.worker;
  const changed = serial(previous) !== serial(payload);
  if (!changed && !coldCheck) return false;
  const value = { ...payload, worker: { updatedAt: changed ? now.toISOString() : old.worker?.updatedAt || now.toISOString(), checkedAt: coldCheck ? now.toISOString() : old?.worker?.checkedAt || now.toISOString() } };
  return write(file, value);
}
async function refreshOpenSources(context) {
  const { root, now, receipt, sourceLoader, sourcePlan } = context;
  for (const item of sourcePlan) {
    const file = absolute(root, cupSnapshotPath(item.kind, item.key, item.season)), old = await read(file);
    const checked = Date.parse(old?.worker?.checkedAt || ""), cold = !item.active;
    if (old && cold && Number.isFinite(checked) && now.getTime() - checked < 30 * 86400000) { receipt.skipped++; continue; }
    try {
      const payload = await sourceLoader(item);
      const records = item.kind === "standings" ? payload?.tables : payload?.matches;
      const previous = item.kind === "standings" ? old?.tables : old?.matches;
      if (!Array.isArray(records)) throw new Error("Invalid source payload");
      if (!records.length && previous?.length) throw new Error("Source returned no records");
      if (await saveSnapshot(root, item, payload, now, cold)) receipt.changed++;
      receipt.sources.push({ kind: item.kind, key: item.key, season: item.season, records: records.length });
    } catch (error) { receipt.failures.push({ kind: item.kind, key: item.key, season: item.season, error: String(error.message || "Source unavailable") }); }
  }
}
async function refreshSupplemental(context, previous) {
  const { root, now, receipt, fetcher } = context;
  const commit = await (await request(fetcher, "https://api.github.com/repos/oladeeayo/open-matchday/commits/master", { headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" } })).json();
  if (!/^[a-f0-9]{40}$/i.test(commit?.sha || "")) throw new Error("Invalid source revision");
  const base = ORIGIN + commit.sha + "/", summary = await (await request(fetcher, base + "build_summary.json")).json();
  const season = seasonLabel(summary.season);
  if (!Array.isArray(summary.leagues)) throw new Error("Invalid cup catalogue");
  const candidates = summary.leagues.filter((x) => /^data\/[A-Z]{3}_CUP_[a-z0-9-]+$/.test(x.folder || ""));
  if (!candidates.length) throw new Error("No cups in source catalogue");
  const records = new Map((previous?.competitions || []).map((item) => [item.folder, item]));
  for (const item of candidates) {
    const folder = item.folder.slice(5), existing = records.get(folder), tables = {};
    try {
      if (Array.isArray(item.errors) && item.errors.length) throw new Error("Source reports collection errors");
      for (const kind of ["results", "fixtures"]) {
        const count = Number(item[kind] || 0);
        if (!Number.isInteger(count) || count < 0 || count > 10000) throw new Error("Invalid source count");
        const rows = count ? parseCupCsv(await (await request(fetcher, `${base}${item.folder}/${kind}_${summary.season}.csv`)).text()) : [];
        if (rows.length !== count) throw new Error("Source count mismatch");
        const startYear = Number(season.slice(0, 4));
        if (rows.some((row) => {
          if (!row.home?.trim() || !row.away?.trim()) return true;
          if (!row.date) return false;
          const time = Date.parse(row.date + "T00:00:00Z");
          return !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== row.date || ![startYear, startYear + 1].includes(Number(row.date.slice(0, 4)));
        })) throw new Error("Invalid cup fixture date or teams");
        const old = existing?.editions?.[season]?.[kind];
        if (kind === "results" && !rows.length && old?.rows > 0) throw new Error("Source unexpectedly empty");
        const body = serial(rows) + "\n", digest = sha(body);
        const relative = `${CUP_WORKER_ROOT}/supplemental/${season.replace("/", "-")}/${folder}/${kind}-${digest.slice(0, 20)}.json`;
        tables[kind] = { path: relative, rows: rows.length, sha256: digest, format: "json" };
        tables[kind]._rows = rows;
      }
      if (!tables.results.rows && !tables.fixtures.rows && ((existing?.editions?.[season]?.results?.rows || 0) + (existing?.editions?.[season]?.fixtures?.rows || 0))) throw new Error("Source unexpectedly empty");
      for (const kind of ["results", "fixtures"]) {
        const rows = tables[kind]._rows; delete tables[kind]._rows;
        if (await write(absolute(root, tables[kind].path), rows)) receipt.changed++;
      }
      const editions = { ...(existing?.editions || {}), [season]: tables };
      records.set(folder, { folder, name: item.league || existing?.name || folder, country_code: folder.slice(0, 3), season, tables, editions, discovered: true });
      receipt.sources.push({ kind: "supplemental", key: folder, season, results: tables.results.rows, fixtures: tables.fixtures.rows });
    } catch (error) { receipt.failures.push({ kind: "supplemental", key: folder, season, error: String(error.message || "Source unavailable") }); }
  }
  return { meta: { source: "https://github.com/oladeeayo/open-matchday", source_generated_at_utc: summary.generated_utc || null, source_revision: commit.sha, usage: "non-commercial with attribution" }, competitions: [...records.values()].sort((a, b) => a.folder.localeCompare(b.folder)) };
}
async function matchdayRounds(root, league, season) {
  const start = Number(season.slice(0, 4)), label = season.includes("/") ? season.replace("/", "-") : `${start}-${start + 1}`;
  try { const data = JSON.parse(gunzipSync(await fs.readFile(path.join(root, "computed", "matchdays", label + ".json.gz"))).toString("utf8")); return data[league] || {}; } catch { return {}; }
}
async function refreshNative(context, previous) {
  const { root, now, receipt, fetcher, apiKey } = context;
  if (!/^pk_(live|test)_[A-Za-z0-9_-]+$/.test(apiKey || "")) { receipt.failures.push({ kind: "native", error: "Clé PitchAPI indisponible" }); return previous?.native || []; }
  const headers = { "X-API-KEY": apiKey, Accept: "application/json", "User-Agent": USER_AGENT };
  let nextRequest = 0;
  const api = async (endpoint) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const delay = Math.max(0, nextRequest - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      nextRequest = Date.now() + Math.max(0, context.pitchIntervalMs);
      const response = await fetcher("https://api.pitchapi.dev/v1/" + endpoint, { headers, signal: AbortSignal.timeout(30000) });
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const seconds = Number(response.headers.get("retry-after"));
        await new Promise((resolve) => setTimeout(resolve, Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 30000) : 1000 * 2 ** attempt));
        continue;
      }
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      if (serial(data).includes(apiKey)) throw new Error("Credential in response");
      return data.data;
    }
  };
  const catalog = await api("leagues");
  if (!Array.isArray(catalog?.leagues)) throw new Error("Invalid provider catalogue");
  const known = new Set([...FEATURED_EUROPE_IDS, WORLD_CUP_ID]), current = currentSeason(now), start = Number(current.slice(0, 4));
  const cups = catalog.leagues.filter((league) => /^l_[A-Za-z0-9]{6}$/.test(league.id || "") && (known.has(league.id) || /\b(cup|copa|coupe|pokal|nations league)\b/i.test(league.name || "")));
  const entries = new Map((previous?.native || []).map((item) => [item.id, item]));
  let detailBudget = Math.max(0, Math.min(200, context.detailLimit));
  for (const league of cups) {
    const seasons = (league.seasons || []).map(String).filter((s) => /^\d{4}(?:\/\d{4})?$/.test(s));
    const selected = league.id === WORLD_CUP_ID ? seasons.filter((s) => /^\d{4}$/.test(s) && Number(s) <= start + 4).sort().reverse().slice(0, 2) : seasons.filter((s) => Number(s.slice(0, 4)) >= start - 1 && Number(s.slice(0, 4)) <= start + 1);
    for (const season of selected) {
      const file = absolute(root, cupSnapshotPath("native", league.id, season)), old = await read(file), cold = Number(season.slice(0, 4)) < start;
      const checked = Date.parse(old?.worker?.checkedAt || "");
      if (old && cold && Number.isFinite(checked) && now.getTime() - checked < 30 * 86400000) { receipt.skipped++; continue; }
      try {
        const data = await api(`leagues/${league.id}/matches?season=${encodeURIComponent(season)}&status=all`);
        if (!Array.isArray(data?.matches) || (!data.matches.length && old?.matches?.length)) throw new Error("Invalid match inventory");
        const listed = new Set(data.matches.map((match) => match.id));
        if ((old?.matches || []).some((match) => match.status === "finished" && !listed.has(match.id))) throw new Error("Provider omitted previously recorded results");
        const matches = data.matches.map((match) => ({ ...match, league: match.league || data.league || { id: league.id, name: league.name }, season: match.season ?? season }));
        const rounds = { ...(await matchdayRounds(root, league.id, season)), ...(old?.rounds || {}) };
        const roundsChecked = { ...(old?.roundsChecked || {}) };
        const oldMatches = new Map((old?.matches || []).map((match) => [match.id, match]));
        const identity = (match) => JSON.stringify([match?.date, match?.time_utc, match?.status, match?.home_team?.id, match?.away_team?.id]);
        const unknown = matches.filter((match) => {
          if (!/^m_[A-Za-z0-9]{6}$/.test(match.id || "")) return false;
          if (match.status === "not_started") {
            const checked = Date.parse(roundsChecked[match.id] || "");
            return !rounds[match.id] || identity(match) !== identity(oldMatches.get(match.id)) || !Number.isFinite(checked) || now.getTime() - checked >= 7 * 86400000;
          }
          return !rounds[match.id] && match.status === "finished" && now.getTime() - Date.parse(match.date || "") < 7 * 86400000;
        }).slice(0, detailBudget);
        for (const match of unknown) {
          detailBudget--;
          try {
            const detail = await api(`matches/${match.id}`), name = detail?.round_name;
            if (detail?.id === match.id && detail?.league?.id === league.id && String(detail?.season) === season && (typeof name === "string" || typeof name === "number") && String(name).trim()) {
              rounds[match.id] = { name: String(name).trim(), playoff: detail.has_playoff === true };
              roundsChecked[match.id] = now.toISOString();
            }
          } catch (error) { if (String(error.message).includes("HTTP 429")) { detailBudget = 0; break; } /* Keep fixtures without round metadata. */ }
        }
        const payload = { matches, rounds, roundsChecked, source: { name: "PitchAPI" } };
        if (await saveSnapshot(root, { kind: "native", key: league.id, season }, payload, now, cold)) receipt.changed++;
        const existing = entries.get(league.id), knownSeasons = [...new Set([...(existing?.seasons || []), season])].sort().reverse();
        entries.set(league.id, { id: league.id, name: league.name, country: league.country_code || "", seasons: knownSeasons, cupWorker: true });
        receipt.sources.push({ kind: "native", key: league.id, season, matches: matches.length, rounds: Object.keys(rounds).length });
      } catch (error) { receipt.failures.push({ kind: "native", key: league.id, season, error: String(error.message || "Source unavailable") }); }
    }
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export async function refreshCupWorker({ dataRoot, now = new Date(), fetcher = fetch, apiKey = process.env.PITCHAPI_API_KEY, sourceLoader = routeSource, sourcePlan = planSources(now), supplemental = true, native = true, detailLimit = 80, pitchIntervalMs = 1000 } = {}) {
  const root = path.resolve(dataRoot), instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid collection date");
  const file = absolute(root, INDEX), previous = await read(file), receipt = { startedAt: instant.toISOString(), changed: 0, skipped: 0, sources: [], failures: [] };
  const context = { root, now: instant, receipt, fetcher, apiKey, sourceLoader, sourcePlan, detailLimit, pitchIntervalMs };
  await refreshOpenSources(context);
  let index = previous || { schemaVersion: 1, meta: {}, competitions: [], native: [] };
  if (supplemental) try { index = { ...index, ...(await refreshSupplemental(context, index)) }; } catch (error) { receipt.failures.push({ kind: "supplemental", error: String(error.message || "Source unavailable") }); }
  if (native) try { index = { ...index, native: await refreshNative(context, index) }; } catch (error) { receipt.failures.push({ kind: "native", error: String(error.message || "Source unavailable") }); }
  if (await write(file, index)) receipt.changed++;
  receipt.completedAt = new Date().toISOString();
  return receipt;
}

/** Verify every published reference before the workflow commits the snapshot. */
export async function verifyCupWorker(dataRoot, receipt = { sources: [] }) {
  const root = path.resolve(dataRoot), index = await read(absolute(root, INDEX));
  if (!index || index.schemaVersion !== 1 || !Array.isArray(index.competitions) || !Array.isArray(index.native)) throw new Error("Invalid cup index");
  const seen = new Set(); let files = 0;
  for (const competition of index.competitions) {
    if (!/^[A-Z]{3}_CUP_[a-z0-9-]+$/.test(competition.folder || "") || seen.has(competition.folder)) throw new Error("Invalid cup identity");
    seen.add(competition.folder);
    for (const [season, tables] of Object.entries(competition.editions || {})) {
      if (!/^\d{4}\/\d{4}$/.test(season)) throw new Error("Invalid cup edition");
      for (const ref of Object.values(tables)) {
        if (!ref?.path?.startsWith(CUP_WORKER_ROOT + "/supplemental/") || ref.path.split("/").some((part) => part.startsWith("."))) throw new Error("Invalid cup reference");
        const body = await fs.readFile(absolute(root, ref.path)), rows = JSON.parse(body.toString("utf8"));
        if (!Array.isArray(rows) || rows.length !== ref.rows || sha(body) !== ref.sha256) throw new Error("Cup reference mismatch");
        files++;
      }
    }
  }
  for (const competition of index.native) {
    if (!/^l_[A-Za-z0-9]{6}$/.test(competition.id || "") || !Array.isArray(competition.seasons)) throw new Error("Invalid native cup");
    for (const season of competition.seasons) {
      const value = await read(absolute(root, cupSnapshotPath("native", competition.id, season)));
      if (!Array.isArray(value?.matches) || !value.rounds || /pk_(?:live|test)_[A-Za-z0-9_-]+/.test(serial(value))) throw new Error("Invalid native snapshot");
      files++;
    }
  }
  for (const item of receipt.sources || []) {
    if (!["open-cups", "openligadb", "nations-results", "standings"].includes(item.kind)) continue;
    const value = await read(absolute(root, cupSnapshotPath(item.kind, item.key, item.season)));
    if (!Array.isArray(item.kind === "standings" ? value?.tables : value?.matches)) throw new Error("Invalid source snapshot");
    files++;
  }
  return { competitions: index.competitions.length, native: index.native.length, files };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), index = args.indexOf("--data-root"), receiptIndex = args.indexOf("--receipt");
  const dataRoot = index >= 0 ? args[index + 1] : path.resolve("data");
  const receipt = await refreshCupWorker({ dataRoot });
  receipt.verified = await verifyCupWorker(dataRoot, receipt);
  if (receiptIndex >= 0) { await fs.mkdir(path.dirname(path.resolve(args[receiptIndex + 1])), { recursive: true }); await fs.writeFile(args[receiptIndex + 1], JSON.stringify(receipt, null, 2) + "\n"); }
  console.log(JSON.stringify({ sources: receipt.sources.length, changed: receipt.changed, skipped: receipt.skipped, failures: receipt.failures }));
  if (!receipt.sources.length && receipt.failures.length) process.exitCode = 1;
}

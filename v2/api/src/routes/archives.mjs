/**
 * GET /api/read/archive and GET /api/archives/index — the historical archives, same
 * parameters and same bodies as relational-archives.js and the archive catalogue of
 * main, read from api.archive_matches, api.archive_goals and api.archive_editions
 * (025), which vega_v2/archives.py fills from main's own builders and shared/archive.js.
 *
 * Differences with the legacy read, by construction of v2 (listed for the parity
 * comparison):
 * - a goal's `team` is the name of the side it designates and its `match` label is the
 *   match's own ("<team1> vs. <team2> h:a"); `date` is the match date; `sourceSeason`
 *   is not kept;
 * - `meta.version` hashes the season's archive version and the source revisions;
 * - the indexes count the typed rows (no file paths, sizes or checksums; the goals index
 *   counts the editions and matches the goals are attached to).
 * /api/archives/season (whole source documents) is not served: the v2 manifest declares
 * boundedArchive, so the site reads pages.
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";
import { readPageArgs } from "../publication.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalizeText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("fr");
const norm = (column) => `regexp_replace(normalize(lower(coalesce(${column},'')),NFD),'[̀-ͯ]','','g')`;
const pair = (a, b) => (a != null && b != null ? [a, b] : null);

/** The notes of shared/openfootball-history.js and shared/archive.js, from typed columns. */
export function archiveNotes(m) {
  const notes = [];
  if (m.home_score_et != null && m.away_score_et != null) notes.push("après prolongation");
  if (m.home_penalty_score != null && m.away_penalty_score != null) notes.push(`tirs au but ${m.home_penalty_score} – ${m.away_penalty_score}`);
  else if (m.decided_on_penalties) notes.push("tirs au but");
  if (m.status === "canceled") notes.push("Rencontre non disputée" + (m.note ? ` : ${m.note}` : ""));
  if (m.is_neutral) notes.push("terrain neutre");
  return notes;
}

export function archiveListing(m) {
  return {
    key: m.key,
    competitionId: m.competition_id,
    competition: m.competition,
    country: m.country,
    date: m.date || "",
    dateNote: Boolean(m.date_unverified),
    round: m.round || "",
    team1: m.team1 || "",
    team2: m.team2 || "",
    score: [m.home_score ?? null, m.away_score ?? null],
    notes: archiveNotes(m),
    hasGoals: m.goal_count > 0,
    goalCount: m.goal_count,
  };
}

const goal = (g, m) => ({
  date: m.date || "",
  match: `${m.team1 || ""} vs. ${m.team2 || ""} ${m.home_score ?? ""}:${m.away_score ?? ""}`,
  minute: g.minute ?? "",
  player: g.player ?? "",
  score: pair(g.score_home, g.score_away) ?? [null, null],
  ...(g.score_disagreement ? { scoreDisagreement: true } : {}),
  team: g.team ?? "",
});

const metaSql = `SELECT
  (SELECT version FROM api.versions WHERE resource_kind='archive_season' AND resource_id=$1::int) AS version,
  (SELECT coalesce(json_agg(r ORDER BY r.source),'[]'::json) FROM api.source_revisions r WHERE r.source IN ('results','goals')) AS sources,
  EXISTS(SELECT 1 FROM api.archive_matches WHERE season=$2) AS present`;

async function archiveMeta(read, season) {
  const [row] = await read(metaSql, [Number(season.slice(0, 4)), season]);
  if (!row?.present) reject(404, "Archive introuvable.");
  const sources = Object.fromEntries((row.sources || []).map((s) => [s.source, { digest: s.revision, publishedAt: s.retrieved_at }]));
  return {
    version: hash([season, String(row.version ?? 0), sources]),
    sourceDigests: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v.digest])),
    sources,
  };
}

export async function archiveRead(req, params, read) {
  validateParams(params, ["season", "competition", "q", "page", "limit", "match", "version"]);
  const season = params.get("season"),
    competition = params.get("competition") || "all",
    q = (params.get("q") || "").trim(),
    matchKey = params.get("match");
  if (!/^\d{4}(?:\/\d{4})?$/.test(season || "")) reject(400, "Saison invalide.");
  if (competition.length > 160 || /[\u0000-\u001f]/.test(competition)) reject(400, "Compétition invalide.");
  if (q.length > 100 || /[\u0000-\u001f]/.test(q)) reject(400, "Recherche invalide.");
  if (matchKey !== null && (!matchKey || matchKey.length > 256 || /[\u0000-\u001f]/.test(matchKey))) reject(400, "Match invalide.");
  if (params.has("version") && !/^[a-f0-9]{64}$/.test(params.get("version"))) reject(400, "Publication invalide.");
  const paging = readPageArgs(params, 50);
  const meta = await archiveMeta(read, season);
  if (params.has("version") && params.get("version") !== meta.version) reject(409, "Les archives ont été actualisées. Rechargez la première page.");
  const etag = `W/"archive-v2-${hash([meta.version, [...params].sort(([a], [b]) => a.localeCompare(b))])}"`;
  if (!matchKey && (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag))) return send(req, null, 200, { etag, ttl: 30 });
  const [overview] = await read(
    `WITH m AS (SELECT * FROM api.archive_matches WHERE season=$1)
     SELECT (SELECT coalesce(json_agg(json_build_object('id',e.id,'name',e.name,'country',e.country,
         'matches',(SELECT count(*) FROM m WHERE m.competition_id=e.id),
         'withGoals',(SELECT count(*) FROM m WHERE m.competition_id=e.id AND m.goal_count>0),
         'goals',(SELECT coalesce(sum(goal_count),0) FROM m WHERE m.competition_id=e.id)) ORDER BY e.position),'[]'::json)
       FROM api.archive_editions e WHERE e.season=$1) AS competitions,
       json_build_object('matches',(SELECT count(*) FROM m),
         'results',(SELECT count(*) FROM m WHERE home_score IS NOT NULL AND away_score IS NOT NULL),
         'withGoals',(SELECT count(*) FROM m WHERE goal_count>0),'goals',(SELECT coalesce(sum(goal_count),0) FROM m),
         'competitions',(SELECT count(*) FROM api.archive_editions WHERE season=$1)) AS summary`,
    [season],
  );
  const data = { season, competitions: overview.competitions, summary: overview.summary };
  if (matchKey) {
    const [row] = await read(
      `SELECT to_json(m) AS match,(SELECT coalesce(json_agg(g ORDER BY g.seq),'[]'::json) FROM api.archive_goals g
         WHERE g.season_id=m.season_id AND g.match_id=m.match_id) AS goals
       FROM api.archive_matches m WHERE m.season=$1 AND m.key=$2`,
      [season, matchKey],
    );
    if (!row?.goals?.length) reject(404, "Aucun but archivé pour ce match.");
    const { hasGoals, goalCount, ...listing } = archiveListing(row.match);
    data.match = { ...listing, goals: row.goals.map((g) => goal(g, row.match)) };
    data.matches = [];
    return send(req, { data, meta }, 200, { etag, ttl: 30, maxBytes: 512 * 1024 });
  }
  const needle = normalizeText(q).trim();
  const filter = `m.season=$1 AND ($2='all' OR m.competition_id=$2) AND ($3='' OR position($3 IN ${norm("m.team1||' '||m.team2")})>0
     OR EXISTS(SELECT 1 FROM api.archive_goals g WHERE g.season_id=m.season_id AND g.match_id=m.match_id AND position($3 IN ${norm("g.player")})>0))`;
  const [counted] = await read(`SELECT count(*)::int AS total FROM api.archive_matches m WHERE ${filter}`, [season, competition, needle]);
  const total = counted.total,
    pages = Math.max(1, Math.ceil(total / paging.limit)),
    page = Math.min(paging.page, pages);
  const rows = await read(`SELECT m.* FROM api.archive_matches m WHERE ${filter} ORDER BY m.position LIMIT $4 OFFSET $5`, [
    season, competition, needle, paging.limit, (page - 1) * paging.limit,
  ]);
  data.matches = rows.map(archiveListing);
  const pagination = { total, pages, page, limit: paging.limit, hasMore: page < pages, version: meta.version };
  return send(req, { data, meta, pagination }, 200, { etag, ttl: 30, maxBytes: 512 * 1024 });
}

const SOURCE_FIELDS = ["name", "url", "license", "revision"];
const source = (s) => Object.fromEntries(SOURCE_FIELDS.filter((k) => s[k] != null).map((k) => [k, s[k]]));

export async function archiveIndex(req, params, read) {
  validateParams(params, ["kind"]);
  const kind = params.get("kind");
  if (!["results", "goals"].includes(kind || "")) reject(400, "Paramètre invalide.");
  // In the archive index's order (its position), as main lists them.
  const sources = await read("SELECT * FROM api.source_revisions ORDER BY position NULLS LAST,source");
  const main = sources.find((s) => s.source === kind);
  if (!main) reject(404, "Donnée indisponible.");
  // The seasons' counts are precomputed (agg.archive_seasons, refreshed by the worker's
  // daily pass): counting them here read the whole archive on every request.
  let body;
  if (kind === "results") {
    const seasons = await read(`SELECT season AS id,competitions,matches,results,unplayed,unverified_dates AS "unverifiedDates"
      FROM api.archive_result_seasons ORDER BY season DESC`);
    body = {
      schemaVersion: 1,
      source: {
        ...source(main),
        ...(main.archive_sha256 && { archiveSha256: main.archive_sha256 }),
        ...(main.coverage && { coverage: main.coverage }),
        additionalSources: sources
          .filter((s) => s.source.startsWith("results/"))
          .map((s) => ({ ...source(s), ...(s.archive_sha256 && { archiveSha256: s.archive_sha256 }), ...(s.coverage && { coverage: s.coverage }) })),
      },
      seasons,
    };
  } else {
    const seasons = await read(`SELECT season AS id,competitions,events,matches,score_disagreements AS "scoreDisagreements",
      latest_event::text AS "latestEvent" FROM api.archive_goal_seasons ORDER BY season DESC`);
    body = { schemaVersion: 1, source: { ...source(main), ...(main.coverage && { coverage: main.coverage }) }, seasons };
  }
  const etag = `W/"catalog-v1-${hash(body)}"`;
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl: 60 });
  return send(req, body, 200, { etag, ttl: 60 });
}

export function createArchiveRoute(read) {
  return async (req, path, params) => {
    if (path === "/api/read/archive") return archiveRead(req, params, read);
    if (path === "/api/archives/index") return archiveIndex(req, params, read);
    return null;
  };
}

// Test double of the two home reads of VI-48 (#69) while they are not deployed: a small HTTP proxy in front of a
// real read API (the public one, or a local replay of it). Every request is forwarded unchanged, except:
//  - GET /api/read/home: the upstream answer, plus `data.billboard` (« À l'affiche ») and `data.billboardWindow` (its
//    Paris days, { start, end }) when the upstream has none;
//  - GET /api/read/home-local?season&country: answered here, in the shape of backend/api/src/routes/home.mjs
//    (homeLocalRecord: { country, window, competitions, matches, table }, each match a windowRecord);
//  - GET /api/dashboard/manifest: the upstream manifest, with compactReads["home-local"] announced when absent.
// Both windows are computed from the upstream's own public reads, never from invented data: /api/fixtures (the
// fixtures, their forecast), /api/rankings/power (the clubs' Elo), /api/competitions (a league's country) and
// /api/standings (the table). The importance is the documented v2 formula (docs/calculs/06-accueil-et-matchs/
// 01-accueil.md, backend/sql/170_home_importance_v2.sql): stakes × level + balance. What the public reads do not
// give is left at the formula's neutral value, and listed here so nobody reads the double as the real thing:
//  - a side's rating: its club Elo when the club is among the power ranking's first 200, else the centre (the
//    league-level fallback, agg.league_levels, is not public); national teams always at the centre;
//  - neutral ground is unknown: the home advantage is always 60; a round's stage is unknown: a numbered round or
//    « League Stage - Round N » is ordinary, other names go through api.home_round_v2's words;
//  - the balance: the fixture's forecast when /api/fixtures gives one (matches not started), else the Elo's
//    expected score when both sides have an Elo, else 0.5; a finished match's forecast is null;
//  - home-local's competitions carry `level: null` (not public); the table is the top six of the first league's
//    /api/standings, when the upstream answers it;
//  - meta: the manifest's publication (generation = publicationVersion), the same keys as the real envelope.
// When the upstream already serves `billboard` or /api/read/home-local, the double steps aside (pass-through), so an
// E2E written against it runs unchanged against the deployed API.
//
// Run: node tests/e2e/support/home-v2-overlay.mjs <upstream origin> <port> [now ISO]   (or VEGA_NOW=<ISO>)
// Control (for the fallback check): GET /__overlay/billboard?on=0 drops the key, ?on=1 restores it.
import http from "node:http";

const [upstream = "http://127.0.0.1:8765", port = "8766", nowArg] = process.argv.slice(2);
const NOW = Date.parse(nowArg || process.env.VEGA_NOW || "") || Date.now();
const state = { billboard: true };

// api.home_rules_v2 and the formula's rows (170_home_importance_v2.sql).
export const RULES = { billboardBefore: 1, billboardAfter: 3, billboardPerDay: 8, localBefore: 1, localAfter: 7, localPerDay: 16, tableRows: 6 };
const PRESTIGE = { l_1XLtP0: 1.3, l_0bfbkO: 1.15, l_38d9HA: 1.08, l_2WZ2tt: 1.04 };
const ROUND = { knockout: 1.05, semi_final: 1.1, final: 1.15 };
const CENTRE = 1400, DIVISOR = 100, HOME_ADVANTAGE = 60;
const SHOWN = new Set(["finished", "in_play", "not_started"]);

const parisDayOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const addDays = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const round2 = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);

/** api.home_round_v2: a round's key, or null for an ordinary round. */
export function roundOf(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n || /^(league stage - round )?[0-9]+$/.test(n)) return null;
  if (n === "1/2" || ["semi", "halbfinal", "demi"].some((w) => n.includes(w))) return "semi_final";
  if (["1/4", "1/8", "1/16"].includes(n) || ["quarter", "viertelfinal", "achtelfinal", "quarts de finale", "huitièmes", "huitiemes", "seizièmes", "seiziemes", "round of 16", "round of 32", "last 16", "last 32"].some((w) => n.includes(w)))
    return "knockout";
  if (["final", "finale", "finals", "the final"].includes(n) || n.endsWith(" - final")) return "final";
  return null;
}

/** stakes × level + balance, from what the public reads give (see the header). */
export function importance(fixture, elo) {
  const stakes = (PRESTIGE[fixture.league?.id] || 1) * (ROUND[roundOf(fixture.round_name)] || 1);
  const rh = elo.get(fixture.home_team?.id), ra = elo.get(fixture.away_team?.id);
  const level = ((rh ?? CENTRE) + (ra ?? CENTRE)) / 2 - CENTRE;
  const f = fixture.forecast;
  const balance = f
    ? 1 - Math.abs(f.home - f.away)
    : rh != null && ra != null
      ? 1 - Math.abs(2 / (1 + 10 ** ((ra - rh - HOME_ADVANTAGE) / 400)) - 1)
      : 0.5;
  return (stakes * level) / DIVISOR + balance;
}

const kickoff = (f) => (f.time_utc && /T/.test(f.time_utc) ? Date.parse(f.time_utc) : Date.parse(`${f.date}T12:00:00Z`));

/** A window's records (windowRecord): the most important `perDay` of each Paris day, day ↑, importance ↓, kick-off ↑, id. */
export function windowRecords(fixtures, elo, start, end, perDay) {
  const rows = fixtures
    .filter((f) => SHOWN.has(f.status) && f.home_team?.name && f.away_team?.name)
    .map((f) => {
      const time = kickoff(f);
      return { f, time, day: f.time_utc ? parisDayOf(time) : f.date, weight: importance(f, elo) };
    })
    .filter((r) => r.day >= start && r.day <= end)
    .sort((a, b) => a.day.localeCompare(b.day) || b.weight - a.weight || a.time - b.time || a.f.id.localeCompare(b.f.id));
  const count = new Map();
  return rows
    .filter((r) => {
      const n = (count.get(r.day) || 0) + 1;
      count.set(r.day, n);
      return n <= perDay;
    })
    .map((r) => ({ fixture: r.f, time: r.time, day: r.day, weight: round2(r.weight), forecast: r.f.forecast || null }));
}

// ---------- upstream reads (memoised: the upstream is a publication, it does not move during a run) ----------
const memo = new Map();
async function upstreamJson(path) {
  if (!memo.has(path))
    memo.set(
      path,
      fetch(upstream + path, { headers: { accept: "application/json" } }).then(async (r) => {
        if (!r.ok) throw Object.assign(new Error(`upstream ${r.status} ${path}`), { status: r.status });
        return r.json();
      }),
    );
  return memo.get(path).catch((error) => {
    memo.delete(path);
    throw error;
  });
}
const seasonsParam = (season) => [season, season.slice(0, 4)].join(",");
async function fixturesAround(season, today) {
  // One bounded range around both windows (a day of margin for the UTC/Paris days, the weekend before).
  const query = new URLSearchParams({ seasons: seasonsParam(season), from: addDays(today, -3), to: addDays(today, RULES.localAfter + 1), limit: "100" });
  const all = [];
  let cursor = null;
  for (let guard = 0; guard < 50; guard++) {
    const page = await upstreamJson(`/api/fixtures?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    all.push(...(page.data?.matches || []));
    cursor = page.pagination?.nextCursor;
    if (!cursor) break;
  }
  return all;
}
async function eloOf(season) {
  const body = await upstreamJson(`/api/rankings/power?${new URLSearchParams({ kind: "clubs", season, limit: "200" })}`).catch(() => ({ rows: [] }));
  return new Map((body.rows || []).filter((r) => Number.isFinite(r.elo)).map((r) => [r.teamId, r.elo]));
}
async function metaOf() {
  const m = await upstreamJson("/api/dashboard/manifest");
  return {
    generation: String(m.publicationVersion), publishedAt: m.publishedAt, sourceRetrievedAt: m.retrievedAt,
    latestSourceRetrievedAt: m.retrievedAt, startDate: null, endDate: null, partitionCount: 0, missingWatermarks: 0,
  };
}

/** The billboard's Paris days (the real read's billboard_bounds): yesterday → today + 3. */
export function billboardWindowAt(now = NOW) {
  const today = parisDayOf(now);
  return { start: addDays(today, -RULES.billboardBefore), end: addDays(today, RULES.billboardAfter) };
}

export async function billboardFor(params) {
  const season = params.get("season"), leagues = params.get("leagues") || "all";
  const today = parisDayOf(NOW);
  const ids = leagues === "all" ? null : new Set(leagues.split(","));
  const fixtures = (await fixturesAround(season, today)).filter((f) => !ids || ids.has(f.league?.id));
  return windowRecords(fixtures, await eloOf(season), addDays(today, -RULES.billboardBefore), addDays(today, RULES.billboardAfter), RULES.billboardPerDay);
}

export async function homeLocalFor(params) {
  const allowed = new Set(["season", "country", "generation", "media"]);
  const country = params.get("country") || "";
  if ([...params.keys()].some((k) => !allowed.has(k)) || params.getAll("country").length !== 1 || !/^[A-Z]{3}$/.test(country))
    return { status: 400, body: { error: { message: "Pays invalide." } } };
  const season = params.get("season") || "";
  if (!/^\d{4}\/\d{4}$/.test(season)) return { status: 400, body: { error: { message: "Saison invalide." } } };
  const meta = await metaOf();
  if (params.has("generation") && params.get("generation") !== meta.generation)
    return { status: 409, body: { error: { message: "La publication a changé." } } };
  const today = parisDayOf(NOW),
    window = { start: addDays(today, -RULES.localBefore), end: addDays(today, RULES.localAfter) };
  const leagues = ((await upstreamJson("/api/competitions")).data?.leagues || []).filter(
    (l) => l.country_code === country && (l.seasons || []).some((s) => s === season || s === season.slice(0, 4)),
  );
  const ids = new Set(leagues.map((l) => l.id));
  const fixtures = (await fixturesAround(season, today)).filter((f) => ids.has(f.league?.id));
  const elo = await eloOf(season);
  const matches = windowRecords(fixtures, elo, window.start, window.end, RULES.localPerDay);
  // The highest first: the real read orders by the league's level, not public here; the busiest league of the
  // window stands in for it, then the name.
  const busy = (id) => fixtures.filter((f) => f.league?.id === id).length;
  const competitions = leagues
    .sort((a, b) => busy(b.id) - busy(a.id) || a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id))
    .map((l) => ({ id: l.id, name: l.name, country, level: null }));
  let table = null;
  if (competitions[0]) {
    const standings = await upstreamJson(`/api/standings?competition=${competitions[0].id}`).catch(() => null);
    const rows = standings?.tables?.[0]?.rows || [];
    if (rows.length)
      table = {
        leagueId: competitions[0].id, name: competitions[0].name,
        rows: rows.slice(0, RULES.tableRows).map((r) => ({
          id: r.id, name: r.name, imageUrl: r.imageUrl, position: r.position, played: r.played, wins: r.wins, draws: r.draws,
          losses: r.losses, goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, difference: r.difference, points: r.points,
        })),
      };
  }
  return { status: 200, body: { data: { country, window, competitions, matches, table }, meta } };
}

// ---------- the proxy ----------
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "cache-control": "no-store" };
const sendJson = (res, status, body) => res.writeHead(status, { ...CORS, "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));

async function forward(req, res) {
  const r = await fetch(upstream + req.url, { method: req.method, headers: { accept: req.headers.accept || "*/*" } });
  const headers = { ...CORS };
  for (const [k, v] of r.headers) if (!["content-encoding", "content-length", "transfer-encoding", "connection", "etag", "access-control-allow-origin"].includes(k)) headers[k] = v;
  res.writeHead(r.status, headers).end(req.method === "HEAD" ? undefined : Buffer.from(await r.arrayBuffer()));
}

async function handle(req, res) {
  const url = new URL(req.url, "http://overlay");
  if (req.method === "OPTIONS") return res.writeHead(204, CORS).end();
  if (url.pathname === "/__overlay/billboard") {
    if (url.searchParams.has("on")) state.billboard = url.searchParams.get("on") !== "0";
    return sendJson(res, 200, { billboard: state.billboard, now: new Date(NOW).toISOString(), upstream });
  }
  if (req.method === "GET" && url.pathname === "/api/dashboard/manifest") {
    const r = await fetch(upstream + req.url);
    if (!r.ok) return forward(req, res);
    const body = await r.json();
    body.capabilities = { ...body.capabilities, compactReads: { ...body.capabilities?.compactReads } };
    if (body.capabilities.compactReads["home-local"] === undefined) body.capabilities.compactReads["home-local"] = true;
    return sendJson(res, 200, body);
  }
  if (req.method === "GET" && url.pathname === "/api/read/home") {
    const r = await fetch(upstream + req.url, { headers: { accept: "application/json" } });
    if (!r.ok) return forward(req, res);
    const body = await r.json();
    if (body.data && !Object.hasOwn(body.data, "billboard") && state.billboard) {
      body.data.billboard = await billboardFor(url.searchParams);
      body.data.billboardWindow = billboardWindowAt();
    }
    if (body.data && !state.billboard) {
      delete body.data.billboard;
      delete body.data.billboardWindow;
    }
    return sendJson(res, 200, body);
  }
  if (req.method === "GET" && url.pathname === "/api/read/home-local") {
    const real = await fetch(upstream + req.url, { headers: { accept: "application/json" } }).catch(() => null);
    if (real && real.status !== 404) return forward(req, res);
    const { status, body } = await homeLocalFor(url.searchParams);
    return sendJson(res, status, body);
  }
  return forward(req, res);
}

if (import.meta.url === `file://${process.argv[1]}`)
  http
    .createServer((req, res) =>
      handle(req, res).catch((error) => {
        if (!res.headersSent) sendJson(res, 502, { error: { message: String(error?.message || error) } });
      }),
    )
    .listen(Number(port), "127.0.0.1", () => console.log(`home v2 overlay on ${port} → ${upstream}, now ${new Date(NOW).toISOString()}`));

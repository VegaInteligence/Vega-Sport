/** Refresh the receipts from the same handler and type parsers that produce the Lambda's answers. */
import pg from "pg";
import { types } from "./db.mjs";
import { clockOf, relationsOf } from "./data-versions.mjs";
import { createHandler } from "./handler.mjs";
import { FIRST_SEASON, LAST_SEASON, HISTORY_LEAGUES } from "./league-history.mjs";
import { editionSelector, RECEIPT_CODE } from "./read-receipts.mjs";

const routes = {
  "league-history": "/api/league-history",
  matchdays: "/api/matchdays",
  standings: "/api/standings",
  "cup-edition": "/api/cups/edition",
  transfers: "/api/players",
};
const historical = Array.from({ length: LAST_SEASON - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i).reverse()
  .flatMap((start) => Object.keys(HISTORY_LEAGUES).map((league) => editionSelector(league, start)));

function requestFor(route, selector) {
  const [publicId, season] = selector.split("|");
  const url = new URL(routes[route], "https://read-receipt.invalid");
  if (route === "transfers") url.pathname += `/${publicId}/transfers`;
  else {
    url.searchParams.set("competition", publicId);
    if (season) url.searchParams.set("season", route === "league-history" ? `${season}/${Number(season) + 1}` : season);
  }
  // A plain GET always builds the actual body, even if this selection already has a current receipt.
  return new Request(url);
}

async function scopeOf(read, route, selector) {
  const [publicId, season] = selector.split("|");
  if (route === "league-history")
    return { "core.matches": [season, String(Number(season) + 1)], "core.match_events": [season], "core.league_player_seasons": [season] };
  if (route === "matchdays") {
    const rows = await read("SELECT DISTINCT season_id FROM api.matchday_editions($1, $2) LIMIT 17", [publicId, season]);
    return { "core.matches": rows.map((r) => String(r.season_id)) };
  }
  if (route === "transfers") {
    const links = await read("SELECT * FROM api.player_transfer_scope($1) LIMIT 17", [publicId]);
    return { "core.player_transfers": links.map((r) => String(r.player_key)), "ops.transfermarkt_reads": links.map((r) => r.provider_key) };
  }
  return {};
}

async function prepare(client, route, selector) {
  const relations = new Set();
  let clock = false;
  const read = async (sql, values) => {
    for (const name of relationsOf(sql)) relations.add(name);
    clock ||= Boolean(clockOf(sql));
    return (await client.query(sql, values)).rows;
  };
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  try {
    await client.query("SET LOCAL ROLE vega_read");
    const response = await createHandler({ read })(requestFor(route, selector));
    const digest = /^W\/"[a-z0-9-]+-([0-9a-f]{64})"$/.exec(response.headers.get("etag") || "")?.[1] ?? null;
    // Keep so the discovery cursor can progress past known 404s, but never use them to answer a request.
    if (!digest && response.status !== 404) return false;
    const scopes = await scopeOf(read, route, selector);
    if (clock || !relations.size || Object.values(scopes).some((keys) => keys.length > 16)) return false;
    const scopedKeys = Object.entries(scopes).flatMap(([source, values]) => [[source, "*"], ...values.map((value) => [source, value])]);
    await client.query("RESET ROLE");
    const { rows: [saved] } = await client.query("SELECT ops.put_read_receipt($1,$2,$3,$4,$5,$6) AS ok",
      [route, selector, RECEIPT_CODE, [...relations], scopedKeys, digest]);
    await client.query("COMMIT");
    return saved.ok;
  } finally {
    // A response with no usable proof or any error leaves only this selection unprepared.
    if (client.getTransactionStatus() !== "I") await client.query("ROLLBACK");
  }
}

function interleave(byRoute) {
  const groups = Object.keys(routes).map((route) => byRoute.filter((r) => r.route === route));
  const out = [];
  for (let i = 0; i < Math.max(...groups.map((g) => g.length)); i++)
    for (const g of groups) if (g[i]) out.push(g[i]);
  return out;
}

async function refresh(client, budget, check, discover) {
  const found = (await client.query("SELECT * FROM ops.check_read_receipts($1,$2)", [RECEIPT_CODE, check])).rows;
  const dirty = interleave(found);
  const missing = [];
  if (discover) {
    const history = await client.query("SELECT ops.missing_history_receipts($1,$2) AS selector", [historical, budget]);
    missing.push(...history.rows.map((r) => ({ route: "league-history", selector: r.selector })));
    for (const route of Object.keys(routes).slice(1)) {
      const { rows } = await client.query("SELECT ops.discover_read_receipts($1,$2) AS selector", [route, budget]);
      missing.push(...rows.map((r) => ({ route, selector: r.selector })));
    }
  }
  const reserved = Math.min(Math.floor(budget / 2), missing.length);
  const order = dirty.slice(0, budget - reserved).concat(interleave(missing), dirty.slice(budget - reserved)).slice(0, budget);
  const deadline = performance.now() + 4500;
  let prepared = 0;
  for (const { route, selector } of order) {
    if (performance.now() > deadline) break;
    try {
      if (await prepare(client, route, selector)) prepared++;
    } catch (error) {
      console.error("receipt preparation", route, error.code || error.name);
    }
  }
  return prepared;
}

const client = new pg.Client({
  connectionString: process.env.VEGA_RECEIPTS_DSN,
  types,
  connectionTimeoutMillis: 2500,
  options: "-c jit=off -c max_parallel_workers_per_gather=0 -c statement_timeout=2000",
});
try {
  if (!process.env.VEGA_RECEIPTS_DSN) throw new Error("missing receipt database connection");
  await client.connect();
  // Keep one preparer per database. Concurrent ingestion never takes this lock.
  const { rows: [lock] } = await client.query("SELECT pg_try_advisory_lock(92013) AS held");
  if (lock.held) {
    const [budget = "20", check = "200", discover = "1"] = process.argv.slice(2);
    const bounded = (value, cap) => Math.min(cap, Math.max(0, Number.parseInt(value, 10) || 0));
    const prepared = await refresh(client, bounded(budget, 20), bounded(check, 200), discover === "1");
    console.log(prepared);
  }
} catch (error) {
  console.error("receipt refresh", error.code || error.name);
  process.exitCode = 1;
} finally {
  await client.end();
}

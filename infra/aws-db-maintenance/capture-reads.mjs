// Capture the application's actual SQL without connecting to a database.
// A release manifest makes plans reproducible against both the restored copy
// and production, without giving the maintenance worker arbitrary-SQL input.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [source, output, label = "baseline"] = process.argv.slice(2);
if (!source || !output) throw new Error("Usage: capture-reads.mjs REPO OUTPUT [LABEL]");
const service = (name) => import(pathToFileURL(resolve(source, `dashboard/backend/services/${name}.js`)));
const operations = {};
function add(name, sql, values = [], timeoutMs = 30000, maxRows = 1000) {
  operations[name] = { sql, values, parameters: values.length, mode: "read", targets: ["stage", "prod"], timeoutMs, maxRows };
}
add("identity", `SELECT current_database() AS database,current_user AS role,version(),
  pg_database_size(current_database())::text AS database_bytes,
  (SELECT array_agg(extname ORDER BY extname) FROM pg_extension) AS extensions,
  has_schema_privilege(current_user,'statarena_app','CREATE') AS can_create_in_app,
  has_database_privilege(current_user,current_database(),'CREATE') AS can_create_extensions`);
add("schema-inventory", `SELECT n.nspname AS schema,c.relkind,count(*)::int AS relations,
  sum(pg_total_relation_size(c.oid))::text AS total_bytes
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname NOT IN ('information_schema','pg_catalog') AND n.nspname NOT LIKE 'pg_toast%'
  AND c.relkind IN ('r','p','v','m') GROUP BY 1,2 ORDER BY 1,2`);
add("table-health", `SELECT s.schemaname,s.relname,s.n_live_tup,s.n_dead_tup,s.seq_scan,s.seq_tup_read,
  s.idx_scan,s.last_analyze,s.last_autoanalyze,s.last_autovacuum,
  pg_total_relation_size(s.relid)::text AS bytes,pg_get_userbyid(c.relowner) AS owner,
  c.relrowsecurity AS row_security
  FROM pg_stat_user_tables s JOIN pg_class c ON c.oid=s.relid
  WHERE s.schemaname IN ('statarena_app','statarena','statarena_retired') ORDER BY pg_total_relation_size(s.relid) DESC`);
add("runtime-settings", `SELECT name,setting,unit,source FROM pg_settings
  WHERE name IN ('shared_buffers','work_mem','max_connections','effective_cache_size','random_page_cost',
  'track_io_timing','jit','statement_timeout','default_transaction_read_only','shared_preload_libraries') ORDER BY name`);
add("activity", `SELECT application_name,state,wait_event_type,wait_event,count(*)::int AS connections,
  max(extract(epoch FROM now()-query_start))::int AS longest_query_seconds
  FROM pg_stat_activity WHERE datname=current_database() GROUP BY 1,2,3,4 ORDER BY connections DESC`);
add("app-counts", `SELECT 'players' AS entity,count(*)::text AS rows FROM statarena_app.players
  UNION ALL SELECT 'teams',count(*)::text FROM statarena_app.teams
  UNION ALL SELECT 'matches',count(*)::text FROM statarena_app.matches
  UNION ALL SELECT 'appearances',count(*)::text FROM statarena_app.appearances
  UNION ALL SELECT 'fixtures',count(*)::text FROM statarena_app.fixtures
  UNION ALL SELECT 'file_documents',count(*)::text FROM statarena.file_documents`);
add("index-inventory", `SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes
  WHERE schemaname='statarena_app' ORDER BY tablename,indexname`);
add("role-preflight", `SELECT n.nspname,pg_get_userbyid(n.nspowner) AS owner,
  has_schema_privilege('statarena_ingest',n.oid,'CREATE') AS ingest_create,
  has_schema_privilege('statarena_runtime',n.oid,'USAGE') AS runtime_usage
  FROM pg_namespace n WHERE n.nspname IN ('statarena_app','statarena','statarena_retired')`);
const examples = [
  ["search-specific", "relational-discovery", "createDiscoveryRoute", "/api/search?q=mbappe&season=2026%2F2027"],
  ["search-broad", "relational-discovery", "createDiscoveryRoute", "/api/search?q=pa&season=2026%2F2027"],
  ["players", "relational-players", "createPlayerReadRoute", "/api/read/players?season=2026%2F2027&ranking=rating&minutes=1&sort=rating&direction=desc&page=1&limit=20"],
  ["clubs", "relational-clubs", "createClubReadRoute", "/api/read/clubs?season=2026%2F2027&sort=name&direction=asc&page=1&limit=24"],
  ["player", "relational-actors", "createActorRoute", "/api/read/player?season=2026%2F2027&player=p_2e0FPo&limit=100"],
  ["performance", "relational-performance", "createPerformanceRoute", "/api/read/performance?season=2026%2F2027&appearance=m_3Zye1t%3Ap_217YMB"],
];
for (const [name, module, factory, path] of examples) {
  const imported = await service(module);
  let captured;
  const route = imported[factory](async (sql, values) => {
    captured = {sql, values};
    throw new Error("captured");
  });
  const url = new URL(path, "https://vegasport.vercel.app");
  try { await route(new Request(url), url.pathname, url.searchParams); }
  catch (error) { if (!captured) throw error; }
  if (!captured) throw new Error(`No SQL captured for ${path}`);
  add(`${label}-${name}-plan`, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured.sql}`, captured.values, 45000, 10);
  if (name.startsWith("search") || name === "performance") add(`${label}-${name}`, captured.sql, captured.values);
}
if (existsSync(resolve(source, "dashboard/backend/services/relational-player-rollups.js"))) {
  const { playerRollupQuery } = await service("relational-player-rollups");
  const { parsePlayerRead, PLAYER_COUNT_METRICS } = await service("relational-players");
  const params = new URLSearchParams("season=2026%2F2027&ranking=rating&minutes=1&sort=rating&direction=desc&page=1&limit=20");
  const all = playerRollupQuery(parsePlayerRead(params), params, PLAYER_COUNT_METRICS);
  add(`${label}-player-rollup-plan`, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${all.sql}`, all.values, 45000, 10);
  if (process.env.VEGA_MANIFEST_PATH) {
    const manifest = JSON.parse(readFileSync(process.env.VEGA_MANIFEST_PATH, "utf8"));
    const { directoryScopeIds } = await import(pathToFileURL(resolve(source, "dashboard/frontend/src/services/compact-reads.js")));
    const ids = directoryScopeIds(manifest, "2026/2027", "europe", {});
    params.set("leagues", ids.join(",") || "none");
    params.set("basis", "perMatch");
    // Capture the real default scope; leave generation unfenced so the same
    // read can be compared before/after the verified schema cutover.
    const europe = playerRollupQuery(parsePlayerRead(params), params, PLAYER_COUNT_METRICS);
    add(`${label}-player-rollup-europe-plan`, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${europe.sql}`, europe.values, 45000, 10);
  }
}
writeFileSync(output, `${JSON.stringify({version: 1, label, operations}, null, 2)}\n`);
console.log(JSON.stringify({output, operations: Object.keys(operations)}));

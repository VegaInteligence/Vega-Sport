/** Private, temporary maintenance entry. Never imported by the website/API. */
import pg from "pg";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { databaseConnectionOptions } from "../backend/services/database-connection.js";
import { appearanceReadQueries } from "../backend/services/orion-pro-appearances.js";

const host = "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com";
const database = "statarena_prod";
export async function handler(event = {}) {
  if (event.operation === "probe") return { ok: true, operations: ["inspect", "retire_empty_models"] };
  if (!["inspect", "retire_empty_models"].includes(event.operation)) throw new Error("Unsupported maintenance operation");
  const url = new URL(process.env.DATABASE_URL || "");
  if (url.hostname !== host || url.port !== "5432" || url.pathname !== "/" + database)
    throw new Error("Unexpected maintenance database target");
  const root = process.env.LAMBDA_TASK_ROOT;
  if (!root) throw new Error("Use the reviewed temporary Lambda package");
  const ca = readFileSync(root + "/rds-ca.pem", "utf8");
  const client = new pg.Client({ ...databaseConnectionOptions(url.href, ca),
    application_name: "statarena-temporary-maintenance", connectionTimeoutMillis: 5000,
    statement_timeout: 20000, lock_timeout: 5000, query_timeout: 25000 });
  await client.connect();
  try {
    const identity = (await client.query("SELECT current_database() AS database, current_user AS actor")).rows[0];
    if (identity.database !== database) throw new Error("Unexpected connected database");
    if (event.operation === "inspect") {
      await client.query("BEGIN READ ONLY");
      if (event.section === "read_paths") {
        const indexes = (await client.query(`SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes
          WHERE schemaname IN ('statarena','statarena_app','ingest','football','analytics')
          ORDER BY schemaname,tablename,indexname`)).rows;
        const views = (await client.query(`SELECT schemaname,viewname,definition FROM pg_views
          WHERE schemaname IN ('statarena','statarena_app','ingest','football','analytics')
          ORDER BY schemaname,viewname`)).rows;
        const migrations = (await client.query(`SELECT version,content_sha256,applied_at,code_commit
          FROM ingest.schema_migrations ORDER BY version`)).rows;
        const builds = (await client.query(`SELECT b.id::text build_id,b.competition_season_id::text edition_id,
          b.competition_season_revision_id::text edition_revision_id,d.generation::text dg,c.generation::text cg,
          e.competition_id::text competition_id,e.season_key,b.status,b.representation_version
          FROM analytics.aggregation_builds b JOIN ingest.dataset_snapshots d ON d.id=b.dataset_snapshot_id
          JOIN ingest.dataset_snapshots c ON c.id=b.catalog_snapshot_id
          JOIN football.competition_seasons e ON e.revision_id=b.competition_season_revision_id
          WHERE EXISTS(SELECT 1 FROM analytics.publication_versions p WHERE p.build_id=b.id AND p.published_to_gen IS NULL)
          ORDER BY b.id LIMIT 10`)).rows;
        const publications = (await client.query(`SELECT season,league_id,published_at
          FROM statarena_app.partitions ORDER BY season,league_id`)).rows;
        const jobs = (await client.query(`SELECT season,count(*)::text count FROM statarena_app.publication_jobs
          GROUP BY season ORDER BY season`)).rows;
        const plans = [];
        for (const build of builds) {
          const params = JSON.stringify(Object.fromEntries(['build_id','edition_id','edition_revision_id','dg','cg','competition_id']
            .map((key) => [key, build[key]])));
          // EXPLAIN without ANALYZE only plans this fixed SELECT; it does not run
          // the expensive data scan or accept SQL from the invocation event.
          const result = await client.query('EXPLAIN (FORMAT JSON) ' + appearanceReadQueries.admissionSql, [params]);
          plans.push({ build, plan: result.rows[0]['QUERY PLAN'] });
        }
        await client.query("COMMIT");
        return { ok: true, operation: "inspect", section: "read_paths", identity,
          indexes, views, migrations, publications, jobs, plans };
      }
      const tables = (await client.query(`SELECT n.nspname AS schema,c.relname AS name,c.relkind,
        pg_total_relation_size(c.oid)::text AS bytes,s.n_live_tup::text AS estimated_rows,
        s.seq_scan::text,s.idx_scan::text,s.last_analyze,s.last_autoanalyze
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_stat_all_tables s ON s.relid=c.oid
        WHERE n.nspname IN ('statarena','statarena_app','ingest','football','analytics') AND c.relkind IN ('r','p','m')
        ORDER BY n.nspname,c.relname`)).rows;
      const columns = (await client.query(`SELECT c.table_schema AS schema,c.table_name AS table,c.column_name AS name,
        c.data_type,c.is_nullable,c.column_default,s.null_frac AS estimated_null_fraction
        FROM information_schema.columns c LEFT JOIN pg_stats s ON s.schemaname=c.table_schema
        AND s.tablename=c.table_name AND s.attname=c.column_name
        WHERE c.table_schema IN ('statarena','statarena_app','ingest','football','analytics')
        ORDER BY c.table_schema,c.table_name,c.ordinal_position`)).rows;
      const dependencies = (await client.query(`SELECT n.nspname AS schema,c.relname AS table,k.conname,
        pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('statarena','statarena_app','ingest','football','analytics')
        AND k.contype='f' ORDER BY n.nspname,c.relname,k.conname`)).rows;
      await client.query("COMMIT");
      return { ok: true, operation: "inspect", identity, tables, columns, dependencies,
        note: "Row and null estimates are planner statistics; they are not proof that a table or column is unused." };
    }
    // The caller must first verify an AVAILABLE snapshot of this exact instance.
    // No generic SQL input, credential output, public URL or data export exists.
    if (!/^statarena-before-cleanup-[a-z0-9-]{1,50}$/.test(event.verifiedSnapshotId || ""))
      throw new Error("A verified pre-cleanup snapshot identifier is required");
    if (!/^[a-f0-9]{40}$/.test(event.codeCommit || ""))
      throw new Error("The reviewed source commit is required");
    const sql = readFileSync(root + "/retire-models.sql", "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    if (event.expectedMigrationSha256 !== checksum) throw new Error("Unexpected migration checksum");
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(20261104, 2)");
    const previous = (await client.query("SELECT content_sha256 FROM ingest.schema_migrations WHERE version='019'")).rows[0];
    if (previous && previous.content_sha256 !== checksum)
      throw new Error("Applied migration 019 has a different checksum");
    if (!previous) {
      await client.query(sql);
      await client.query("INSERT INTO ingest.schema_migrations(version,content_sha256,applied_at,code_commit) VALUES('019',$1,clock_timestamp(),$2)",
        [checksum, event.codeCommit]);
    }
    await client.query("COMMIT");
    return { ok: true, operation: "retire_empty_models", reused: Boolean(previous), migrationSha256: checksum, snapshotId: event.verifiedSnapshotId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

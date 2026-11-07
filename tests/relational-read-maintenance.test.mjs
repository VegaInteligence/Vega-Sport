import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

test(
  "read-model maintenance thresholds are valid, table-local and preserve tuples, ACLs and storage options",
  { skip: !process.env.VEGA_TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.VEGA_TEST_DATABASE_URL);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
    const requireLocal = createRequire(
      new URL("../dashboard/package.json", import.meta.url),
    );
    const { Client } = requireLocal("pg");
    const client = new Client({ connectionString: url.href });
    await client.connect();
    const names = [
      "appearances",
      "player_season_rollups",
      "catalog_records",
      "detail_records",
    ];
    const sql = readFileSync(
      new URL(
        "../dashboard/backend/migrations/034_read_model_autovacuum.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const globalSettings = async () =>
      (
        await client.query(`SELECT name,setting FROM pg_settings WHERE name IN (
        'autovacuum','autovacuum_max_workers','autovacuum_naptime',
        'autovacuum_vacuum_cost_delay','autovacuum_vacuum_cost_limit',
        'autovacuum_freeze_max_age','autovacuum_vacuum_threshold',
        'autovacuum_vacuum_scale_factor','autovacuum_analyze_threshold',
        'autovacuum_analyze_scale_factor') ORDER BY name`)
      ).rows;
    const relationState = async () =>
      (
        await client.query(`SELECT oid,relname,relowner,relacl::text,relfilenode,
        (SELECT jsonb_object_agg(option_name,option_value) FROM pg_options_to_table(c.reloptions)) AS options
        FROM pg_class c WHERE relnamespace='statarena_app'::regnamespace ORDER BY relname`)
      ).rows;
    const tuples = async () => {
      const result = {};
      for (const name of names)
        result[name] = (
          await client.query(`SELECT id,ctid::text,
          encode(jsonb_send(payload),'hex') AS binary FROM statarena_app.${name} ORDER BY id`)
        ).rows;
      return result;
    };
    try {
      await client.query("BEGIN; CREATE SCHEMA statarena_app");
      for (const name of names) {
        await client.query(`CREATE TABLE statarena_app.${name}(
          id integer PRIMARY KEY,payload jsonb NOT NULL
        ) WITH(fillfactor=90,toast_tuple_target=512);
        INSERT INTO statarena_app.${name} VALUES(1,'{"value":0,"absent":null}'),(2,'{"value":1.2345678901234567}');
        GRANT SELECT ON statarena_app.${name} TO PUBLIC`);
      }
      await client.query(
        "CREATE TABLE statarena_app.unrelated(id integer); CREATE TABLE statarena_app.support_records(id integer)",
      );
      const settings = await globalSettings();
      const before = await relationState();
      const rows = await tuples();
      await client.query(sql);
      const after = await relationState();
      const stripOptions = (state) => state.map(({ options, ...row }) => row);
      assert.deepEqual(stripOptions(after), stripOptions(before));
      assert.deepEqual(await tuples(), rows);
      assert.deepEqual(await globalSettings(), settings);
      const policy = (
        vacuum,
        vacuumScale,
        inserts,
        insertScale,
        analyze,
        analyzeScale,
      ) => ({
        autovacuum_enabled: "true",
        autovacuum_vacuum_threshold: String(vacuum),
        autovacuum_vacuum_scale_factor: String(vacuumScale),
        autovacuum_vacuum_insert_threshold: String(inserts),
        autovacuum_vacuum_insert_scale_factor: String(insertScale),
        autovacuum_analyze_threshold: String(analyze),
        autovacuum_analyze_scale_factor: String(analyzeScale),
      });
      for (const name of names) {
        const prior = before.find((row) => row.relname === name).options;
        const actual = after.find((row) => row.relname === name).options;
        const expected =
          name === "appearances"
            ? policy(500, 0.01, 500, 0.005, 250, 0.002)
            : name === "player_season_rollups"
              ? policy(200, 0.01, 200, 0.01, 100, 0.01)
              : policy(2000, 0.02, 2000, 0.02, 1000, 0.005);
        assert.deepEqual(actual, { ...prior, ...expected });
        assert.ok(Number(actual.autovacuum_vacuum_threshold) > 0);
        assert.ok(Number(actual.autovacuum_vacuum_insert_threshold) > 0);
      }
      assert.deepEqual(
        after.find((row) => row.relname === "unrelated"),
        before.find((row) => row.relname === "unrelated"),
      );
      assert.deepEqual(
        after.find((row) => row.relname === "support_records"),
        before.find((row) => row.relname === "support_records"),
      );
      await client.query(sql);
      assert.deepEqual(await relationState(), after);
      assert.deepEqual(await tuples(), rows);
      assert.deepEqual(await globalSettings(), settings);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  },
);

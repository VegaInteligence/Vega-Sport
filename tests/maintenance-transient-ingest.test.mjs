import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "../dashboard/node_modules/pg/lib/index.js";
import archiveModel from "../dashboard/backend/services/archive-projection-model.json" with { type: "json" };

test("transient ingestion pins production, expires work, clears credentials and retains the ordinary stage worker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vega-transient-ingest-"));
  const now = Date.now();
  const read = {
    sql: "SELECT 'reviewed read'",
    mode: "read",
    targets: ["prod"],
    parameters: 0,
  };
  const write = {
    sql: "SELECT 'reviewed batch'",
    mode: "write",
    targets: ["prod"],
    parameters: 1,
    timeoutMs: 35000,
  };
  const archive = {
    kind: "archive-refresh",
    mode: "write",
    targets: ["prod"],
    parameters: 1,
  };
  const vacuum = {
    kind: "vacuum-analyze",
    table: "statarena_app.appearances",
    mode: "write",
    targets: ["prod"],
    parameters: 0,
  };
  const release = {
    format: "vega.transient-ingest.v1",
    issuedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 3600000).toISOString(),
    operations: { read, write, archive, vacuum },
  };
  await writeFile(join(dir, "operations.json"), JSON.stringify(release));
  await writeFile(join(dir, "rds-ca.pem"), "fixture-ca");
  const keys = [
    "LAMBDA_TASK_ROOT",
    "DATABASE_CONFIG",
    "DATABASE_TARGET",
    "EXPECTED_DATABASE_HOST",
    "ALLOW_WRITES",
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  const config = {
    host: "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com",
    port: 5432,
    database: "statarena_prod",
    username: "statarena_ingest",
  };
  const OriginalClient = pg.Client,
    realNow = Date.now;
  const clients = [];
  let identity = "statarena_ingest",
    fail = false,
    expireDuringWrite = false,
    connectFail = false;
  class Client {
    constructor(options) {
      this.connectionParameters = options;
      this.password = options.password;
      this.queries = [];
      clients.push(this);
    }
    async connect() {
      if (connectFail)
        throw Object.assign(
          new Error("secret-fixture-credential connection failure"),
          { code: "28P01" },
        );
      this.connected = true;
    }
    async query(statement, values) {
      const q =
        typeof statement === "string" ? { text: statement, values } : statement;
      this.queries.push(structuredClone(q));
      if (
        q.text === "SELECT current_user AS role,current_database() AS database"
      )
        return { rows: [{ role: identity, database: "statarena_prod" }] };
      if (q.text.includes("pg_try_advisory_lock"))
        return { rows: [{ acquired: true }] };
      if (q.text.includes("AS owned FROM pg_class"))
        return { rows: [{ owned: true }] };
      if (q.text.includes("to_regclass('statarena_app.consolidation_state')"))
        return { rows: [{ table_name: null }] };
      if (q.text === archiveModel.metadata)
        return {
          rows: [
            {
              source_fence: { editions: [], expected_scopes: [] },
              projection: null,
            },
          ],
        };
      if (q.text === write.sql && expireDuringWrite)
        Date.now = () => now + 20000;
      if (q.text === write.sql && fail)
        throw Object.assign(
          new Error("secret-fixture-credential must stay private"),
          { code: "XX001" },
        );
      return {
        rows:
          q.text === read.sql || q.text === write.sql ? [{ done: true }] : [],
        command: "SELECT",
        rowCount: 1,
      };
    }
    async end() {
      this.closed = true;
    }
  }
  pg.Client = Client;
  Object.assign(process.env, {
    LAMBDA_TASK_ROOT: dir,
    DATABASE_CONFIG: JSON.stringify(config),
    DATABASE_TARGET: "prod",
    EXPECTED_DATABASE_HOST: config.host,
    ALLOW_WRITES: "true",
  });
  try {
    const { handler } =
      await import("../infra/aws-db-maintenance/transient-ingest.mjs");
    const { handler: ordinary, maintenanceManifest: manifest } =
      await import("../infra/aws-db-maintenance/index.mjs");
    const digest = (value) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const request = (name = "read", values) => ({
      operation: name,
      operationHash: digest(manifest.operations[name]),
      password: "secret-fixture-credential",
      ...(values && { values }),
    });
    const rejectBeforeClient = async (input, pattern) => {
      const count = clients.length;
      await assert.rejects(handler(input), pattern);
      assert.equal(clients.length, count);
      assert.equal(input.password, undefined);
    };
    for (const extra of [
      { sql: "SELECT arbitrary" },
      { host: "other" },
      { username: "statarena_admin" },
      { target: "stage" },
      { config: { password: "bad" } },
    ])
      await rejectBeforeClient({ ...request(), ...extra }, /request fields/);
    await rejectBeforeClient(
      { ...request(), operationHash: "bad" },
      /release hash/,
    );
    const initialWindow = {
      issuedAt: manifest.issuedAt,
      expiresAt: manifest.expiresAt,
    };
    for (const change of [
      { expiresAt: new Date(now - 1).toISOString() },
      { expiresAt: new Date(now + 5 * 3600000).toISOString() },
      { issuedAt: new Date(now + 10000).toISOString() },
      { issuedAt: "invalid" },
      { issuedAt: "2026-11-07T04:00:00" },
    ]) {
      Object.assign(manifest, change);
      await rejectBeforeClient(request(), /release.*window/);
      Object.assign(manifest, initialWindow);
    }
    manifest.operations["transfer-authorize"] = { ...write };
    await rejectBeforeClient(request(), /admin operation/);
    delete manifest.operations["transfer-authorize"];
    manifest.operations.read.targets = ["stage"];
    await rejectBeforeClient(request(), /target/);
    manifest.operations.read.targets = ["prod"];
    for (const change of [
      { username: "statarena_admin" },
      { host: "other" },
      { password: "persistent-secret" },
      { port: 9999 },
    ]) {
      process.env.DATABASE_CONFIG = JSON.stringify({ ...config, ...change });
      await rejectBeforeClient(request(), /fixed identity.*no password/);
    }
    process.env.DATABASE_CONFIG = JSON.stringify(config);
    process.env.ALLOW_WRITES = "false";
    await rejectBeforeClient(request("write", ["reviewed"]), /read-only/);
    process.env.ALLOW_WRITES = "true";

    const input = request(),
      output = await handler(input),
      first = clients.at(-1);
    assert.equal(output.ok, true);
    assert.ok(first.queries.some((q) => q.text === "BEGIN READ ONLY"));
    assert.ok(first.queries.some((q) => q.text === read.sql));
    assert.equal(first.queries.at(-1).text, "COMMIT");
    assert.equal(first.connectionParameters.user, "statarena_ingest");
    assert.equal(first.connectionParameters.host, config.host);
    assert.equal(input.password, undefined);
    assert.equal(process.env.DATABASE_CONFIG, JSON.stringify(config));
    const params = [{ table: "reviewed", checkpoint: 7 }];
    assert.equal((await handler(request("write", params))).ok, true);
    assert.deepEqual(
      clients.at(-1).queries.find((q) => q.text === write.sql).values,
      params,
    );
    assert.ok(
      clients
        .at(-1)
        .queries.every((q) => q.query_timeout > 0 && q.query_timeout <= 35000),
    );

    identity = "statarena_runtime";
    const wrong = await handler(request("write", params));
    assert.equal(wrong.code, "TRANSIENT_IDENTITY");
    assert.ok(!clients.at(-1).queries.some((q) => q.text === write.sql));
    assert.equal(clients.at(-1).queries.at(-1).text, "ROLLBACK");
    identity = "statarena_ingest";
    fail = true;
    const failed = await handler(request("write", params));
    assert.equal(failed.code, "XX001");
    assert.equal(Object.hasOwn(failed, "message"), false);
    assert.ok(!JSON.stringify(failed).includes("secret-fixture-credential"));
    fail = false;
    connectFail = true;
    const disconnected = await handler(request());
    assert.equal(disconnected.code, "28P01");
    assert.equal(Object.hasOwn(disconnected, "message"), false);
    assert.equal(clients.at(-1).queries.length, 0);
    connectFail = false;

    manifest.expiresAt = new Date(now + 10000).toISOString();
    expireDuringWrite = true;
    const expired = await handler(request("write", params));
    assert.equal(expired.code, "TRANSIENT_DEADLINE");
    assert.equal(expired.committedIterations, 0);
    assert.equal(clients.at(-1).queries.at(-1).text, "ROLLBACK");
    assert.ok(!clients.at(-1).queries.some((q) => q.text === "COMMIT"));
    const budgets = clients
      .at(-1)
      .queries.filter(
        (q) => q.text === "SELECT set_config('statement_timeout',$1,false)",
      )
      .map((q) => parseInt(q.values[0], 10));
    assert.ok(budgets.length > 0 && budgets.every((n) => n > 0 && n <= 9000));
    Date.now = realNow;
    expireDuringWrite = false;
    Object.assign(manifest, initialWindow);

    const archived = await handler(request("archive", ["2023/2024"]));
    assert.equal(archived.ok, true);
    assert.equal(archived.rows[0].ready, false);
    assert.ok(
      clients.at(-1).queries.some((q) => q.text === archiveModel.metadata),
    );
    assert.ok(
      !clients.at(-1).queries.some((q) => q.text === archiveModel.source),
    );
    const vacuumed = await handler(request("vacuum"));
    assert.equal(vacuumed.ok, true);
    assert.ok(
      clients
        .at(-1)
        .queries.some(
          (q) => q.text === "VACUUM (ANALYZE) statarena_app.appearances",
        ),
    );
    assert.equal(
      clients.at(-1).queries.at(-1).text,
      "SELECT pg_advisory_unlock(97813003)",
    );
    for (const client of clients) {
      assert.equal(client.password, undefined);
      assert.equal(client.connectionParameters.password, undefined);
      assert.equal(client.closed, true);
    }

    // The existing stage entrypoint keeps its metadata/credential contract and
    // does not adopt transient-only identity queries or timeout wrappers.
    const stageConfig = {
      ...config,
      host: "fixture-stage.us-east-2.rds.amazonaws.com",
      password: "stage-fixture",
    };
    Object.assign(process.env, {
      DATABASE_TARGET: "stage",
      EXPECTED_DATABASE_HOST: stageConfig.host,
      DATABASE_CONFIG: JSON.stringify(stageConfig),
    });
    manifest.operations.read.targets = ["stage"];
    const stage = await ordinary({
      operation: "read",
      operationHash: digest(manifest.operations.read),
    });
    assert.equal(stage.ok, true);
    assert.equal(stage.target, "stage");
    assert.ok(
      !clients
        .at(-1)
        .queries.some(
          (q) =>
            q.text ===
            "SELECT current_user AS role,current_database() AS database",
        ),
    );
    assert.ok(
      !clients
        .at(-1)
        .queries.some(
          (q) => q.text === "SELECT set_config('statement_timeout',$1,false)",
        ),
    );
    assert.equal(process.env.DATABASE_CONFIG, JSON.stringify(stageConfig));
  } finally {
    Date.now = realNow;
    pg.Client = OriginalClient;
    for (const key of keys)
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    await rm(dir, { recursive: true, force: true });
  }
});

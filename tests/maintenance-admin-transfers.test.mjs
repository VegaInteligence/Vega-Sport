import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "../dashboard/node_modules/pg/lib/index.js";

const host = "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com";
const secret = "transient-admin-fixture-secret";
const owners = ["statarena_admin", "statarena_ingest"];
const tables = ["neon_delta_documents", "neon_delta_queue"];
const definitions = {
  "transfer-owner-preflight": ["SELECT statarena_app.legacy_transfer_preflight($1) AS receipt", "read"],
  "transfer-authorize": ["SELECT statarena_app.legacy_transfer_authorize($1::text[]) AS receipt", "write"],
  "transfer-archive": ["SELECT statarena_app.legacy_transfer_archive($1::jsonb) AS receipt", "write"],
  "transfer-rollback": ["SELECT statarena_app.legacy_transfer_rollback($1::jsonb) AS receipt", "write"],
};
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone = value => structuredClone(value);
function preflight(archived = false) {
  const blockers = Object.fromEntries(["foreign_keys", "triggers", "rules", "inheritance", "policies", "row_security",
    "publications", "extension_membership", "external_dependencies", "function_text_references"].map(key => [key, 0]));
  return {format: "vega.legacy-transfer.v1", database: "statarena_prod", owner: "statarena_admin",
    schema: archived ? "statarena_legacy_transfer" : "statarena", schema_owner: "statarena_admin",
    tables: Object.fromEntries(tables.map((name, i) => [name, {oid: String(1000 + i), rows: String(7584 + i),
      owner: "statarena_admin", acl: null, catalog_md5: "a".repeat(32), blockers: clone(blockers)}]))};
}
function archival(before = preflight(), status = "archived") {
  return {format: "vega.legacy-transfer.receipt.v1", owner: "statarena_admin", status,
    before: clone(before), after: {...clone(before), schema: "statarena_legacy_transfer"}};
}
let imports = 0;
async function fixture(run, alterManifest = () => {}) {
  const dir = await mkdtemp(join(tmpdir(), "vega-admin-transfers-"));
  const manifest = {format: "vega.transient-admin-transfers.v1", issuedAt: new Date(Date.now() - 60000).toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), operations: Object.fromEntries(
      Object.entries(definitions).map(([name, [sql, mode]]) => [name, {sql, mode, parameters: 1, maxRows: 1, timeoutMs: 20000, targets: ["prod"]}]))};
  alterManifest(manifest);
  await writeFile(join(dir, "operations.json"), JSON.stringify(manifest));
  await writeFile(join(dir, "rds-ca.pem"), "fixture-ca");
  const keys = ["LAMBDA_TASK_ROOT", "DATABASE_TARGET", "ALLOW_WRITES", "EXPECTED_DATABASE_HOST", "DATABASE_CONFIG"];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const config = {host, database: "statarena_prod", username: "statarena_admin"};
  Object.assign(process.env, {LAMBDA_TASK_ROOT: dir, DATABASE_TARGET: "prod", ALLOW_WRITES: "true",
    EXPECTED_DATABASE_HOST: host, DATABASE_CONFIG: JSON.stringify(config)});
  const OriginalClient = pg.Client, clients = [];
  const state = {lease: "immediate", fail: false, connectFail: false, wrongIdentity: false,
    changeResult: false, afterOperation: () => {}};
  const blocker = {pid: 123, application_name: "statarena-ingestion", state: "active",
    wait_event_type: null, wait_event: null, transaction_seconds: 1, query_seconds: 1};
  class Client {
    constructor(config) {
      this.connectionParameters = config;
      this.password = config.password;
      this.statements = [];
      clients.push(this);
    }
    async connect() {
      if (state.connectFail) throw Object.assign(new Error(secret), {code: "28P01"});
      this.connected = true;
    }
    async query(input, values) {
      const request = typeof input === "string" ? {text: input, values} : input;
      const sql = request.text;
      this.statements.push(request);
      if (sql === "ROLLBACK" || sql === "ROLLBACK TO SAVEPOINT transfer_lease") this.aborted = false;
      if (this.aborted) throw Object.assign(new Error(secret), {code: "25P02"});
      if (sql.includes("pg_try_advisory_xact_lock")) return {rows: [{role: state.wrongIdentity ? "statarena_ingest" : "statarena_admin",
        database: "statarena_prod", lease: state.lease === "immediate"}]};
      if (sql === "SELECT pg_advisory_xact_lock(97813003)") {
        assert.match(this.connectionParameters.options, /(?:^| )-c lock_timeout=2000(?: |$)/);
        if (["timeout", "wait-error"].includes(state.lease)) {
          this.aborted = true;
          throw Object.assign(new Error(secret), {code: state.lease === "timeout" ? "55P03" : "40P01"});
        }
      }
      if (sql.includes("FROM pg_locks")) return {rows: [blocker]};
      const selected = Object.entries(definitions).find(([, [text]]) => text === sql)?.[0];
      if (!selected) return {rows: []};
      if (state.fail) {
        this.aborted = true;
        throw Object.assign(new Error(`Exact source receipt changed: ${secret}`), {code: "P0001"});
      }
      let receipt;
      if (selected === "transfer-owner-preflight") receipt = preflight(request.values[0]);
      if (selected === "transfer-authorize") receipt = {schema: "statarena_legacy_transfer", authorized_by: "statarena_admin", owners};
      if (selected === "transfer-archive") receipt = archival(request.values[0]);
      if (selected === "transfer-rollback") receipt = archival(request.values[0].before, "restored");
      if (state.changeResult) receipt.before.tables.neon_delta_queue.rows = "999";
      state.afterOperation();
      return {rows: [{receipt}]};
    }
    async end() { this.closed = true; }
  }
  pg.Client = Client;
  try {
    const {handler} = await import(`../infra/aws-db-maintenance/admin-transfers.mjs?fixture=${++imports}`);
    const request = (operation = "transfer-owner-preflight", values = [false]) =>
      ({operation, operationHash: hash(manifest.operations[operation]), values, password: secret});
    await run({handler, request, clients, state, config, manifest, blocker});
  } finally {
    pg.Client = OriginalClient;
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    await rm(dir, {recursive: true, force: true});
  }
}
function cleared(input, client, output) {
  assert.equal(input.password, undefined);
  if (client) {
    assert.equal(client.password, undefined);
    assert.equal(client.connectionParameters.password, undefined);
    assert.equal(client.closed, true);
    assert.equal(client.connectionParameters.host, host);
    assert.equal(client.connectionParameters.user, "statarena_admin");
    assert.ok(client.statements.every(q => !/(?:pg_terminate_backend|pg_cancel_backend)/i.test(q.text)));
  }
  assert.ok(!JSON.stringify(output ?? {}).includes(secret));
}

test("admin transfer handler keeps explicit owner receipts and a finite transient authority", async t => {
  await t.test("each approved operation executes only its fixed statement and clears the credential", () => fixture(async ({handler, request, clients}) => {
    for (const [operation, values] of [["transfer-owner-preflight", [false]], ["transfer-owner-preflight", [true]],
      ["transfer-authorize", [owners]], ["transfer-archive", [preflight()]], ["transfer-rollback", [archival()]]]) {
      const input = request(operation, values), output = await handler(input), client = clients.at(-1);
      assert.equal(output.ok, true);
      assert.equal(client.statements[0].text, operation === "transfer-owner-preflight" ? "BEGIN READ ONLY" : "BEGIN");
      const operations = client.statements.filter(q => Object.values(definitions).some(([sql]) => sql === q.text));
      assert.equal(operations.length, 1);
      assert.equal(operations[0].text, definitions[operation][0]);
      assert.deepEqual(operations[0].values, values);
      assert.equal(client.statements.at(-1).text, "COMMIT");
      cleared(input, client, output);
    }
    assert.ok(!process.env.DATABASE_CONFIG.includes(secret));
  }));

  await t.test("unreviewed fields, hashes, identities and parameter shapes fail before connecting", () => fixture(async ({handler, request, clients, config}) => {
    const invalid = [
      {...request(), sql: "SELECT arbitrary"}, {...request(), host: "other"}, {...request(), user: "other"},
      {...request(), operationHash: "different"}, {...request(), operation: "constructor"},
      request("transfer-owner-preflight", ["false"]), request("transfer-authorize", [["statarena_admin"]]),
      request("transfer-authorize", [[...owners].reverse()]), request("transfer-owner-preflight", [false, true]),
    ];
    for (const input of invalid) { await assert.rejects(handler(input)); cleared(input); }
    for (const bad of [{...config, password: secret}, {...config, username: "statarena_ingest"}, {...config, host: "other"}, {...config, port: 5433}]) {
      process.env.DATABASE_CONFIG = JSON.stringify(bad);
      const input = request(); await assert.rejects(handler(input)); cleared(input);
    }
    process.env.DATABASE_CONFIG = JSON.stringify(config);
    process.env.DATABASE_TARGET = "stage";
    const input = request(); await assert.rejects(handler(input)); cleared(input);
    assert.equal(clients.length, 0);
  }));

  await t.test("wrong-owner, partial, blocked and internally altered receipts are rejected without automatic preflight", () => fixture(async ({handler, request, clients}) => {
    const wrongOwner = preflight(); wrongOwner.owner = "statarena_ingest";
    const partial = preflight(); delete partial.tables.neon_delta_queue;
    const extra = preflight(); extra.tables.neon_job_delta = clone(extra.tables.neon_delta_queue);
    const blocked = preflight(); blocked.tables.neon_delta_queue.blockers.triggers = 1;
    const wrongSchema = preflight(true);
    const altered = archival(); altered.after.tables.neon_delta_queue.rows = "999";
    for (const value of [wrongOwner, partial, extra, blocked, wrongSchema]) {
      const input = request("transfer-archive", [value]); await assert.rejects(handler(input)); cleared(input);
    }
    const input = request("transfer-rollback", [altered]); await assert.rejects(handler(input)); cleared(input);
    assert.equal(clients.length, 0);
  }));

  await t.test("release SQL, operation inventory, target and four-hour bounds are immutable", async () => {
    const invalid = [
      m => {m.operations["transfer-archive"].sql += "; SELECT 1";},
      m => {m.operations.arbitrary = clone(m.operations["transfer-archive"]);},
      m => {m.operations["transfer-archive"].targets = ["prod", "stage"];},
      m => {m.operations["transfer-archive"].repeat = "progress.complete";},
      m => {m.format = "vega.transient-ingest.v1";},
      m => {delete m.issuedAt;},
      m => {m.issuedAt = new Date(Date.now() + 60000).toISOString();},
      m => {m.expiresAt = new Date(Date.now() - 1).toISOString();},
      m => {m.expiresAt = new Date(Date.now() + 5 * 3600000).toISOString();},
    ];
    for (const alter of invalid) await fixture(async ({handler, request, clients}) => {
      const input = request(); await assert.rejects(handler(input)); cleared(input); assert.equal(clients.length, 0);
    }, alter);
  });

  await t.test("read-only mode still permits inspection and never upgrades an invocation to a write", () => fixture(async ({handler, request, clients}) => {
    process.env.ALLOW_WRITES = "false";
    const input = request("transfer-archive", [preflight()]); await assert.rejects(handler(input)); cleared(input);
    assert.equal(clients.length, 0);
    const inspect = request(), output = await handler(inspect); assert.equal(output.ok, true);
    cleared(inspect, clients.at(-1), output);
  }));

  await t.test("a busy lease waits once under a savepoint and executes only after acquisition", () => fixture(async ({handler, request, clients, state}) => {
    state.lease = "wait";
    const input = request("transfer-archive", [preflight()]), output = await handler(input), client = clients.at(-1);
    assert.equal(output.ok, true);
    const commands = client.statements.map(q => q.text).filter(sql => !sql.includes("set_config"));
    assert.deepEqual(commands.slice(2,5), ["SAVEPOINT transfer_lease", "SELECT pg_advisory_xact_lock(97813003)", "RELEASE SAVEPOINT transfer_lease"]);
    assert.equal(commands.filter(sql => sql === "SELECT pg_advisory_xact_lock(97813003)").length, 1);
    assert.equal(commands.some(sql => sql.includes("FROM pg_locks")), false);
    cleared(input, client, output);
  }));

  await t.test("lease timeout restores the savepoint before safe blocker inspection and never writes", () => fixture(async ({handler, request, clients, state, blocker}) => {
    state.lease = "timeout";
    const input = request("transfer-archive", [preflight()]), output = await handler(input), client = clients.at(-1);
    assert.equal(output.code, "ADMIN_TRANSFER_LEASE_BUSY");
    assert.deepEqual(output.blockers, [blocker]);
    const commands = client.statements.map(q => q.text).filter(sql => !sql.includes("set_config"));
    assert.deepEqual(commands.slice(2,6), ["SAVEPOINT transfer_lease", "SELECT pg_advisory_xact_lock(97813003)",
      "ROLLBACK TO SAVEPOINT transfer_lease", "RELEASE SAVEPOINT transfer_lease"]);
    assert.equal(commands.at(-1), "ROLLBACK");
    assert.ok(!commands.includes(definitions["transfer-archive"][0]));
    cleared(input, client, output);
  }));

  await t.test("unexpected lock errors and wrong server identity stop before the reviewed operation", () => fixture(async ({handler, request, clients, state}) => {
    for (const mode of ["wait-error", "identity"]) {
      state.lease = mode === "identity" ? "immediate" : mode; state.wrongIdentity = mode === "identity";
      const input = request(), output = await handler(input), client = clients.at(-1);
      assert.equal(output.code, mode === "identity" ? "ADMIN_TRANSFER_IDENTITY" : "40P01");
      assert.equal(client.statements.at(-1).text, "ROLLBACK");
      assert.equal(client.statements.some(q => q.text.includes("FROM pg_locks") || q.text === definitions["transfer-owner-preflight"][0]), false);
      cleared(input, client, output);
    }
  }));

  await t.test("stale database evidence and mismatched result receipts roll back without leaking error text", () => fixture(async ({handler, request, clients, state}) => {
    for (const mode of ["failure", "result"]) {
      state.fail = mode === "failure"; state.changeResult = mode === "result";
      const input = request("transfer-archive", [preflight()]), output = await handler(input), client = clients.at(-1);
      assert.equal(output.ok, false);
      assert.equal(output.code, mode === "failure" ? "P0001" : "ADMIN_TRANSFER_FAILED");
      assert.equal(client.statements.at(-1).text, "ROLLBACK");
      assert.equal(client.statements.filter(q => Object.values(definitions).some(([sql]) => sql === q.text)).length, 1);
      cleared(input, client, output);
    }
  }));

  await t.test("exhausting the work deadline after execution rolls back before commit", async t => {
    let clock = 100;
    t.mock.method(performance, "now", () => clock);
    await fixture(async ({handler, request, clients, state}) => {
      state.afterOperation = () => {clock += 45000;};
      const input = request("transfer-archive", [preflight()]), output = await handler(input), client = clients.at(-1);
      assert.equal(output.code, "ADMIN_TRANSFER_DEADLINE");
      assert.equal(client.statements.at(-1).text, "ROLLBACK");
      assert.equal(client.statements.some(q => q.text === "COMMIT"), false);
      assert.ok(client.statements.every(q => q.query_timeout > 0 && q.query_timeout <= 44000));
      cleared(input, client, output);
    });
  });

  await t.test("failed connection still closes the client and erases both credential copies", () => fixture(async ({handler, request, clients, state}) => {
    state.connectFail = true;
    const input = request(), output = await handler(input), client = clients.at(-1);
    assert.equal(output.code, "28P01");
    assert.equal(client.statements.length, 0);
    cleared(input, client, output);
  }));
});

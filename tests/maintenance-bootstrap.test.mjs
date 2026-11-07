import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "../dashboard/node_modules/pg/lib/index.js";

test("bootstrap pins SQL and role while keeping the admin credential out of deployment state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vega-bootstrap-contract-"));
  const operation = { sql: "SELECT 'fixed bootstrap statement'", mode: "write", parameters: 0, targets: ["prod"] };
  const operationHash = createHash("sha256").update(JSON.stringify(operation)).digest("hex");
  await writeFile(join(dir, "operations.json"), JSON.stringify({operations:{"bootstrap-consolidation":operation}}));
  await writeFile(join(dir, "rds-ca.pem"), "test-ca");
  const keys = ["LAMBDA_TASK_ROOT", "DATABASE_TARGET", "ALLOW_WRITES", "EXPECTED_DATABASE_HOST", "DATABASE_CONFIG"];
  const prior = Object.fromEntries(keys.map((key)=>[key,process.env[key]]));
  const OriginalClient = pg.Client;
  const clients = [];
  let lease = "immediate", fail = false;
  const blocker = {pid:123,application_name:"statarena-ingestion",state:"active",wait_event_type:null,wait_event:null,transaction_seconds:1,query_seconds:1};
  class Client {
    constructor(config) {
      this.connectionParameters = config;
      this.password = config.password;
      this.statements = [];
      clients.push(this);
    }
    async connect() { this.connected = true; }
    async query(sql) {
      this.statements.push(sql);
      if (sql === "ROLLBACK" || sql === "ROLLBACK TO SAVEPOINT bootstrap_lease") this.aborted = false;
      if (this.aborted) throw Object.assign(new Error("current transaction is aborted"),{code:"25P02"});
      if (sql.includes("pg_try_advisory_xact_lock")) return {rows:[{role:"statarena_admin",database:"statarena_prod",lease:lease === "immediate"}]};
      if (sql === "SELECT pg_advisory_xact_lock(97813003)") {
        assert.equal(this.statements.at(-2),"SAVEPOINT bootstrap_lease");
        assert.match(this.connectionParameters.options, /(?:^| )-c lock_timeout=2000(?: |$)/);
        if (lease === "timeout" || lease === "wait-error") {
          this.aborted = true;
          throw Object.assign(new Error("fixture lock failure must not expose transient-fixture-secret"),{code:lease === "timeout" ? "55P03" : "40P01"});
        }
      }
      if (sql.includes("FROM pg_locks")) return {rows:[blocker]};
      if (sql === operation.sql && fail) throw Object.assign(new Error("fixture failure"),{code:"XX001"});
      return {rows:sql === operation.sql ? [{extension:"pg_trgm"}] : []};
    }
    async end() { this.closed = true; }
  }
  pg.Client = Client;
  const config = {host:"statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com",database:"statarena_prod",username:"statarena_admin"};
  Object.assign(process.env, {LAMBDA_TASK_ROOT:dir,DATABASE_TARGET:"prod",ALLOW_WRITES:"true",EXPECTED_DATABASE_HOST:config.host,DATABASE_CONFIG:JSON.stringify(config)});
  try {
    const {handler} = await import("../infra/aws-db-maintenance/bootstrap.mjs");
    const request = ()=>({operation:"bootstrap-consolidation",operationHash,password:"transient-fixture-secret"});
    for (const bad of [{...request(),sql:"SELECT arbitrary"},{...request(),operation:"identity"},{...request(),operationHash:"bad"},{...request(),host:"other"}])
      await assert.rejects(handler(bad));
    assert.equal(clients.length,0);
    process.env.DATABASE_CONFIG=JSON.stringify({...config,password:"must-never-be-persisted"});
    await assert.rejects(handler(request()),/no password/);
    process.env.DATABASE_CONFIG=JSON.stringify(config);
    process.env.EXPECTED_DATABASE_HOST="other";
    await assert.rejects(handler(request()),/target/);
    process.env.EXPECTED_DATABASE_HOST=config.host;
    assert.equal(clients.length,0);
    const input=request(), receipt=await handler(input), client=clients.at(-1);
    assert.equal(receipt.ok,true);
    assert.equal(input.password,undefined);
    assert.equal(client.password,undefined);
    assert.equal(client.connectionParameters.password,undefined);
    assert.equal(client.closed,true);
    assert.ok(client.statements.includes(operation.sql));
    assert.ok(!client.statements.includes("SELECT pg_advisory_xact_lock(97813003)"));
    assert.equal(client.statements.at(-1),"COMMIT");
    assert.ok(!JSON.stringify(receipt).includes("transient-fixture-secret"));
    assert.equal(process.env.DATABASE_CONFIG,JSON.stringify(config));
    lease="wait";
    const waiting=request(), acquired=await handler(waiting), waiter=clients.at(-1);
    assert.equal(acquired.ok,true);
    assert.deepEqual(waiter.statements.slice(2,5),["SAVEPOINT bootstrap_lease","SELECT pg_advisory_xact_lock(97813003)","RELEASE SAVEPOINT bootstrap_lease"]);
    assert.equal(waiter.statements.at(-2),operation.sql);
    assert.equal(waiter.statements.at(-1),"COMMIT");
    assert.equal(waiter.statements.some((sql)=>sql.includes("FROM pg_locks")),false);
    assert.equal(waiting.password,undefined);
    assert.equal(waiter.password,undefined);
    assert.equal(waiter.connectionParameters.password,undefined);
    assert.equal(waiter.closed,true);
    lease="timeout";
    const blockedInput=request(), blocked=await handler(blockedInput), blockedClient=clients.at(-1);
    assert.equal(blocked.ok,false);
    assert.equal(blocked.code,"BOOTSTRAP_LEASE_BUSY");
    assert.deepEqual(blocked.blockers,[blocker]);
    assert.deepEqual(blockedClient.statements.slice(2,6),["SAVEPOINT bootstrap_lease","SELECT pg_advisory_xact_lock(97813003)","ROLLBACK TO SAVEPOINT bootstrap_lease","RELEASE SAVEPOINT bootstrap_lease"]);
    assert.ok(!blockedClient.statements.includes(operation.sql));
    assert.equal(blockedClient.statements.at(-1),"ROLLBACK");
    assert.equal(blockedClient.statements.filter((sql)=>sql === "SELECT pg_advisory_xact_lock(97813003)").length,1);
    assert.equal(blockedInput.password,undefined);
    assert.equal(blockedClient.password,undefined);
    assert.equal(blockedClient.connectionParameters.password,undefined);
    assert.equal(blockedClient.closed,true);
    assert.ok(!JSON.stringify(blocked).includes("transient-fixture-secret"));
    lease="wait-error";
    const unexpectedInput=request(), unexpected=await handler(unexpectedInput), abortedClient=clients.at(-1);
    assert.equal(unexpected.code,"40P01");
    assert.equal(abortedClient.statements.at(-1),"ROLLBACK");
    assert.ok(!abortedClient.statements.includes(operation.sql));
    assert.equal(abortedClient.statements.some((sql)=>sql.includes("FROM pg_locks")),false);
    assert.equal(unexpectedInput.password,undefined);
    assert.equal(abortedClient.password,undefined);
    assert.equal(abortedClient.connectionParameters.password,undefined);
    assert.equal(abortedClient.closed,true);
    assert.ok(!JSON.stringify(unexpected).includes("transient-fixture-secret"));
    lease="immediate";fail=true;
    const failed=await handler(request());
    assert.equal(failed.ok,false);
    assert.equal(failed.code,"XX001");
    assert.equal(clients.at(-1).statements.at(-1),"ROLLBACK");
    assert.equal(clients.at(-1).connectionParameters.password,undefined);
    for (const value of clients) {
      assert.equal(value.password,undefined);
      assert.equal(value.connectionParameters.password,undefined);
      assert.equal(value.closed,true);
      assert.ok(value.statements.every((sql)=>!/(?:pg_terminate_backend|pg_cancel_backend)/i.test(sql)));
    }
  } finally {
    pg.Client=OriginalClient;
    for(const key of keys) if(prior[key]===undefined) delete process.env[key]; else process.env[key]=prior[key];
    await rm(dir,{recursive:true,force:true});
  }
});

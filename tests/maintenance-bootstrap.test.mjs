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
  let busy = false, fail = false;
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
      if (sql.includes("pg_try_advisory_xact_lock")) return {rows:[{role:"statarena_admin",database:"statarena_prod",lease:!busy}]};
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
    assert.equal(client.statements.at(-1),"COMMIT");
    assert.ok(!JSON.stringify(receipt).includes("transient-fixture-secret"));
    assert.equal(process.env.DATABASE_CONFIG,JSON.stringify(config));
    busy=true;
    const blocked=await handler(request());
    assert.equal(blocked.ok,false);
    assert.ok(!clients.at(-1).statements.includes(operation.sql));
    assert.equal(clients.at(-1).statements.at(-1),"ROLLBACK");
    busy=false;fail=true;
    const failed=await handler(request());
    assert.equal(failed.ok,false);
    assert.equal(failed.code,"XX001");
    assert.equal(clients.at(-1).statements.at(-1),"ROLLBACK");
    assert.equal(clients.at(-1).connectionParameters.password,undefined);
  } finally {
    pg.Client=OriginalClient;
    for(const key of keys) if(prior[key]===undefined) delete process.env[key]; else process.env[key]=prior[key];
    await rm(dir,{recursive:true,force:true});
  }
});

/** Read-only RDS verification. AWS credentials stay in the CLI credential chain. */
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
const output = process.argv[2];
if (!output) throw new Error("Provide the evidence JSON path");
function aws(...args) {
  return JSON.parse(execFileSync("aws", ["--profile", "statarena", "--region", "us-east-2", "--no-cli-pager", "--output", "json", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}
let db;
try {
  if (aws("sts", "get-caller-identity").Account !== "361769570630") throw Error("Unexpected AWS account");
  const p = aws("ssm", "get-parameter", "--name", "/statarena/app/rds-runtime", "--with-decryption").Parameter;
  if (p.Type !== "SecureString") throw Error("Runtime credentials must be encrypted");
  const c = JSON.parse(p.Value);
  if (c.host !== "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com" || c.database !== "statarena_prod" || c.username !== "statarena_runtime") throw Error("Unexpected runtime database target");
  const url = new URL("postgresql://" + c.host + ":5432/" + c.database);
  url.username = c.username; url.password = c.password;
  process.env.DATABASE_URL = url.href;
  process.env.STATARENA_DATA_PROVIDER = "aws";
  process.env.DATABASE_POOL_MAX = "1";
  db = await import("../../dashboard/backend/services/postgres.js");
  const [identity] = await db.query("select current_user,current_database(),current_setting($1) as read_only", ["default_transaction_read_only"]);
  const [tls] = await db.query("select ssl,version,cipher,bits from pg_stat_ssl where pid=pg_backend_pid()");
  const [privileges] = await db.query("select has_table_privilege(current_user,$1,$2) as source_update_allowed", ["statarena.fixtures", "UPDATE"]);
  const report = { setup: "Actual RDS, SSM runtime identity, verified bundled regional CA and bounded read-only pool", command: `bun infra/aws-backend/check-runtime.mjs ${output}`, expected: { read_only: "on", ssl: true, source_update_allowed: false }, actual: { ...identity, ...tls, ...privileges }, status: identity.read_only === "on" && tls.ssl && !privileges.source_update_allowed ? "passed" : "failed" };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  if (report.status !== "passed") process.exitCode = 1;
} catch (error) {
  console.error("Runtime verification failed", error.name, error.code || "");
  process.exitCode = 1;
} finally { await db?.closeDatabase(); }

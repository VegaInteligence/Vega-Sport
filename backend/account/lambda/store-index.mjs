// Lambda entry of the account store (infra/aws/account.yaml, function vega-v2-account-store):
// in the VPC, invoked by the front only, the only code with a connection to schema `account`.
// One connection per copy (the copies are limited to 8 by the stack; the login's limit is twice
// that plus a margin, DEPLOYMENT.md). A copy left idle two minutes gives its connection back.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPool, createStore } from "../src/store.mjs";

const url = process.env.V2_ACCOUNT_DATABASE_URL;
let store = null;
if (url) {
  // RDS: TLS verified against the regional CA bundled beside index.mjs, as the read API does.
  const caFile = join(process.env.LAMBDA_TASK_ROOT || process.cwd(), "rds-ca.pem");
  const ca = existsSync(caFile) ? readFileSync(caFile, "utf8") : null;
  if (!ca && !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("rds-ca.pem is missing beside the store's index.mjs");
  store = createStore({ pool: createPool(url, { max: 1, idleSessionMs: 120_000, ca, role: "vega_account" }) });
}

export async function handler(command) {
  if (!store) return { ok: false, code: "NOT_CONFIGURED", message: "V2_ACCOUNT_DATABASE_URL is not set" };
  const started = Date.now();
  const out = await store.handle(command);
  // One line per command: its name and outcome, never the account id or the preferences.
  console.log(JSON.stringify({ command: typeof command?.command === "string" ? command.command.slice(0, 32) : "?", ok: out.ok, ...(out.ok ? {} : { code: out.code }), ms: Date.now() - started }));
  return out;
}

// Lambda entry of the read API: the Function URL event adapter (transport.mjs) around
// backend/api's handler.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adapt } from "./transport.mjs";
import { createReader } from "../../backend/api/src/db.mjs";
import { createHandler } from "../../backend/api/src/handler.mjs";

const ca = readFileSync(join(process.env.LAMBDA_TASK_ROOT || process.cwd(), "rds-ca.pem"), "utf8");
// One connection per copy of the function. The copies are limited (api.yaml,
// ReservedConcurrency) and the login vega_v2_read holds two generations of them
// (vega/migrate.py; backend/tests/test_api_capacity.py keeps the three numbers together).
// A copy left idle two minutes gives its connection back: the base closes the session.
const reader = createReader(process.env.V2_READ_DATABASE_URL || "postgresql://offline.invalid/vega_v2", {
  max: 1,
  idleSessionMs: 120_000,
  ca,
  role: "vega_read",
});
export const handler = adapt(
  // log: one line per request the function receives (README, "The read API's connections").
  createHandler({ read: reader.read, mediaBase: process.env.V2_MEDIA_BASE_URL || null, opsKey: process.env.V2_OPS_KEY || null, log: console.log }),
);

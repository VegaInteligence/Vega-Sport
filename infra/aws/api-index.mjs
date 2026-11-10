// Lambda entry of the read API: the Function URL event adapter (transport.mjs) around
// backend/api's handler.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adapt } from "./transport.mjs";
import { createReader } from "../../backend/api/src/db.mjs";
import { createHandler } from "../../backend/api/src/handler.mjs";

const ca = readFileSync(join(process.env.LAMBDA_TASK_ROOT || process.cwd(), "rds-ca.pem"), "utf8");
// One connection per execution environment: the account runs at most 10 Lambdas.
const reader = createReader(process.env.V2_READ_DATABASE_URL || "postgresql://offline.invalid/vega_v2", {
  max: 1,
  ca,
  role: "vega_read",
});
export const handler = adapt(
  createHandler({ read: reader.read, mediaBase: process.env.V2_MEDIA_BASE_URL || null, opsKey: process.env.V2_OPS_KEY || null }),
);

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adapt } from "./transport.mjs";
// The public RDS bundle is larger than Lambda's entire environment allocation.
process.env.DATABASE_CA_PEM = readFileSync(
  join(process.env.LAMBDA_TASK_ROOT || process.cwd(), "rds-ca.pem"),
  "utf8",
);
process.env.STATARENA_DATABASE_CA_PEM = process.env.DATABASE_CA_PEM;
const { handleRequest } = await import("../../dashboard/backend/aws-app.js");
export const handler = adapt(handleRequest);

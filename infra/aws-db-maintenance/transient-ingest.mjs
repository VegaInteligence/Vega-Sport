// Separate IAM-only ingestion entrypoint. The package is an expiring, immutable
// operation allowlist; connection credentials exist only for one invocation.
import { maintenanceManifest, runMaintenance } from "./index.mjs";
import {
  PRODUCTION_HOST,
  PRODUCTION_DATABASE,
  transientWindow,
  transientConfig,
  validateTransientEvent,
  clearTransientCredential,
} from "./transient-policy.mjs";

export async function handler(event, context) {
  let config;
  try {
    validateTransientEvent(event);
    const expiresAt = transientWindow(
      maintenanceManifest,
      "vega.transient-ingest.v1",
    );
    const operations = Object.entries(maintenanceManifest.operations || {});
    if (
      !operations.length ||
      operations.length > 256 ||
      operations.some(
        ([name, operation]) =>
          ["bootstrap-consolidation", "transfer-authorize"].includes(name) ||
          !Array.isArray(operation.targets) ||
          operation.targets.length !== 1 ||
          operation.targets[0] !== "prod",
      )
    )
      throw new Error(
        "Transient ingestion release contains an unreviewed target or admin operation",
      );
    config = transientConfig("statarena_ingest");
    config.password = event.password;
    const input = {
      operation: event.operation,
      operationHash: event.operationHash,
    };
    if (Object.hasOwn(event, "values")) input.values = event.values;
    return await runMaintenance(input, context, {
      config,
      target: "prod",
      expectedHost: PRODUCTION_HOST,
      allowWrites: process.env.ALLOW_WRITES === "true",
      identity: { role: "statarena_ingest", database: PRODUCTION_DATABASE },
      expiresAt,
      redactErrors: true,
    });
  } finally {
    clearTransientCredential(event, config);
  }
}

// Credentials never belong in a release, environment variable or receipt.
export const PRODUCTION_HOST =
  "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com";
export const PRODUCTION_DATABASE = "statarena_prod";
const FOUR_HOURS = 4 * 60 * 60 * 1000;
const absoluteTimestamp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function transientWindow(manifest, format) {
  const issued = Date.parse(manifest.issuedAt),
    expires = Date.parse(manifest.expiresAt);
  const now = Date.now();
  if (
    manifest.format !== format ||
    typeof manifest.issuedAt !== "string" ||
    typeof manifest.expiresAt !== "string" ||
    !absoluteTimestamp.test(manifest.issuedAt) ||
    !absoluteTimestamp.test(manifest.expiresAt) ||
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    expires <= issued ||
    expires - issued > FOUR_HOURS ||
    issued > now ||
    expires <= now
  )
    throw Object.assign(
      new Error(
        "Transient release is expired or has an invalid bounded window",
      ),
      { code: "TRANSIENT_RELEASE_WINDOW" },
    );
  return expires;
}

export function transientConfig(role) {
  if (
    process.env.DATABASE_TARGET !== "prod" ||
    process.env.EXPECTED_DATABASE_HOST !== PRODUCTION_HOST
  )
    throw new Error("Unexpected transient deployment target");
  const config = JSON.parse(process.env.DATABASE_CONFIG || "{}");
  if (
    !config ||
    Array.isArray(config) ||
    Object.keys(config).some(
      (key) => !["host", "port", "database", "username"].includes(key),
    ) ||
    config.host !== PRODUCTION_HOST ||
    config.database !== PRODUCTION_DATABASE ||
    config.username !== role ||
    (config.port !== undefined && Number(config.port) !== 5432)
  )
    throw new Error(
      "Transient database configuration must contain only the fixed identity and no password",
    );
  return { ...config, port: 5432 };
}

export function validateTransientEvent(event) {
  if (
    !event ||
    typeof event !== "object" ||
    Array.isArray(event) ||
    Object.keys(event).some(
      (key) =>
        !["operation", "operationHash", "values", "password"].includes(key),
    )
  )
    throw new Error("Unexpected transient request fields");
  if (
    typeof event.password !== "string" ||
    event.password.length < 1 ||
    event.password.length > 4096
  )
    throw new Error("A transient invocation credential is required");
}

export function clearTransientCredential(event, config) {
  if (event && typeof event === "object") event.password = undefined;
  if (config) config.password = undefined;
}

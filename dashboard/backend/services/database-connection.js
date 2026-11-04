export function databaseConnectionOptions(connectionString, caPem) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Invalid PostgreSQL URL");
  if (!caPem) {
    url.searchParams.set("sslmode", "verify-full");
    return { connectionString: url.href };
  }
  // node-postgres replaces an explicit ssl object when ssl query options are
  // present. Remove them so it actually verifies against the RDS root CA.
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey"])
    url.searchParams.delete(key);
  return {
    connectionString: url.href,
    ssl: { ca: caPem.replace(/\\n/g, "\n"), rejectUnauthorized: true },
  };
}

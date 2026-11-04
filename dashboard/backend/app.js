// The old origin can continue serving its historical deployment during cutover.
// The AWS ZIP imports aws-app.js directly and contains only relational readers.
export async function handleRequest(request) {
  const provider = process.env.STATARENA_DATA_PROVIDER?.toLowerCase();
  const app =
    provider === "aws" || process.env.DATABASE_URL
      ? await import("./aws-app.js")
      : await import("./legacy-app.js");
  return app.handleRequest(request);
}

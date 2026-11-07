import { AsyncLocalStorage } from "node:async_hooks";

const requests = new AsyncLocalStorage();
const rate = Number(process.env.STATARENA_METRICS_SAMPLE_RATE ?? "0.01");
const sampleRate = Number.isFinite(rate)
  ? Math.max(0, Math.min(1, rate))
  : 0.01;
const timingHeaders = process.env.STATARENA_SERVER_TIMING === "1";
const instanceStarted = performance.now();

export function record(name, amount = 1) {
  const context = requests.getStore();
  if (context && Number.isFinite(amount))
    context.metrics[name] = (context.metrics[name] || 0) + amount;
}
export const measuring = () => Boolean(requests.getStore());

export function observeVersion(sha256) {
  const context = requests.getStore();
  if (context && context.versions.size < 4) context.versions.add(sha256);
}

export function timeSync(name, operation) {
  if (!measuring()) return operation();
  const start = performance.now();
  try {
    return operation();
  } finally {
    record(name, performance.now() - start);
  }
}

export function serializeJson(value) {
  return timeSync("serialize_ms", () => JSON.stringify(value));
}

/** Logical representation bytes, not transport or provider egress. */
export function responseBytes(body) {
  const context = requests.getStore();
  if (!context) return;
  if (typeof body === "string")
    context.metrics.response_bytes = Buffer.byteLength(body);
  else if (Buffer.isBuffer(body)) context.metrics.response_bytes = body.length;
  else if (body === null) context.metrics.response_bytes = 0;
}

export function routeLabel(request) {
  let pathname;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return "/invalid";
  }
  if (
    /^\/api\/(?:dashboard\/manifest|seasons\/partition|fixtures|search|read\/(?:home|players|clubs|player|club|performance|discipline|archive)|scouting\/routes|archives\/(?:index|season)|rankings\/(?:associations|club|index|edition)|club-links|cup-(?:index|snapshot|table)|matchdays|supplemental)$/.test(
      pathname,
    )
  )
    return pathname;
  if (/^\/api\/matches\/m_[A-Za-z0-9]{6}\/summary$/.test(pathname))
    return "/api/matches/:id/summary";
  if (pathname.startsWith("/data/")) return "/data/:file";
  if (
    /^\/api\/(health|settings|status|assets|standings|open-cups|openligadb|nations-results|club-wikidata|coach-portrait|stadium|player-honours)$/.test(
      pathname,
    )
  )
    return pathname;
  if (/^\/api\/archive\/matches\/m_[A-Za-z0-9]{6}$/.test(pathname))
    return "/api/archive/matches/:id";
  const profile = pathname.match(
    /^\/api\/archive\/profiles\/(leagues|teams|players)\/[ltp]_[A-Za-z0-9]{6}$/,
  );
  if (profile) return `/api/archive/profiles/${profile[1]}/:id`;
  if (
    /^\/api\/pitchapi\/(leagues|teams|players|matches|date)(?:\/[A-Za-z0-9_/-]+)?$/.test(
      pathname,
    )
  ) {
    const normalized = pathname
      .replace(/\/[lmpts]_[A-Za-z0-9]{6}(?=\/|$)/g, "/:id")
      .replace(/\/\d{4}-\d{2}-\d{2}$/, "/:date");
    // Unknown paths are grouped rather than allowing arbitrary log labels.
    if (
      /^\/api\/pitchapi\/(?:leagues|teams|players|matches|date)(?:\/(?:\:id|\:date|matches|shots|momentum|events|players|halves|stats|h2h|advanced|network|lineups|heatmaps))*$/.test(
        normalized,
      )
    )
      return normalized;
  }
  return "/other";
}

/** Origin measurements only; no claim about CDN HITs or provider wire egress. */
export async function instrumentRequest(request, handler) {
  const sampled = sampleRate > 0 && Math.random() < sampleRate;
  // Explicit timing headers must describe every measured response, not the
  // incidental one-percent log sample. Logging remains independently sampled.
  if (!sampled && !timingHeaders) return handler();
  return requests.run({ metrics: {}, versions: new Set() }, async () => {
    const context = requests.getStore(),
      start = performance.now();
    let response;
    try {
      response = await handler();
      if (timingHeaders) {
        response.headers.set(
          "Server-Timing",
          `origin;dur=${(performance.now() - start).toFixed(2)}, sql;dur=${(context.metrics.sql_ms || 0).toFixed(2)}, pool;dur=${(context.metrics.pool_wait_ms || 0).toFixed(2)}`,
        );
      }
      return response;
    } finally {
      if (request.method === "HEAD") context.metrics.response_bytes = 0;
      const metrics = Object.fromEntries(
        Object.entries(context.metrics).map(([key, value]) => [
          key,
          Math.round(value * 1000) / 1000,
        ]),
      );
      if (sampled)
        console.log(
          JSON.stringify({
            event: "statarena.request",
            route: routeLabel(request),
            method: ["GET", "HEAD"].includes(request.method)
              ? request.method
              : "OTHER",
            status: response?.status || 500,
            duration_ms: Math.round((performance.now() - start) * 1000) / 1000,
            instance_age_ms: Math.round(performance.now() - instanceStarted),
            deployment:
              process.env.STATARENA_RELEASE ||
              process.env.AWS_LAMBDA_FUNCTION_VERSION ||
              process.env.VERCEL_DEPLOYMENT_ID ||
              "local",
            region:
              process.env.AWS_REGION || process.env.VERCEL_REGION || "local",
            object_versions: [...context.versions],
            metrics,
          }),
        );
    }
  });
}

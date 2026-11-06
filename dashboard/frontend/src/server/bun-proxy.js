const AWS_API_ORIGIN = "https://d317dq37z1tacb.cloudfront.net";
const UPSTREAM_CONCURRENCY = 4;
const waiting = [];
let active = 0;

function acquire(signal) {
  signal.throwIfAborted();
  if (active < UPSTREAM_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const start = () => {
      signal.removeEventListener("abort", aborted);
      resolve();
    };
    const aborted = () => {
      const index = waiting.indexOf(start);
      if (index >= 0) waiting.splice(index, 1);
      reject(signal.reason);
    };
    waiting.push(start);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const aborted = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, ms);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

async function upstreamFetch(url, options) {
  // Bound each Vercel process, including image redirects, below the current
  // AWS account concurrency. A permit transfers directly to the next waiter.
  await acquire(options.signal);
  try {
    options.signal.throwIfAborted();
    const safe = ["GET", "HEAD"].includes(options.method);
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, options);
      if (!safe || response.status !== 429 || attempt >= 2) return response;
      const after = response.headers.get("retry-after");
      const parsed = after === null ? NaN : /^\d+(?:\.\d+)?$/.test(after)
        ? Number(after) * 1000 : Date.parse(after) - Date.now();
      const wait = Number.isFinite(parsed) ? Math.max(0, parsed) : 500 * 2 ** attempt;
      // Do not retry earlier than a longer server-requested backoff.
      if (wait > 2000) return response;
      await response.body?.cancel();
      await delay(wait, options.signal);
    }
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

/** Next only forwards HTTP. Database access runs in the AWS backend. */
export async function proxy(request) {
  const url = new URL(request.url);
  if (process.env.NEXT_PUBLIC_API_ORIGIN) {
    if (url.pathname.startsWith("/data/"))
      return new Response(null, { status: 410, headers: { "Cache-Control": "no-store" } });
    const { apiUrl } = await import("../data-url.js");
    return Response.redirect(apiUrl(url.pathname + url.search), 307);
  }
  if (url.pathname.startsWith("/data/"))
    return new Response(null, { status: 410, headers: { "Cache-Control": "no-store" } });
  const origin = process.env.ORION_API_ORIGIN ||
    (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8765" : AWS_API_ORIGIN);
  try {
    const validator = request.headers.get("if-none-match");
    const upstream = await upstreamFetch(origin + url.pathname + url.search, {
      method: request.method,
      cache: "no-store",
      redirect: "manual",
      signal: request.signal,
      headers: validator ? { "If-None-Match": validator } : {},
    });
    const headers = new Headers();
    for (const key of [
      "content-type",
      "cache-control",
      "vercel-cdn-cache-control",
      "cdn-cache-control",
      "content-disposition",
      "allow",
      "retry-after",
      "location",
      "etag",
      "x-data-source",
      "server-timing",
    ])
      if (upstream.headers.has(key))
        headers.set(key, upstream.headers.get(key));
    headers.set("X-Content-Type-Options", "nosniff");
    // fetch decodes upstream compression. Its wire Content-Length no longer
    // describes the streamed body; Next must frame this response itself.
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return Response.json(
      {
        error: {
          message:
            "Le service de données est indisponible. Réessayez dans un instant.",
        },
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store",
          "Vercel-CDN-Cache-Control": "no-store",
        },
      },
    );
  }
}

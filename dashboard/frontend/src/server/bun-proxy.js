const AWS_API_ORIGIN = "https://d317dq37z1tacb.cloudfront.net";

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
    const upstream = await fetch(origin + url.pathname + url.search, {
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
      "content-length",
      "x-data-source",
      "server-timing",
    ])
      if (upstream.headers.has(key))
        headers.set(key, upstream.headers.get(key));
    headers.set("X-Content-Type-Options", "nosniff");
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

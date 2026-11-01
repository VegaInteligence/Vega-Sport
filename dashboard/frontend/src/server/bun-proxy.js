/** Next transport only; all data access and provider credentials stay in Bun. */
export async function proxy(request) {
  const url = new URL(request.url);
  const origin = process.env.ORION_API_ORIGIN || "http://127.0.0.1:8765";
  try {
    const upstream = await fetch(origin + url.pathname + url.search, {
      method: request.method,
      cache: "no-store",
      redirect: "manual",
      signal: request.signal,
    });
    const headers = new Headers();
    for (const key of [
      "content-type",
      "cache-control",
      "content-disposition",
      "allow",
      "retry-after",
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
      { status: 502 },
    );
  }
}

// Hosting-provided country only; no location permission or third-party lookup.
export async function GET(request) {
  const raw = request.headers.get("x-vercel-ip-country") || request.headers.get("cf-ipcountry") || "";
  const country = /^[A-Za-z]{2}$/.test(raw) && !/^(XX|T1)$/i.test(raw) ? raw.toUpperCase() : null;
  return Response.json({ country }, { headers: { "Cache-Control": "private, no-store" } });
}

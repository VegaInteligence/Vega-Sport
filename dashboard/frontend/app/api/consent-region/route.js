// Whether the visitor is asked before the audience measurement (src/services/consent.js). Vercel's geolocation headers
// only, never the IP address; nothing kept or logged. Private and never stored: no cache serves one visitor's answer
// to another, and the pages stay static.
import { consentFor } from "../../../src/services/consent.js";

export const dynamic = "force-dynamic";

export function GET(request) {
  return Response.json(
    { consent: consentFor(request.headers) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

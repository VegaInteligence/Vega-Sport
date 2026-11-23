// The browser's reports of the report-only content security policy (security-headers.mjs):
// each one becomes a single bounded line in the function logs, "[csp] {...}". Nothing is
// stored. A body is read up to MAX_BYTES, a batch up to MAX_REPORTS, and an instance writes
// at most LOG_QUOTA lines a minute; what goes over is counted in one line, then dropped.
// Every accepted request is answered 204, so no browser retries.
export const dynamic = "force-dynamic";

export const MAX_BYTES = 16 * 1024;
export const MAX_REPORTS = 10;
export const LOG_QUOTA = 20;
const WINDOW_MS = 60 * 1000;
const TYPES = [
  "application/csp-report",
  "application/reports+json",
  "application/json",
];
const FIELD = 200;

let windowStart = 0,
  logged = 0,
  dropped = 0;
export function __resetForTests() {
  windowStart = 0;
  logged = 0;
  dropped = 0;
}

const empty = (status) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } });

async function readBounded(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const text = (value) =>
  typeof value === "string" ? value.slice(0, FIELD) : undefined;
// A URL keeps its origin and path; a query or a fragment may hold someone's data.
function place(value) {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value);
    return (
      url.origin === "null" ? url.protocol : url.origin + url.pathname
    ).slice(0, FIELD);
  } catch {
    return text(value);
  }
}
function pathOf(value) {
  try {
    return new URL(value).pathname.slice(0, FIELD);
  } catch {
    return undefined;
  }
}
const number = (value) => (Number.isFinite(value) ? value : undefined);

/** One report, in the legacy (report-uri) or the Reporting API (report-to) form. */
function entry(report) {
  const legacy = report?.["csp-report"];
  if (legacy && typeof legacy === "object")
    return {
      directive: text(
        legacy["effective-directive"] || legacy["violated-directive"],
      ),
      blocked: place(legacy["blocked-uri"]),
      page: pathOf(legacy["document-uri"]),
      source: place(legacy["source-file"]),
      line: number(legacy["line-number"]),
      column: number(legacy["column-number"]),
      disposition: text(legacy.disposition),
    };
  const body = report?.type === "csp-violation" ? report.body : null;
  if (body && typeof body === "object")
    return {
      directive: text(body.effectiveDirective),
      blocked: place(body.blockedURL),
      page: pathOf(body.documentURL || report.url),
      source: place(body.sourceFile),
      line: number(body.lineNumber),
      column: number(body.columnNumber),
      disposition: text(body.disposition),
    };
  return null;
}

function log(line) {
  const now = Date.now();
  if (now - windowStart >= WINDOW_MS) {
    if (dropped) console.warn("[csp] " + JSON.stringify({ dropped }));
    windowStart = now;
    logged = 0;
    dropped = 0;
  }
  if (logged < LOG_QUOTA) {
    logged++;
    console.warn("[csp] " + JSON.stringify(line));
  } else dropped++;
}

export async function POST(request) {
  const type = (request.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!TYPES.includes(type)) return empty(415);
  const body = await readBounded(request);
  if (body === null) return empty(413);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return empty(400);
  }
  for (const report of (Array.isArray(parsed) ? parsed : [parsed]).slice(
    0,
    MAX_REPORTS,
  )) {
    const line = entry(report);
    if (line) log(line);
  }
  return empty(204);
}

// The site's security headers (next.config.mjs, headers()). The content security policy
// is report-only: it observes, it never blocks (tests/security-headers.test.mjs). Its
// reports go to app/api/csp-report, which writes them to the function logs.
import { API_ORIGIN } from "./src/api-origin.js";
import { allStadiumPlans } from "./src/services/stadium-plans.js";

export const CSP_REPORT_PATH = "/api/csp-report";
// The live WebSocket: AppSync Events in the stacks' region (infra/aws/deploy.sh, live.yaml).
const LIVE_REALTIME = "wss://*.appsync-realtime-api.us-east-2.amazonaws.com";
// The stadium's 3D map (components/StadiumMap.jsx): MapLibre's pinned release, its tiles.
const MAPLIBRE = "https://unpkg.com/maplibre-gl@5.6.2/";
const MAP_TILES = "https://tiles.openfreemap.org";
// Vercel's toolbar and comments, injected on preview deployments only.
const VERCEL_LIVE = "https://vercel.live";

const origins = (values) => [...new Set(values.filter(Boolean))];
function apiOrigins(env) {
  const configured = (() => {
    try {
      return env.NEXT_PUBLIC_API_ORIGIN
        ? new URL(env.NEXT_PUBLIC_API_ORIGIN).origin
        : "";
    } catch {
      return "";
    }
  })();
  // The image copies are addressed on API_ORIGIN whatever the configured origin.
  return origins([configured, API_ORIGIN]);
}
const plans = allStadiumPlans();
const framed = origins(
  plans
    .filter((plan) => plan.embedded && !plan.imageUrl)
    .map((plan) => new URL(plan.url).origin),
);
const locating = origins(
  plans
    .filter((plan) => plan.allowGeolocation)
    .map((plan) => new URL(plan.url).origin),
);

export function contentSecurityPolicy(env = process.env) {
  const development = env.NODE_ENV === "development";
  const preview = env.VERCEL_ENV === "preview";
  const api = apiOrigins(env);
  const toolbar = preview ? [VERCEL_LIVE] : [];
  const directives = {
    "default-src": ["'self'"],
    // 'unsafe-inline': Next's inline payload scripts and the layout's three boot scripts,
    // without nonces (they would make every page dynamic). Eval: React in development only.
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(development ? ["'unsafe-eval'"] : []),
      MAPLIBRE,
      ...toolbar,
    ],
    // Server-rendered style attributes and MapLibre's stylesheet.
    "style-src": ["'self'", "'unsafe-inline'", MAPLIBRE, ...toolbar],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      ...api,
      ...(preview ? [VERCEL_LIVE, "https://vercel.com"] : []),
    ],
    "font-src": [
      "'self'",
      ...(preview ? [VERCEL_LIVE, "https://assets.vercel.com"] : []),
    ],
    "connect-src": [
      "'self'",
      ...api,
      LIVE_REALTIME,
      MAP_TILES,
      ...(development ? ["ws:"] : []),
      ...(preview ? [VERCEL_LIVE, "wss://ws-us3.pusher.com"] : []),
    ],
    // MapLibre runs its tile worker from a blob: URL.
    "worker-src": ["'self'", "blob:"],
    "frame-src": [...framed, ...toolbar],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "report-uri": [CSP_REPORT_PATH],
    "report-to": ["csp"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

export function securityHeaders(env = process.env) {
  return [
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: [
        "camera=()",
        "microphone=()",
        `geolocation=(${locating.map((origin) => `"${origin}"`).join(" ")})`,
        "payment=()",
        "usb=()",
        "browsing-topics=()",
      ].join(", "),
    },
    {
      key: "Content-Security-Policy-Report-Only",
      value: contentSecurityPolicy(env),
    },
    { key: "Reporting-Endpoints", value: `csp="${CSP_REPORT_PATH}"` },
  ];
}

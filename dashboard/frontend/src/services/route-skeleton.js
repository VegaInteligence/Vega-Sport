/**
 * Routes that open on a skeleton of their own shape instead of the logo.
 * `needsId`: only the item page (`?id=`) has that shape; the directory keeps the logo, or shows `directory` (the
 * calendar, § 87, under /matchs) unless the address names one of `unless` (an archived World Cup match, `cdm`).
 * The head script (app/layout.jsx) and LoadingPage both read this table.
 */
export const ROUTE_SKELETONS = {
  // The home: "/" without its slash (§ 84).
  "": { kind: "home", needsId: false },
  "/clubs": { kind: "club", needsId: true },
  "/competitions": { kind: "competition", needsId: false },
  "/matchs": { kind: "match", needsId: true, directory: "calendar", unless: ["cdm"] },
  "/nations": { kind: "nation", needsId: true },
};

/** The skeleton kind of a location, or "" when the route keeps the logo. */
export function routeSkeleton(pathname, search = "") {
  const route = ROUTE_SKELETONS[String(pathname || "").replace(/\/$/, "")];
  if (!route) return "";
  const params = new URLSearchParams(search);
  if (route.needsId && !params.has("id"))
    return route.directory && !(route.unless || []).some((name) => params.has(name)) ? route.directory : "";
  return route.kind;
}

/** Sets `html[data-route-skeleton]` before the first paint. */
export const routeSkeletonScript = `try{var r=${JSON.stringify(ROUTE_SKELETONS)}[location.pathname.replace(/\\/$/,"")],p=new URLSearchParams(location.search),k=!r?"":!r.needsId||p.has("id")?r.kind:r.directory&&!(r.unless||[]).some(function(n){return p.has(n)})?r.directory:"";k?document.documentElement.setAttribute("data-route-skeleton",k):document.documentElement.removeAttribute("data-route-skeleton")}catch{}`;

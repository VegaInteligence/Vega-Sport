/**
 * Routes that open on a skeleton of their own shape instead of the logo.
 * `needsId`: only the item page (`?id=`) has that shape; the directory keeps the logo.
 * The head script (app/layout.jsx) and LoadingPage both read this table.
 */
export const ROUTE_SKELETONS = {
  "/clubs": { kind: "club", needsId: true },
  "/competitions": { kind: "competition", needsId: false },
  "/nations": { kind: "nation", needsId: true },
};

/** The skeleton kind of a location, or "" when the route keeps the logo. */
export function routeSkeleton(pathname, search = "") {
  const route = ROUTE_SKELETONS[String(pathname || "").replace(/\/$/, "")];
  if (!route) return "";
  if (route.needsId && !new URLSearchParams(search).has("id")) return "";
  return route.kind;
}

/** Sets `html[data-route-skeleton]` before the first paint. */
export const routeSkeletonScript = `try{var r=${JSON.stringify(ROUTE_SKELETONS)}[location.pathname.replace(/\\/$/,"")],k=r&&(!r.needsId||new URLSearchParams(location.search).has("id"))?r.kind:"";k?document.documentElement.setAttribute("data-route-skeleton",k):document.documentElement.removeAttribute("data-route-skeleton")}catch{}`;

/**
 * Routes that open on a skeleton of their own shape instead of the logo.
 * `needsId`: only the item page (`?id=`) has that shape; the directory keeps the logo, or shows `directory` (the
 * calendar, § 88, under /matchs) unless the address names one of `unless` (an archived World Cup match, `cdm`).
 * `idKind`: the item page (`?id=`) has a shape of its own, the directory `kind` (the players, § 87).
 * The head script (app/layout.jsx) and LoadingPage both read this table.
 */
export const ROUTE_SKELETONS = {
  // The home: "/" without its slash (§ 84).
  "": { kind: "home", needsId: false },
  "/clubs": { kind: "club", needsId: true },
  "/competitions": { kind: "competition", needsId: false },
  "/matchs": { kind: "match", needsId: true, directory: "calendar", unless: ["cdm"] },
  "/nations": { kind: "nation", needsId: true },
  // § 87: the Ballon d'Or, the Power Ranking, the players' directory and a player's page.
  "/classement-joueurs": { kind: "ballon", needsId: false },
  "/power-ranking": { kind: "power", needsId: false },
  "/joueurs": { kind: "players", needsId: false, idKind: "player" },
};

/** The skeleton kind of a location, or "" when the route keeps the logo. */
export function routeSkeleton(pathname, search = "") {
  const route = ROUTE_SKELETONS[String(pathname || "").replace(/\/$/, "")];
  if (!route) return "";
  const params = new URLSearchParams(search),
    hasId = params.has("id");
  if (route.needsId && !hasId)
    return route.directory && !(route.unless || []).some((name) => params.has(name)) ? route.directory : "";
  return hasId && route.idKind ? route.idKind : route.kind;
}

/** Sets `html[data-route-skeleton]` before the first paint. */
export const routeSkeletonScript = `try{var r=${JSON.stringify(ROUTE_SKELETONS)}[location.pathname.replace(/\\/$/,"")],p=new URLSearchParams(location.search),h=p.has("id"),k=!r?"":!r.needsId||h?(h&&r.idKind)||r.kind:r.directory&&!(r.unless||[]).some(function(n){return p.has(n)})?r.directory:"";k?document.documentElement.setAttribute("data-route-skeleton",k):document.documentElement.removeAttribute("data-route-skeleton")}catch{}`;

/**
 * Routes that open on a skeleton of their own shape instead of the logo.
 * `needsId`: only the item page (`?id=`) has that shape; the directory keeps the logo.
 * `idKind`: the item page (`?id=`) has a shape of its own, the directory `kind` (the players, § 87).
 * The head script (app/layout.jsx) and LoadingPage both read this table.
 */
export const ROUTE_SKELETONS = {
  // The home: "/" without its slash (§ 84).
  "": { kind: "home", needsId: false },
  "/clubs": { kind: "club", needsId: true },
  "/competitions": { kind: "competition", needsId: false },
  "/matchs": { kind: "match", needsId: true },
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
  const hasId = new URLSearchParams(search).has("id");
  if (route.needsId && !hasId) return "";
  return hasId && route.idKind ? route.idKind : route.kind;
}

/** Sets `html[data-route-skeleton]` before the first paint. */
export const routeSkeletonScript = `try{var r=${JSON.stringify(ROUTE_SKELETONS)}[location.pathname.replace(/\\/$/,"")],h=new URLSearchParams(location.search).has("id"),k=r&&(!r.needsId||h)?(h&&r.idKind)||r.kind:"";k?document.documentElement.setAttribute("data-route-skeleton",k):document.documentElement.removeAttribute("data-route-skeleton")}catch{}`;

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STATIC_PAGES, routeExists } from "../dashboard/frontend/src/services/route-data.js";

const app = fileURLToPath(
  new URL("../dashboard/frontend/app/", import.meta.url),
);
/** Every URL the app directory serves as a page (route groups carry no URL). */
const pageRoutes = readdirSync(app, { recursive: true })
  .map((file) => file.split(/[\\/]/))
  .filter((parts) => parts.at(-1) === "page.jsx")
  .map(
    (parts) =>
      "/" +
      parts
        .slice(0, -1)
        .filter((part) => !/^\(.*\)$/.test(part))
        .join("/"),
  );

test("every page of the app directory keeps its data providers", (t) => {
  assert.ok(pageRoutes.includes("/") && pageRoutes.includes("/clubs"));
  // /connexion and /compte are pages only with accounts on (account-switch.js); off, they are the 404 page.
  const saved = process.env.NEXT_PUBLIC_VEGA_ACCOUNTS;
  process.env.NEXT_PUBLIC_VEGA_ACCOUNTS = "1";
  t.after(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_VEGA_ACCOUNTS;
    else process.env.NEXT_PUBLIC_VEGA_ACCOUNTS = saved;
  });
  for (const route of pageRoutes.filter((route) => !STATIC_PAGES.has(route)))
    for (const suffix of route === "/" ? [""] : ["", "/"])
      assert.equal(
        routeExists(route + suffix),
        true,
        `${route}: add it to routeExists, or it renders without its data`,
      );
});

// The legal pages (/confidentialite, /conditions-utilisation, /conditions-generales-de-vente) are static text read by Google before it
// publishes the sign-in app: they render outside the data providers, so the server's HTML carries the
// whole page and nothing waits for the football API or depends on the account switch.
test("the static pages render without the data providers, with accounts on or off", (t) => {
  assert.deepEqual([...STATIC_PAGES].sort(), ["/conditions-generales-de-vente", "/conditions-utilisation", "/confidentialite"]);
  for (const route of STATIC_PAGES)
    assert.ok(pageRoutes.includes(route), `${route}: no page.jsx in the app directory`);
  const saved = process.env.NEXT_PUBLIC_VEGA_ACCOUNTS;
  t.after(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_VEGA_ACCOUNTS;
    else process.env.NEXT_PUBLIC_VEGA_ACCOUNTS = saved;
  });
  for (const accounts of ["1", "0"]) {
    process.env.NEXT_PUBLIC_VEGA_ACCOUNTS = accounts;
    for (const route of STATIC_PAGES)
      for (const suffix of ["", "/"])
        assert.equal(routeExists(route + suffix), false, `${route + suffix} (accounts ${accounts})`);
  }
});

test("an unmatched URL shows the 404 page without the data providers", () => {
  for (const path of [
    "/cette-page-nexiste-pas",
    "/cette-page-nexiste-pas/",
    "/clubs/inconnu",
    "/joueurs/matchs/inconnu",
    "/maquette",
    "/_not-found",
  ])
    assert.equal(routeExists(path), false, path);
});

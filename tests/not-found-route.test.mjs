import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { routeExists } from "../dashboard/frontend/src/services/route-data.js";

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

test("every page of the app directory keeps its data providers", () => {
  assert.ok(pageRoutes.includes("/") && pageRoutes.includes("/clubs"));
  for (const route of pageRoutes)
    for (const suffix of route === "/" ? [""] : ["", "/"])
      assert.equal(
        routeExists(route + suffix),
        true,
        `${route}: add it to routeExists, or it renders without its data`,
      );
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

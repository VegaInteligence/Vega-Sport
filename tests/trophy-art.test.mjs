import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { trophyArt } from "../dashboard/frontend/src/services/trophy-art.js";
import {
  MESSI_HONOURS,
  MESSI_ID,
} from "../dashboard/scripts/materialize_curated.mjs";

test("Messi's major trophies use distinct, available images", async () => {
  const items = MESSI_HONOURS.flatMap((group) => group.items);
  const image = (title) =>
    trophyArt(
      items.find((item) => item.title === title),
      MESSI_ID,
    );
  assert.equal(image("Coupe du monde"), "/trophies/world-cup.webp");
  assert.equal(image("Ligue des champions"), "/trophies/champions-league.webp");
  assert.equal(image("Ballon d’Or"), "/trophies/ballon-or.webp");
  assert.equal(image("Ligue 1"), "/trophies/ligue1-classic.webp");
  assert.equal(
    image("Coupe du monde des clubs"),
    "/trophies/club-world-cup.webp",
  );
  for (const item of items) {
    const src = trophyArt(item, MESSI_ID);
    if (src)
      await access(
        new URL(`../dashboard/frontend/public${src}`, import.meta.url),
      );
  }
});

test("the same verified trophy is shown for other players and unknown trophies have no substitute", () => {
  assert.equal(
    trophyArt({ title: "Ballon d'Or/FIFA Ballon d'Or", years: "2008, 2013, 2014, 2016, 2017" }),
    "/trophies/ballon-or.webp",
  );
  assert.equal(trophyArt({ title: "FIFA Ballon d'Or" }), "/trophies/ballon-or.webp");
  assert.equal(
    trophyArt(
      { title: "UEFA Champions League", years: "2024-2025" },
      "p_123456",
    ),
    "/trophies/champions-league.webp",
  );
  assert.equal(
    trophyArt({ title: "English FA Cup", years: "2024" }, "p_123456"),
    "/trophies/fa-cup.webp",
  );
  assert.equal(
    trophyArt({ title: "Une compétition inconnue", years: "2025" }, "p_123456"),
    null,
  );
  assert.equal(
    trophyArt({ title: "German Bundesliga" }),
    "/trophies/bundesliga.webp",
  );
  assert.equal(
    trophyArt({ title: "Italian Serie A" }),
    "/trophies/serie-a.webp",
  );
  assert.equal(
    trophyArt({ title: "French Coupe de la Ligue" }),
    "/trophies/coupe-ligue.webp",
  );
  assert.equal(
    trophyArt({ title: "Liga", trophyYear: 2018 }),
    "/trophies/liga.webp",
  );
  assert.equal(trophyArt({ title: "Liga" }), null);
});

test("different historical trophy designs are not mixed", () => {
  assert.equal(
    trophyArt({ title: "Ligue 1", years: "2023/2024" }),
    "/trophies/ligue1-classic.webp",
  );
  assert.equal(
    trophyArt({ title: "Ligue 1", years: "2024/2025" }),
    "/trophies/ligue1-2024.webp",
  );
  assert.equal(
    trophyArt({ title: "FIFA Club World Cup", years: "2025" }),
    "/trophies/club-world-cup-2025.webp",
  );
  assert.equal(trophyArt({ title: "FIFA World Cup", years: "1970" }), null);
});

test("Liga artwork covers the recent trophy editions", async () => {
  const image = "/trophies/liga-current.webp";
  assert.equal(trophyArt({ title: "La Liga", years: "2022–23" }), image);
  assert.equal(
    trophyArt({ title: "Spanish La Liga", years: "2023/2024" }),
    image,
  );
  assert.equal(trophyArt({ title: "Liga", years: "2024/2025" }), image);
  assert.equal(
    trophyArt({ title: "Liga", years: "2022–23, 2024–25, 2025–26" }),
    image,
  );
  await access(
    new URL(`../dashboard/frontend/public${image}`, import.meta.url),
  );
});

test("the current Henri Delaunay trophy is used for modern Euro editions", async () => {
  const image = "/trophies/euro-modern.webp";
  assert.equal(trophyArt({ title: "Euro", years: "2024" }), image);
  assert.equal(
    trophyArt({ title: "UEFA European Championship", years: "2008" }),
    image,
  );
  assert.equal(trophyArt({ title: "Euro", years: "2004" }), null);
  await access(
    new URL(`../dashboard/frontend/public${image}`, import.meta.url),
  );
});

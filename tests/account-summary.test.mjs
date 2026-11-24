// What /compte says about the account (VI-38, docs/COMPTES_SITE.md S1 to S5). Written before
// dashboard/frontend/src/services/account-summary.js:
//  S1 the monogram is one capital from the name, else from the address; nothing readable gives "".
//  S2 a null or damaged contract gives an empty summary and never throws.
//  S3 counts are per kind of distinct ids over every list.
//  S4 at most 8 favourites are listed, once each, in the lists' order; `more` counts the rest.
//  S5 the country: null → "auto", "none" → "none", a code → the code.
import test from "node:test";
import assert from "node:assert/strict";
import { FAVOURITES_SHOWN, accountInitial, accountSummary } from "../dashboard/frontend/src/services/account-summary.js";

const entry = (kind, id, name = id) => ({ kind, id, name, season: "", imageUrl: "" });
const contract = (patch = {}) => ({
  v: 1,
  leagues: [],
  country: null,
  theme: null,
  lists: [{ id: "main", name: "Ma sélection", entries: [] }],
  views: [],
  templates: [],
  ...patch,
});

test("S1 the monogram is one capital from the name, else from the address", () => {
  assert.equal(accountInitial({ name: "hugo lemonnier", email: "x@example.test" }), "H");
  assert.equal(accountInitial({ name: "", email: "zoe.martin@example.test" }), "Z");
  assert.equal(accountInitial({ name: "  ", email: "élodie@example.test" }), "É");
  assert.equal(accountInitial({ name: "", email: "_.7up@example.test" }), "7");
  assert.equal(accountInitial({ name: "", email: "@example.test" }), "");
  assert.equal(accountInitial({ name: "", email: "" }), "");
  assert.equal(accountInitial(null), "");
  assert.equal(accountInitial({ name: 4, email: {} }), "");
});

test("S2 a null or damaged contract gives an empty summary", () => {
  for (const value of [null, undefined, "x", 3, [], { lists: "no" }, { lists: [null, { entries: "no" }, { entries: [null, 3, {}] }] }]) {
    const out = accountSummary(value);
    assert.deepEqual(out.counts, { clubs: 0, nations: 0, players: 0, matches: 0 });
    assert.deepEqual(out.favourites, []);
    assert.equal(out.more, 0);
    assert.equal(out.leagues, 0);
    assert.equal(out.views, 0);
    assert.equal(out.templates, 0);
    assert.equal(out.country, "auto");
  }
});

test("S3 counts are per kind of distinct ids over every list", () => {
  const out = accountSummary(
    contract({
      leagues: ["l_a", "l_b", "l_c"],
      views: [{ id: "v1" }, { id: "v2" }],
      templates: [{ id: "t1" }],
      lists: [
        { id: "main", name: "Ma sélection", entries: [entry("clubs", "t_1"), entry("players", "p_1"), entry("nations", "t_9"), entry("matches", "m_1")] },
        { id: "b", name: "B", entries: [entry("clubs", "t_1"), entry("clubs", "t_2"), entry("players", "p_2"), entry("teams", "t_3"), { kind: "clubs" }] },
      ],
    }),
  );
  assert.deepEqual(out.counts, { clubs: 2, nations: 1, players: 2, matches: 1 });
  assert.equal(out.leagues, 3);
  assert.equal(out.views, 2);
  assert.equal(out.templates, 1);
});

test("S4 at most 8 favourites, once each, in the lists' order; matches are not listed", () => {
  assert.equal(FAVOURITES_SHOWN, 8);
  const many = Array.from({ length: 11 }, (_, i) => entry(i % 2 ? "players" : "clubs", `${i % 2 ? "p" : "t"}_${i}`, `Nom ${i}`));
  const out = accountSummary(
    contract({
      lists: [
        { id: "main", name: "Ma sélection", entries: [entry("matches", "m_1"), ...many.slice(0, 5)] },
        { id: "b", name: "B", entries: [many[0], ...many.slice(5)] },
      ],
    }),
  );
  assert.equal(out.favourites.length, 8);
  assert.deepEqual(out.favourites.map((e) => e.id), many.slice(0, 8).map((e) => e.id));
  assert.deepEqual(Object.keys(out.favourites[0]).sort(), ["id", "imageUrl", "kind", "name"]);
  assert.equal(out.more, 3);
  const all = accountSummary(
    { v: 1, lists: [{ id: "main", name: "x", entries: many }] },
    { shown: Infinity },
  );
  assert.equal(all.favourites.length, 11);
  assert.equal(all.more, 0);
  assert.equal(accountSummary({ v: 1, lists: [{ id: "main", name: "x", entries: many }] }, { shown: -2 }).favourites.length, 8);
  const few = accountSummary(contract({ lists: [{ id: "main", name: "x", entries: [entry("nations", "t_5", "France")] }] }));
  assert.deepEqual(few.favourites, [{ kind: "nations", id: "t_5", name: "France", imageUrl: "" }]);
  assert.equal(few.more, 0);
});

test("S5 the country: detection, none, or a code", () => {
  assert.equal(accountSummary(contract({ country: null })).country, "auto");
  assert.equal(accountSummary(contract({ country: "none" })).country, "none");
  assert.equal(accountSummary(contract({ country: "FRA" })).country, "FRA");
  assert.equal(accountSummary(contract({ country: 12 })).country, "auto");
});

// The account page « Lettre » (VI-38, docs/COMPTES_SITE.md section 10). Written before
// dashboard/frontend/src/services/account-page.js:
//  C2 the password row: Better Auth's listAccounts() answer → true (a credential account), false (none), null (unknown).
//  C3 the sync line: said only when the sync fails, is stopped or unavailable.
//  C4 the favourites: one group per kind, 6 each until opened, « Afficher l’autre » / « Afficher les N autres ».
import test from "node:test";
import assert from "node:assert/strict";
import {
  FAVOURITES_PER_KIND,
  favouriteGroups,
  hasPassword,
  moreLabel,
  syncNote,
} from "../dashboard/frontend/src/services/account-page.js";

const entry = (kind, n) => ({ kind, id: `${kind[0]}_${n}`, name: `${kind} ${n}`, imageUrl: "" });

test("C2 a credential account has a password; Google alone has none", () => {
  assert.equal(hasPassword({ data: [{ providerId: "credential", accountId: "x" }] }), true);
  assert.equal(hasPassword({ data: [{ providerId: "google" }, { providerId: "credential" }] }), true);
  assert.equal(hasPassword({ data: [{ providerId: "google" }] }), false);
  assert.equal(hasPassword({ data: [] }), false);
});

test("C2 an error, a missing or a strange answer is unknown: the row stays hidden", () => {
  for (const answer of [undefined, null, {}, { error: { status: 500 } }, { data: null, error: { status: 401 } }, { data: "credential" }, { data: { providerId: "credential" } }, "x"])
    assert.equal(hasPassword(answer), null, JSON.stringify(answer));
  assert.equal(hasPassword({ data: [null, 3, { providerId: "credential" }] }), true);
});

test("C3 nothing is said while the sync works or is about to", () => {
  for (const state of ["idle", "syncing", "synced", "something-new", undefined]) assert.equal(syncNote({ state }, true), null, String(state));
  assert.equal(syncNote(null, true), null);
});

test("C3 a failing, stopped or unavailable sync is said, with its reason", () => {
  assert.deepEqual(syncNote({ state: "failed", reason: "Serveur injoignable." }, true), {
    state: "failed",
    text: "Synchronisation en échec",
    detail: "Serveur injoignable. Nouvel essai au prochain changement.",
  });
  assert.deepEqual(syncNote({ state: "failed" }, true), { state: "failed", text: "Synchronisation en échec", detail: "Nouvel essai au prochain changement." });
  assert.deepEqual(syncNote({ state: "stopped", reason: "Version de préférences non reconnue : 2." }, true), {
    state: "stopped",
    text: "Synchronisation arrêtée",
    detail: "Version de préférences non reconnue : 2.",
  });
  assert.deepEqual(syncNote({ state: "unavailable" }, true), { state: "unavailable", text: "Synchronisation indisponible", detail: undefined });
});

test("C3 without the account API the sync is unavailable, whatever the state says (W2)", () => {
  for (const state of ["idle", "synced", "failed"]) assert.equal(syncNote({ state }, false)?.text, "Synchronisation indisponible");
});

test("C4 one group per kind, in the order clubs, players, nations, each in the lists' order", () => {
  const favourites = [entry("players", 1), entry("clubs", 1), entry("nations", 1), entry("clubs", 2), entry("matches", 1)];
  const groups = favouriteGroups(favourites);
  assert.deepEqual(
    groups.map((g) => [g.kind, g.label, g.entries.map((e) => e.id), g.more]),
    [
      ["clubs", "Clubs", ["c_1", "c_2"], 0],
      ["players", "Joueurs", ["p_1"], 0],
      ["nations", "Nations", ["n_1"], 0],
    ],
  );
});

test("C4 six per kind, then the rest when that kind is opened", () => {
  assert.equal(FAVOURITES_PER_KIND, 6);
  const favourites = [...Array.from({ length: 9 }, (_, i) => entry("clubs", i)), ...Array.from({ length: 7 }, (_, i) => entry("players", i))];
  const closed = favouriteGroups(favourites);
  assert.deepEqual(closed.map((g) => [g.kind, g.entries.length, g.more]), [["clubs", 6, 3], ["players", 6, 1]]);
  assert.deepEqual(closed[0].entries.map((e) => e.id), ["c_0", "c_1", "c_2", "c_3", "c_4", "c_5"]);
  const opened = favouriteGroups(favourites, new Set(["players"]));
  assert.deepEqual(opened.map((g) => [g.kind, g.entries.length, g.more]), [["clubs", 6, 3], ["players", 7, 0]]);
});

test("C4 no favourite, or a damaged list, gives no group", () => {
  assert.deepEqual(favouriteGroups([]), []);
  assert.deepEqual(favouriteGroups(null), []);
  assert.deepEqual(favouriteGroups([null, { kind: "clubs" }, { kind: "teams", id: "t_1" }, { kind: "matches", id: "m_1" }]), []);
});

test("C4 the words of the rest", () => {
  assert.equal(moreLabel(1), "Afficher l’autre");
  assert.equal(moreLabel(2), "Afficher les 2 autres");
  assert.equal(moreLabel(12), "Afficher les 12 autres");
});

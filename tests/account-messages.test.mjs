// The plain-French messages of the account screens (VI-38, docs/COMPTES_SITE.md O5, O8, A10). Written before
// dashboard/frontend/src/services/account-messages.js:
//  O5 sign-in and sign-up errors of Better Auth / Neon (codes, statuses, transport codes) read as plain French and
//     never repeat the address typed.
//  O8 the deletion's refusals (503 DELETION_UNAVAILABLE, 409 SUBSCRIPTION_ACTIVE, 502 IDENTITY_DELETE_FAILED) in
//     plain words.
//  A10 every sync state has its label; « arrêtée » carries the reason.
import test from "node:test";
import assert from "node:assert/strict";
import {
  authErrorMessage,
  deletionMessage,
  planLabel,
  syncLabel,
} from "../dashboard/frontend/src/services/account-messages.js";
import { AccountApiError } from "../dashboard/frontend/src/services/account-sync.js";

test("O5 sign-in and sign-up errors in plain French", () => {
  const cases = [
    [{ status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, /adresse ou mot de passe incorrect/i],
    [{ status: 422, code: "USER_ALREADY_EXISTS", message: "User already exists" }, /existe déjà/],
    [{ status: 422, code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" }, /existe déjà/],
    [{ status: 400, code: "PASSWORD_TOO_SHORT" }, /8 caractères/],
    [{ status: 400, code: "PASSWORD_TOO_LONG" }, /trop long/],
    [{ status: 400, code: "INVALID_EMAIL" }, /adresse e-mail/],
    [{ status: 429 }, /trop de tentatives/i],
    [{ status: 502, code: "NETWORK_DNS" }, /injoignable/],
    [{ status: 403, code: "INVALID_ORIGIN" }, /injoignable|indisponible/],
    [{ status: 500 }, /indisponible/],
    [new TypeError("fetch failed"), /injoignable/],
    [{ status: 403, code: "EMAIL_NOT_VERIFIED" }, /confirmer/],
    [{ status: 400, code: "PROVIDER_NOT_FOUND" }, /Google/],
  ];
  // @neon/auth 0.8.2's client shape (createHttpResponseError): a normalized Supabase-style `code` and `status`,
  // and Better Auth's raw answer as `.error` ({ code, message, status }), read first.
  const neon = (status, raw, normalized) => ({ status, code: normalized, message: "x", error: { status, ...(raw && { code: raw }) } });
  cases.push(
    [neon(401, "INVALID_EMAIL_OR_PASSWORD", "invalid_credentials"), /adresse ou mot de passe incorrect/i],
    [neon(422, "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", "user_already_exists"), /existe déjà/],
    [neon(400, "PASSWORD_TOO_SHORT", "weak_password"), /8 caractères/],
    [neon(401, null, "invalid_credentials"), /adresse ou mot de passe incorrect/i],
    [neon(422, null, "email_exists"), /existe déjà/],
    [neon(400, null, "email_address_invalid"), /adresse e-mail/],
    [neon(429, null, "over_request_rate_limit"), /trop de tentatives/i],
    [neon(404, null, "oauth_provider_not_supported"), /Google/],
  );
  for (const [error, pattern] of cases) assert.match(authErrorMessage(error), pattern, JSON.stringify(error));
  // The address typed is never repeated.
  assert.doesNotMatch(authErrorMessage({ status: 400, message: "person@example.com is invalid" }), /person@example\.com/);
});

test("O8 the deletion's refusals in plain words", () => {
  const error = (status, code, extra = {}) => new AccountApiError(status, { ok: false, ...extra, error: { code, message: "m", retry: false } });
  assert.match(deletionMessage(error(503, "DELETION_UNAVAILABLE")), /pas encore possible/);
  assert.match(deletionMessage(error(409, "SUBSCRIPTION_ACTIVE")), /abonnement/);
  assert.match(deletionMessage(error(502, "IDENTITY_DELETE_FAILED", { erased: true })), /Réessayez/);
  assert.match(deletionMessage(error(503, "SYNC_UNAVAILABLE")), /pas encore possible/);
  assert.match(deletionMessage(new AccountApiError(0, null)), /ne répond pas/);
});

test("A10 every sync state has a label, « arrêtée » with its reason", () => {
  assert.equal(syncLabel({ state: "synced" }).text, "À jour");
  assert.equal(syncLabel({ state: "syncing" }).text, "En cours");
  assert.equal(syncLabel({ state: "idle" }).text, "En cours");
  assert.equal(syncLabel({ state: "unavailable" }).text, "Indisponible");
  assert.match(syncLabel({ state: "failed", reason: "Le serveur des comptes ne répond pas." }).text, /^En échec/);
  const stopped = syncLabel({ state: "stopped", reason: "Version de préférences non reconnue : 2." });
  assert.equal(stopped.text, "Arrêtée");
  assert.equal(stopped.detail, "Version de préférences non reconnue : 2.");
  // S11: the short form for the header of /compte, and the failed state's detail.
  assert.deepEqual(
    ["synced", "syncing", "idle", "failed", "stopped", "unavailable"].map((state) => syncLabel({ state }).pill),
    ["Synchronisé", "Synchronisation…", "Synchronisation…", "Synchro en échec", "Synchro arrêtée", "Synchro indisponible"],
  );
  const failed = syncLabel({ state: "failed", reason: "Le serveur des comptes ne répond pas." });
  assert.equal(failed.text, "En échec");
  assert.equal(failed.detail, "Le serveur des comptes ne répond pas. Nouvel essai au prochain changement.");
  assert.equal(syncLabel({ state: "failed" }).detail, "Nouvel essai au prochain changement.");
  assert.equal(planLabel(1), "Gratuit");
  assert.equal(planLabel(null), "Gratuit");
  assert.equal(planLabel(2), "Plus");
  assert.equal(planLabel(3), "Pro");
});

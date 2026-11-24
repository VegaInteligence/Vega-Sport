// The return from Google (VI-38, docs/COMPTES_SITE.md section 9). Written before
// dashboard/frontend/src/services/account-return.js and returnErrorMessage in account-messages.js:
//  G1 the social sign-in gets an absolute error return on /connexion with the same `next`; the callback is unchanged.
//  G2 each code Neon or Google sends back reads as one plain French sentence; an unknown one carries its code.
//  G3 only a clean code is ever shown; error_description never.
//  G4 `error` and `error_description` leave the address, `next` and the rest stay.
//  G5 a verifier return without a user goes to /connexion with the code get-session answered, or session_not_opened.
//  G6 a verifier in the address is a reason to read the session; without one the hint rule is unchanged.
//  G7 `next` follows O4; the target carries no verifier.
import test from "node:test";
import assert from "node:assert/strict";
import {
  VERIFIER_PARAM,
  failedReturnHref,
  googleReturn,
  hasVerifier,
  readsSession,
  returnError,
  returnErrorCode,
} from "../dashboard/frontend/src/services/account-return.js";
import { returnErrorMessage } from "../dashboard/frontend/src/services/account-messages.js";
import { HINT_KEY } from "../dashboard/frontend/src/services/account-hint.js";

const ORIGIN = "https://vegasport.vercel.app";
const storage = (hint) => ({ getItem: (key) => (hint && key === HINT_KEY ? "1" : null) });

test("G1 the social sign-in returns to the page, or to /connexion with the same next on an error", () => {
  assert.deepEqual(googleReturn(ORIGIN, "/"), { callbackURL: `${ORIGIN}/`, errorCallbackURL: `${ORIGIN}/connexion` });
  assert.deepEqual(googleReturn(ORIGIN, "/clubs?id=t_1iaglr"), {
    callbackURL: `${ORIGIN}/clubs?id=t_1iaglr`,
    errorCallbackURL: `${ORIGIN}/connexion?next=%2Fclubs%3Fid%3Dt_1iaglr`,
  });
  // A `next` that is not a path of this site never reaches either URL (O4).
  for (const next of ["https://evil.test/", "//evil.test", "/connexion", "javascript:alert(1)"])
    assert.deepEqual(googleReturn(ORIGIN, next), { callbackURL: `${ORIGIN}/`, errorCallbackURL: `${ORIGIN}/connexion` }, next);
});

test("G2 the codes sent back read in plain French", () => {
  assert.match(returnErrorMessage("account_not_linked"), /mot de passe/);
  assert.match(returnErrorMessage("account_not_linked"), /confirm/);
  assert.match(returnErrorMessage("access_denied"), /Google/);
  assert.match(returnErrorMessage("access_denied"), /annulée|refusée/);
  const generic = returnErrorMessage("state_mismatch");
  assert.match(generic, /Google/);
  assert.match(generic, /\(state_mismatch\)$/, "an unknown code follows the sentence, in parentheses");
  assert.notEqual(generic.replace(/\s*\(state_mismatch\)$/, ""), "", "never the code alone");
  assert.match(returnErrorMessage("VERIFICATION_NOT_FOUND"), /\(VERIFICATION_NOT_FOUND\)$/);
  assert.match(returnErrorMessage("session_not_opened"), /\(session_not_opened\)$/);
  // No code at all, or one that is not clean: the generic sentence alone.
  for (const code of ["", null, undefined]) assert.doesNotMatch(returnErrorMessage(code), /\(/, String(code));
});

test("G3 only a clean code is read from the address", () => {
  const cases = [
    ["?error=account_not_linked", "account_not_linked"],
    ["?error=please_restart_the_process&error_description=State+not+found", "please_restart_the_process"],
    ["?error=STATE-MISMATCH", "STATE-MISMATCH"],
    ["?error=person%40example.com", ""],
    ["?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E", ""],
    [`?error=${"a".repeat(65)}`, ""],
    ["?error=", ""],
  ];
  for (const [search, code] of cases) {
    const read = returnError(search);
    assert.equal(read.present, true, search);
    assert.equal(read.code, code, search);
  }
  assert.equal(returnError("?next=%2Fclubs").present, false);
  assert.equal(returnError("").present, false);
  assert.doesNotMatch(returnErrorMessage(returnError("?error=person%40example.com").code), /@|example/);
});

test("G4 the error leaves the address, next and the rest stay", () => {
  assert.equal(returnError("?next=%2Fclubs%3Fid%3Dt_1&error=access_denied").search, "?next=%2Fclubs%3Fid%3Dt_1");
  assert.equal(returnError("?error=access_denied&error_description=x&next=%2F&season=2026%2F2027").search, "?next=%2F&season=2026%2F2027");
  assert.equal(returnError("?error=access_denied").search, "");
  assert.equal(returnError("?next=%2Fclubs").search, "?next=%2Fclubs");
});

test("G5 a verifier return without a user goes to /connexion with the code", () => {
  const page = { pathname: "/clubs", search: `?id=t_1iaglr&${VERIFIER_PARAM}=abc&season=2026%2F2027` };
  // @neon/auth 0.8.2's thrown error (createHttpResponseError): Better Auth's raw answer as `.error`.
  const neon400 = { status: 400, code: "bad_request", error: { code: "VERIFICATION_NOT_FOUND", status: 400 } };
  assert.equal(returnErrorCode(neon400), "VERIFICATION_NOT_FOUND");
  assert.equal(returnErrorCode({ error: { code: "SESSION_CHALLENGE_COOKIE_NOT_FOUND" } }), "SESSION_CHALLENGE_COOKIE_NOT_FOUND");
  assert.equal(returnErrorCode({ code: "session_expired" }), "session_expired");
  for (const failure of [null, undefined, {}, new TypeError("fetch failed"), { error: { code: "a b" } }])
    assert.equal(returnErrorCode(failure), "session_not_opened", String(failure));
  const href = failedReturnHref(page, neon400);
  const url = new URL(href, ORIGIN);
  assert.equal(url.pathname, "/connexion");
  assert.equal(url.searchParams.get("error"), "VERIFICATION_NOT_FOUND");
  assert.equal(url.searchParams.get("next"), "/clubs?id=t_1iaglr&season=2026%2F2027");
  assert.equal(href.includes(VERIFIER_PARAM), false, "G7 the target carries no verifier");
  assert.equal(new URL(failedReturnHref({ pathname: "/", search: `?${VERIFIER_PARAM}=abc` }, null), ORIGIN).searchParams.get("next"), null, "next / is left out");
  assert.equal(new URL(failedReturnHref({ pathname: "/", search: `?${VERIFIER_PARAM}=abc` }, null), ORIGIN).searchParams.get("error"), "session_not_opened");
  // G7: /connexion itself is never the next page.
  assert.equal(new URL(failedReturnHref({ pathname: "/connexion", search: `?${VERIFIER_PARAM}=abc` }, null), ORIGIN).searchParams.get("next"), null);
});

test("G6 a verifier in the address is a reason to read the session; the hint rule is otherwise unchanged", () => {
  assert.equal(hasVerifier(`?${VERIFIER_PARAM}=abc`), true);
  assert.equal(hasVerifier(`?season=x&${VERIFIER_PARAM}=abc`), true);
  assert.equal(hasVerifier("?season=x"), false);
  assert.equal(hasVerifier(""), false);
  assert.equal(readsSession({ storage: storage(false), search: `?${VERIFIER_PARAM}=abc` }), true);
  assert.equal(readsSession({ storage: storage(false), search: "" }), false);
  assert.equal(readsSession({ storage: storage(true), search: "" }), true);
  assert.equal(readsSession({ storage: storage(false), force: true, search: "" }), true);
  assert.equal(readsSession({ storage: null, search: "" }), false);
});

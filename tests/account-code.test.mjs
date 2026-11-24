// The e-mail codes of /connexion (VI-38, docs/COMPTES_SITE.md section 8). Written before
// dashboard/frontend/src/services/account-code.js and the new sentences of account-messages.js:
//  R1 a sign-up answer without a session token asks for the address to be confirmed; with one it does not.
//  R2 EMAIL_NOT_VERIFIED at sign-in is told apart from every other refusal.
//  R3 a pasted code keeps its digits, six at most; fewer than six is not ready.
//  R4 a wrong, expired or used-up code reads in plain French, never the address.
//  R8 the reset request tries Better Auth's current route, then the one Neon documents on a 404 only.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CODE_LENGTH,
  RESEND_WAIT_SECONDS,
  cleanCode,
  codeReady,
  isUnverified,
  needsConfirmation,
  requestPasswordReset,
} from "../dashboard/frontend/src/services/account-code.js";
import { authErrorMessage } from "../dashboard/frontend/src/services/account-messages.js";

test("R3 a pasted code keeps its digits, six at most", () => {
  assert.equal(CODE_LENGTH, 6);
  const cases = [
    ["123456", "123456"],
    [" 123 456 ", "123456"],
    ["Votre code : 482-913.", "482913"],
    ["1234567890", "123456"],
    ["12a4", "124"],
    ["١٢٣٤٥٦", ""], // other scripts' digits are not the code Neon sends
    ["", ""],
    [null, ""],
    [undefined, ""],
    [123456, "123456"],
  ];
  for (const [typed, expected] of cases) assert.equal(cleanCode(typed), expected, JSON.stringify(typed));
  assert.equal(codeReady("123456"), true);
  assert.equal(codeReady("12345"), false);
  assert.equal(codeReady(""), false);
  assert.equal(codeReady("12345a"), false);
  assert.equal(codeReady(" 123456"), false, "the field holds a cleaned value: anything else is not ready");
});

test("R5 the wait before another code is thirty seconds", () => {
  assert.equal(RESEND_WAIT_SECONDS, 30);
});

test("R1 a sign-up answer without a session token asks for the confirmation", () => {
  const user = { id: "u1", email: "a@example.test", emailVerified: false };
  assert.equal(needsConfirmation({ data: { token: null, user }, error: null }), true);
  assert.equal(needsConfirmation({ data: { user }, error: null }), true);
  assert.equal(needsConfirmation({ data: { token: "", user }, error: null }), true);
  assert.equal(needsConfirmation({ data: { token: "s3ss10n", user }, error: null }), false, "verification off: signed in");
  assert.equal(needsConfirmation({ data: { token: "s3ss10n", user: { ...user, emailVerified: true } } }), false);
  // No user at all is not a sign-up answer: nothing to confirm.
  assert.equal(needsConfirmation({ data: null, error: null }), false);
  assert.equal(needsConfirmation(null), false);
  assert.equal(needsConfirmation({ data: { token: null } }), false);
});

test("R2 EMAIL_NOT_VERIFIED is told apart from the other refusals", () => {
  const neon = (status, raw, normalized) => ({ status, code: normalized, message: "x", error: { status, ...(raw && { code: raw }) } });
  assert.equal(isUnverified({ status: 403, code: "EMAIL_NOT_VERIFIED" }), true);
  assert.equal(isUnverified(neon(403, "EMAIL_NOT_VERIFIED", "email_not_confirmed")), true);
  assert.equal(isUnverified({ status: 403, code: "email_not_confirmed" }), true);
  assert.equal(isUnverified(neon(401, "INVALID_EMAIL_OR_PASSWORD", "invalid_credentials")), false);
  assert.equal(isUnverified({ status: 403 }), false, "a bare 403 is not it (an origin refusal is one too)");
  assert.equal(isUnverified(new TypeError("fetch failed")), false);
  assert.equal(isUnverified(null), false);
});

test("R4 a wrong, expired or used-up code in plain French", () => {
  const neon = (status, raw) => ({ status, code: "unknown_error", message: "x", error: { status, code: raw } });
  const cases = [
    [{ status: 400, code: "INVALID_OTP" }, /^Code incorrect\.$/],
    [neon(400, "INVALID_OTP"), /^Code incorrect\.$/],
    [{ status: 400, code: "OTP_EXPIRED" }, /expiré.*nouveau/],
    [neon(400, "OTP_EXPIRED"), /expiré.*nouveau/],
    [{ status: 403, code: "TOO_MANY_ATTEMPTS" }, /Trop d.essais.*nouveau code/],
    [neon(403, "TOO_MANY_ATTEMPTS"), /Trop d.essais.*nouveau code/],
    [{ status: 429, code: "over_email_send_rate_limit" }, /Trop de/i],
  ];
  for (const [error, pattern] of cases) {
    const text = authErrorMessage(error);
    assert.match(text, pattern, JSON.stringify(error));
    assert.doesNotMatch(text, /@/);
  }
});

test("R8 the reset request: the current route, then Neon's documented one on a 404 only", async () => {
  const calls = [];
  const client = (first, second) => ({
    emailOtp: {
      requestPasswordReset: async (body) => {
        calls.push(["emailOtp.requestPasswordReset", body]);
        if (first instanceof Error) throw first;
        return first;
      },
    },
    forgetPassword: {
      emailOtp: async (body) => {
        calls.push(["forgetPassword.emailOtp", body]);
        return second;
      },
    },
  });
  const ok = { data: { success: true }, error: null };

  let out = await requestPasswordReset(client(ok, ok), "a@example.test");
  assert.deepEqual(out, ok);
  assert.deepEqual(calls, [["emailOtp.requestPasswordReset", { email: "a@example.test" }]]);

  calls.length = 0;
  out = await requestPasswordReset(client({ data: null, error: { status: 404 } }, ok), "a@example.test");
  assert.deepEqual(out, ok, "404: the other route's answer");
  assert.deepEqual(calls.map(([name]) => name), ["emailOtp.requestPasswordReset", "forgetPassword.emailOtp"]);

  calls.length = 0;
  out = await requestPasswordReset(client({ data: null, error: { status: 404, error: { status: 404 } } }, { data: null, error: { status: 429 } }), "a@example.test");
  assert.equal(out.error.status, 429, "the fallback's own refusal is the answer");

  for (const refusal of [{ status: 429 }, { status: 500 }, { status: 400, code: "INVALID_EMAIL" }]) {
    calls.length = 0;
    out = await requestPasswordReset(client({ data: null, error: refusal }, ok), "a@example.test");
    assert.deepEqual(out.error, refusal, "any other refusal is not retried on the other route");
    assert.equal(calls.length, 1);
  }

  calls.length = 0;
  await assert.rejects(requestPasswordReset(client(new TypeError("fetch failed"), ok), "a@example.test"), TypeError);
  assert.equal(calls.length, 1, "no answer at all is not a 404");
});

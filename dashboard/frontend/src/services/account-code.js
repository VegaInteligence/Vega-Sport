/**
 * The e-mail codes of /connexion (VI-38, docs/COMPTES_SITE.md section 8): the address confirmation and the forgotten
 * password both go through a six-digit code sent by Neon Auth (Better Auth's Email OTP).
 */

export const CODE_LENGTH = 6;
export const RESEND_WAIT_SECONDS = 30;

/** What a person typed or pasted → its ASCII digits, six at most (R3). */
export function cleanCode(text) {
  return String(text ?? "").replace(/[^0-9]/g, "").slice(0, CODE_LENGTH);
}

/** A cleaned field value that can be sent. */
export const codeReady = (code) => typeof code === "string" && new RegExp(`^[0-9]{${CODE_LENGTH}}$`).test(code);

/** A sign-up answer with a user and no session token: the address must be confirmed first (R1). */
export function needsConfirmation(answer) {
  const data = answer?.data;
  return Boolean(data?.user) && !data.token;
}

/** The refusal of a sign-in whose address was never confirmed (R2); a bare 403 is not one. */
export function isUnverified(error) {
  const raw = error?.error && typeof error.error === "object" ? error.error : {};
  return [raw.code, error?.code].some((code) => code === "EMAIL_NOT_VERIFIED" || code === "email_not_confirmed");
}

const statusOf = (error) => Number(error?.error?.status ?? error?.status) || 0;

/**
 * Asks for a reset code: Better Auth's current route, then the one Neon documents when the server answers 404 (R8).
 * The answer is the same whether the address has an account or not (R7).
 */
export async function requestPasswordReset(client, email) {
  const first = await client.emailOtp.requestPasswordReset({ email });
  if (statusOf(first?.error) !== 404) return first;
  return client.forgetPassword.emailOtp({ email });
}

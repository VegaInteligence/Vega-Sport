// The return from Google (VI-38, docs/COMPTES_SITE.md section 9). Pure: no window, no React.
// Tests: tests/account-return.test.mjs.
import { SIGN_IN_PATH, safeNext, signInHref } from "./account-links.js";
import { shouldReadSession } from "./account-hint.js";

/** The one-time value Neon's callback adds to `callbackURL`; the next session read exchanges it (@neon/auth). */
export const VERIFIER_PARAM = "neon_auth_session_verifier";
const ERROR_PARAMS = ["error", "error_description"];
const CLEAN_CODE = /^[A-Za-z0-9_-]{1,64}$/;

const params = (search) => new URLSearchParams(typeof search === "string" ? search : "");
const asSearch = (query) => {
  const text = query.toString();
  return text ? `?${text}` : "";
};
const clean = (code) => (typeof code === "string" && CLEAN_CODE.test(code) ? code : "");

/** G1: where Neon sends the person back: the page (`next`) on success, /connexion with the same `next` on an error. */
export function googleReturn(origin, next) {
  const page = safeNext(next);
  return { callbackURL: `${origin}${page}`, errorCallbackURL: `${origin}${signInHref(page)}` };
}

/** G2 to G4: the code of `?error=` (only a clean one, else ""), and the address's query without it. */
export function returnError(search) {
  const query = params(search);
  const present = query.has("error");
  const code = clean(query.get("error"));
  for (const name of ERROR_PARAMS) query.delete(name);
  return { present, code, search: asSearch(query) };
}

export const hasVerifier = (search) => params(search).has(VERIFIER_PARAM);

/** G6: a verifier in the address is a reason to read the session; otherwise the hint rule (W6). */
export const readsSession = ({ storage, force = false, search = "" }) => shouldReadSession({ storage, force: force || hasVerifier(search) });

/** G5: the code the session read answered (Better Auth's raw code first), else session_not_opened. */
export function returnErrorCode(failure) {
  const raw = failure?.error && typeof failure.error === "object" ? clean(failure.error.code) : "";
  return raw || clean(failure?.code) || "session_not_opened";
}

/** G5, G7: /connexion with the code and the page without the verifier as `next`. */
export function failedReturnHref({ pathname = "/", search = "" } = {}, failure) {
  const query = params(search);
  query.delete(VERIFIER_PARAM);
  const next = safeNext(`${pathname}${asSearch(query)}`);
  const target = new URLSearchParams({ error: returnErrorCode(failure) });
  if (next !== "/") target.set("next", next);
  return `${SIGN_IN_PATH}?${target}`;
}

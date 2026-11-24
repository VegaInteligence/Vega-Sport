/**
 * The hint that this browser may hold a session (VI-38; docs/COMPTES_SITE.md, W6). Neon's cookies are out of the
 * page's reach, so without it every page load of every visitor would ask /api/auth whether someone is signed in.
 * One fixed value under one key: it says nothing about the person. Tests: tests/account-hint.test.mjs.
 */
export const HINT_KEY = "vega.account.hint.v1";

export function hasHint(storage) {
  try {
    return storage?.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}
export function setHint(storage) {
  try {
    storage?.setItem(HINT_KEY, "1");
  } catch {}
}
export function clearHint(storage) {
  try {
    storage?.removeItem(HINT_KEY);
  } catch {}
}
/** Whether to ask for the session now: always when forced (/connexion, a sign-in), else only with the hint. */
export const shouldReadSession = ({ storage, force = false }) => force || hasHint(storage);

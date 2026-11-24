/** The account pages' addresses (VI-38) and the safe return path of /connexion (docs/COMPTES_SITE.md, O4). */
export const SIGN_IN_PATH = "/connexion";
export const ACCOUNT_PATH = "/compte";

/** `value` when it is a path of this site, else "/". Never another origin, a scheme or /connexion itself. */
export function safeNext(value) {
  if (typeof value !== "string" || value.length > 512) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/";
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "/";
  }
  if (decoded.startsWith("//") || decoded.startsWith("/\\") || /[\u0000-\u001f\u007f]/.test(decoded)) return "/";
  let parsed;
  try {
    parsed = new URL(value, "https://site.invalid");
  } catch {
    return "/";
  }
  if (parsed.origin !== "https://site.invalid") return "/";
  if (parsed.pathname.replace(/\/+$/, "") === SIGN_IN_PATH) return "/";
  return value;
}

/** /connexion, with ?next= when there is somewhere to come back to. */
export function signInHref(next) {
  const target = safeNext(next);
  return target === "/" ? SIGN_IN_PATH : `${SIGN_IN_PATH}?next=${encodeURIComponent(target)}`;
}

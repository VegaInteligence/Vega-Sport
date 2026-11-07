import { safeResolvedMedia } from "./resolved-media.js";
let enabled = false;
let snapshot = Object.freeze(Object.create(null));
const listeners = new Set();
const limit = 2048;
const sourceAllowed = (value) => {
  try {
    const u = new URL(value);
    return (
      value.length <= 2048 &&
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (u.hostname === "cdn.pitchapi.dev" ||
        (u.hostname === "upload.wikimedia.org" &&
          /^\/wikipedia\/commons\//.test(u.pathname)) ||
        (u.hostname === "img.thesports.com" &&
          /^\/football\/(?:team|competition)\/[a-z0-9]+\.(?:png|webp|jpe?g)$/i.test(
            u.pathname,
          )))
    );
  } catch {
    return false;
  }
};
export function mediaRepresentationEnabled() {
  return typeof window !== "undefined" && enabled;
}
export function getResolvedSnapshot() {
  return typeof window === "undefined" ? null : snapshot;
}
export function resolveRegisteredMedia(
  source,
  initial,
  current = getResolvedSnapshot(),
) {
  return source && current && Object.hasOwn(current, source)
    ? current[source] || ""
    : initial;
}
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const subscribeMedia = subscribe;
/** Only public verified mappings are retained, never data from an SSR request. */
export function acceptMediaPayload(path, body) {
  if (typeof window === "undefined" || !body || typeof body !== "object")
    return;
  let pathname;
  try {
    pathname = new URL(path, "https://statarena.invalid").pathname;
  } catch {
    return;
  }
  if (pathname === "/api/dashboard/manifest")
    enabled = body.capabilities?.resolvedMedia === true;
  const media = body.media;
  if (!media || typeof media !== "object" || Array.isArray(media)) return;
  const map = new Map(Object.entries(snapshot));
  let changed = false;
  // An explicit fresh representation may remove an alias; do not retain its
  // previous immutable object after the mapping is no longer published.
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (
        (key === "imageUrl" || key === "image_url") &&
        typeof item === "string" &&
        !Object.hasOwn(media, item) &&
        sourceAllowed(item) &&
        map.get(item) !== null
      ) {
        map.delete(item);
        map.set(item, null);
        changed = true;
      } else if (item && typeof item === "object") visit(item);
    }
  };
  visit(body.data);
  for (const [source, value] of Object.entries(media)) {
    const target = safeResolvedMedia(value);
    if (!sourceAllowed(source)) continue;
    if (!target) {
      if (map.get(source) !== null) {
        map.delete(source);
        map.set(source, null);
        changed = true;
      }
      continue;
    }
    if (map.get(source) === target) continue;
    map.delete(source);
    map.set(source, target);
    changed = true;
  }
  if (!changed) return;
  while (map.size > limit) map.delete(map.keys().next().value);
  snapshot = Object.freeze(Object.fromEntries(map));
  for (const listener of listeners) listener();
}

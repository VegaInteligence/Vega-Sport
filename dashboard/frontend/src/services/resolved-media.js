import { API_ORIGIN } from "../api-origin.js";

/** The address of an image copy the API's distribution serves (data/sources/…/<hash>.<ext>), else "". */
export function safeResolvedMedia(value) {
  try {
    const url = new URL(value);
    return url.origin === API_ORIGIN &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/data\/sources\/[A-Za-z0-9_./-]+(?:-|\/)[a-f0-9]{24,64}\.(?:webp|png|jpe?g)$/.test(
        url.pathname,
      ) &&
      !url.pathname.split("/").some((part) => part.startsWith("."))
      ? url.href
      : "";
  } catch {
    return "";
  }
}

/**
 * The copy of a provider image, addressed without asking the API. The worker stores a copy
 * under the SHA-256 of its bytes (backend/vega/media.py), and the provider's CDN names a
 * file by that same hash: on 11 November 2026 each of the 274 images of the home, clubs
 * and players reads had a copy carrying its source's file name. An image without a copy
 * there answers an error, and Media falls back to /api/assets.
 */
export function directMediaCopy(value) {
  try {
    const url = new URL(value);
    const file =
      url.protocol === "https:" &&
      url.hostname === "cdn.pitchapi.dev" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
        ? /^\/images\/[a-z0-9_-]+\/([a-f0-9]{64})\.(webp|png|jpe?g)$/.exec(
            url.pathname,
          )
        : null;
    return file
      ? `${API_ORIGIN}/data/sources/v2/images/${file[1]}.${file[2] === "jpeg" ? "jpg" : file[2]}`
      : "";
  } catch {
    return "";
  }
}

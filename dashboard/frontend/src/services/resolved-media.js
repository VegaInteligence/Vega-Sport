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

import { apiUrl } from "../data-url.js";
import { createResourceCache } from "./resource-cache.js";
import { readPublicApi, wasPublicApiThrottle } from "./public-api-fetch.js";

const caches = new WeakMap();
// Match the existing asset publisher's accepted upper bound.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_RETAINED_IMAGE_BYTES = 256 * 1024;

/** Blob bytes are shared; each mounted image owns and releases its object URL. */
export async function loadMediaAsset(source, { signal, fetcher = fetch } = {}) {
  const url = apiUrl(source);
  if (
    !new URL(url, "https://statarena.invalid").pathname.match(/^\/api\/assets$/)
  )
    throw new Error("Route d’image invalide.");
  if (!caches.has(fetcher))
    caches.set(
      fetcher,
      createResourceCache({ maxEntries: 64, maxAge: 60_000 }),
    );
  const cache = caches.get(fetcher);
  const blob = await cache.read(
    url,
    async ({ signal: sharedSignal }) => {
      return readPublicApi(
        url,
        {
          signal: sharedSignal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: { Accept: "image/*" },
        },
        async (response) => {
          if (!response.ok) {
            const error = new Error(
              `Image indisponible (HTTP ${response.status}).`,
            );
            error.status = response.status;
            error.throttled = wasPublicApiThrottle(response);
            throw error;
          }
          const declared = Number(response.headers.get("content-length"));
          if (declared > MAX_IMAGE_BYTES) {
            await response.body?.cancel();
            throw Object.assign(new Error("Image trop volumineuse."), {
              status: 413,
            });
          }
          const value = await response.blob();
          sharedSignal.throwIfAborted();
          if (value.size > MAX_IMAGE_BYTES || !value.type.startsWith("image/"))
            throw Object.assign(new Error("Format d’image indisponible."), {
              status: 415,
            });
          return value;
        },
        fetcher,
        "image",
      );
    },
    { signal },
  );
  // At most 64 small blobs (16 MiB) persist between views. Larger photos are
  // delivered to current subscribers, then left to the browser's HTTP cache.
  if (blob.size > MAX_RETAINED_IMAGE_BYTES) cache.forget(url);
  return blob;
}

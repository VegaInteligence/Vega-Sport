/** One browser document shares the backend's limited read capacity. */
export const PUBLIC_API_CONCURRENCY = 4;
export const PUBLIC_IMAGE_CONCURRENCY = 2;
const throttledResponses = new WeakSet();
export const wasPublicApiThrottle = (response) =>
  throttledResponses.has(response);

const aborted = (signal) => {
  if (signal?.aborted)
    throw signal.reason || new DOMException("Aborted", "AbortError");
};

function delay(ms, signal) {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function retryAfter(response, now) {
  const raw = response.headers?.get?.("retry-after")?.trim();
  if (!raw) return null;
  const value = /^\d+(?:\.\d+)?$/.test(raw)
    ? Number(raw) * 1000
    : Date.parse(raw) - now;
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

/** Injectable only for deterministic transport tests; callers share the instance below. */
export function createPublicApiTransport({
  concurrency = PUBLIC_API_CONCURRENCY,
  imageConcurrency = PUBLIC_IMAGE_CONCURRENCY,
  maxQueued = 256,
  now = Date.now,
  random = Math.random,
  sleep = delay,
} = {}) {
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    !Number.isSafeInteger(imageConcurrency) ||
    imageConcurrency < 1 ||
    imageConcurrency > concurrency ||
    !Number.isSafeInteger(maxQueued) ||
    maxQueued < 1
  )
    throw new Error("Invalid public API concurrency limit");
  let active = 0,
    images = 0;
  const waiting = [];

  function pump() {
    while (active < concurrency && waiting.length) {
      // A crest burst must not queue interactive data behind dozens of images.
      let index = waiting.findIndex((job) => job.kind !== "image");
      if (index < 0) {
        if (images >= imageConcurrency) return;
        index = 0;
      }
      const [job] = waiting.splice(index, 1);
      job.signal?.removeEventListener("abort", job.abort);
      active++;
      if (job.kind === "image") images++;
      let released = false;
      job.resolve(() => {
        if (released) return;
        released = true;
        active--;
        if (job.kind === "image") images--;
        pump();
      });
    }
  }

  function acquire(kind, signal) {
    aborted(signal);
    if (waiting.length >= maxQueued) {
      const error = new Error(
        "Trop de lectures en attente. Réessayez dans un instant.",
      );
      error.code = "CLIENT_QUEUE_FULL";
      throw error;
    }
    return new Promise((resolve, reject) => {
      const job = { kind, signal, resolve };
      job.abort = () => {
        const index = waiting.indexOf(job);
        if (index < 0) return;
        waiting.splice(index, 1);
        reject(signal.reason || new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", job.abort, { once: true });
      waiting.push(job);
      pump();
    });
  }

  async function read(input, options = {}, fetcher = fetch, kind = "data") {
    const signal = options.signal;
    const release = await acquire(kind, signal);
    try {
      const method = String(options.method || "GET").toUpperCase();
      const safe = method === "GET" || method === "HEAD";
      let waited = 0;
      for (let attempt = 0; ; attempt++) {
        aborted(signal);
        const response = await fetcher(input, options);
        if (signal?.aborted) {
          await response.body?.cancel().catch(() => {});
          aborted(signal);
        }
        const after = retryAfter(response, now());
        const awsType = response.headers?.get?.("x-amzn-errortype") || "";
        const throttle =
          response.status === 429 ||
          (response.status === 503 &&
            (after !== null ||
              /^(?:TooManyRequestsException|ThrottlingException)(?::|$)/i.test(
                awsType,
              )));
        if (throttle) throttledResponses.add(response);
        if (!safe || !throttle || attempt >= 2) return response;
        const wait = Math.max(
          after || 0,
          400 * 2 ** attempt + Math.floor(random() * 150),
        );
        // Never shorten the server's requested delay to fit our retry budget.
        if (wait > 2000 || waited + wait > 4000) return response;
        await response.body?.cancel().catch(() => {});
        waited += wait;
        // Keep this permit while backing off, so a throttle does not immediately
        // unleash another queued request. Other callers retain their own signals.
        await sleep(wait, signal);
      }
    } finally {
      release();
    }
  }

  // Native images share admission with JSON reads without fetching their bytes
  // through CORS. Their owner releases this permit on load/error or cancellation.
  async function imagePermit({ signal } = {}) {
    const release = await acquire("image", signal);
    try {
      aborted(signal);
    } catch (error) {
      release();
      throw error;
    }
    const finish = () => {
      signal?.removeEventListener("abort", finish);
      release();
    };
    signal?.addEventListener("abort", finish, { once: true });
    return finish;
  }

  return {
    read,
    imagePermit,
    pending: () => ({ active, images, queued: waiting.length }),
  };
}

const publicTransport = createPublicApiTransport();
export const publicApiFetch = (input, options, fetcher, kind) =>
  publicTransport.read(input, options, fetcher, kind);
export const acquirePublicImage = (options) =>
  publicTransport.imagePermit(options);

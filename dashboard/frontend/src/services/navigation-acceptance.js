/** Opt-in, local-only acceptance receipts. No telemetry is transmitted. */
let capture = null;

export function recordAcceptanceCacheRead(kind) {
  if (capture?.pending && Object.hasOwn(capture.pending.cache, kind))
    capture.pending.cache[kind]++;
}

/** A filter is deliberately not a page navigation: it retains PageWorkspace. */
export function acceptancePageIdentity(url) {
  return `${url.pathname.replace(/\/$/, "")}:${url.searchParams.get("id") || ""}:${url.searchParams.get("m") || ""}`;
}

export function startNavigationAcceptance() {
  if (
    typeof window === "undefined" ||
    capture ||
    new URLSearchParams(window.location.search).get("acceptance") !== "1"
  )
    return;
  const state = (capture = {
    pending: null,
    frames: false,
    startedAt: new Date().toISOString(),
    documentId: crypto.randomUUID(),
    initialReadyMs: null,
    reads: [],
    requests: [],
    inFlight: 0,
    transitions: [],
  });
  const environment = {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGiB: navigator.deviceMemory ?? null,
    viewport: [window.innerWidth, window.innerHeight],
    devicePixelRatio: window.devicePixelRatio,
  };
  function report() {
    document.documentElement.setAttribute(
      "data-vega-acceptance",
      JSON.stringify({
        version: 1,
        startedAt: state.startedAt,
        documentId: state.documentId,
        environment,
        initialReadyMs: state.initialReadyMs,
        visibility: document.visibilityState,
        reads: state.reads,
        fetches: state.requests.map(({ url, ...request }) => request),
        transitions: state.transitions,
        method:
          "captured link click to new visible ready workspace, followed by two animation frames",
        excludes:
          "same-identity filters; hidden tabs; this is not a screenshot-based paint measurement",
      }),
    );
  }
  // Observe starts, including Next/RSC and unfinished bodies. Return the native
  // promise unchanged; this opt-in wrapper never retries or changes a request.
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    let request;
    try {
      const input = args[0];
      const url = new URL(
        typeof input === "string" || input instanceof URL
          ? String(input)
          : input.url,
        window.location.href,
      );
      request = {
        url: url.href,
        path: url.pathname,
        kind: url.searchParams.has("_rsc")
          ? "rsc"
          : url.pathname.startsWith("/api/")
            ? "api"
            : "other",
        startMs: performance.now(),
        endMs: null,
        responseMs: null,
        status: null,
      };
      state.requests.push(request);
      state.inFlight++;
      state.requests = state.requests.slice(-100);
    } catch {
      // Diagnostics cannot interfere with the native fetch input validation.
    }
    try {
      const promise = Reflect.apply(originalFetch, this, args);
      promise.then(
        (response) => {
          if (request) {
            request.responseMs = performance.now();
            request.status = response.status;
          }
        },
        () => {
          if (request) {
            if (request.endMs === null) state.inFlight--;
            request.endMs = performance.now();
            request.status = "error";
          }
        },
      );
      return promise;
    } catch (error) {
      if (request) {
        if (request.endMs === null) state.inFlight--;
        request.endMs = performance.now();
        request.status = "error";
      }
      throw error;
    }
  };
  function inViewport(node) {
    const rect = node.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.top < window.innerHeight
    );
  }
  function ready(pending, main) {
    return (
      main &&
      main !== pending.previous &&
      main.isConnected &&
      main.getAttribute("data-page-ready") === "true" &&
      document.visibilityState === "visible" &&
      !pending.wasHidden &&
      acceptancePageIdentity(new URL(window.location.href)) ===
        pending.identity &&
      ![...main.querySelectorAll("[data-page-loading]")].some(inViewport)
    );
  }
  function check() {
    if (
      state.initialReadyMs === null &&
      document.querySelector('main#main[data-page-ready="true"]')
    ) {
      state.initialReadyMs = Math.round(performance.now() * 1000) / 1000;
      report();
    }
    const pending = state.pending;
    if (!pending || state.frames) return;
    const main = document.querySelector("main#main");
    if (!ready(pending, main)) return;
    state.frames = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        state.frames = false;
        if (state.pending !== pending) return;
        if (!ready(pending, main)) {
          check();
          return;
        }
        const finished = performance.now();
        const reads = state.reads.filter(
          (read) => read.endMs >= pending.startMs,
        );
        const requests = state.requests.filter(
          (request) =>
            request.startMs <= finished &&
            (request.endMs === null || request.endMs >= pending.startMs),
        );
        state.transitions.push({
          from: pending.from,
          to: pending.to,
          startedAt: pending.startedAt,
          durationMs: Math.round((finished - pending.startMs) * 1000) / 1000,
          eventQueueMs: Math.round(pending.eventQueueMs * 1000) / 1000,
          startClock: pending.startClock,
          cache: { ...pending.cache },
          fetchesStarted: requests.filter(
            (request) => request.startMs >= pending.startMs,
          ).length,
          fetchesDuringInterval: requests.length,
          fetchesInFlightAtClick: pending.inFlight,
          dataTransfersDuringInterval: reads.length,
          dataInMemory:
            pending.cache.fresh > 0 &&
            pending.cache.pending === 0 &&
            pending.cache.loader === 0 &&
            requests.length === 0 &&
            pending.inFlight === 0 &&
            reads.length === 0,
          visible: true,
        });
        state.transitions = state.transitions.slice(-40);
        state.pending = null;
        report();
      }),
    );
  }
  document.addEventListener(
    "click",
    (event) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = event.target.closest?.("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download"))
        return;
      const target = new URL(link.href, window.location.href);
      const current = new URL(window.location.href);
      if (
        target.origin !== current.origin ||
        acceptancePageIdentity(target) === acceptancePageIdentity(current)
      )
        return;
      const handlerTime = performance.now();
      const eventTime = Number(event.timeStamp);
      const eventClockValid =
        Number.isFinite(eventTime) &&
        eventTime >= 0 &&
        eventTime <= handlerTime;
      const startMs = eventClockValid ? eventTime : handlerTime;
      state.pending = {
        startMs,
        eventQueueMs: handlerTime - startMs,
        startClock: eventClockValid
          ? "event.timeStamp"
          : "handler performance.now fallback",
        inFlight: state.inFlight,
        startedAt: new Date().toISOString(),
        previous: document.querySelector("main#main"),
        from: current.pathname,
        to: target.pathname,
        identity: acceptancePageIdentity(target),
        cache: { fresh: 0, pending: 0, loader: 0 },
        wasHidden: document.visibilityState !== "visible",
      };
      check();
    },
    true,
  );
  document.addEventListener("visibilitychange", () => {
    if (state.pending && document.visibilityState !== "visible")
      state.pending.wasHidden = true;
  });
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-page-ready", "data-page-loading"],
  });
  const timingObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const url = new URL(entry.name, window.location.href);
      const request = state.requests.find(
        (item) =>
          item.url === url.href &&
          item.endMs === null &&
          item.startMs <= entry.startTime + 2,
      );
      if (request) {
        request.endMs = entry.startTime + entry.duration;
        state.inFlight--;
      }
      if (
        (!url.pathname.startsWith("/api/") && !url.searchParams.has("_rsc")) ||
        url.pathname.startsWith("/api/assets")
      )
        continue;
      state.reads.push({
        path: url.pathname,
        startMs: Math.round(entry.startTime * 1000) / 1000,
        endMs: Math.round((entry.startTime + entry.duration) * 1000) / 1000,
        durationMs: Math.round(entry.duration * 1000) / 1000,
        transferBytes: entry.transferSize,
        decodedBytes: entry.decodedBodySize,
      });
    }
    state.reads = state.reads.slice(-100);
    report();
  });
  timingObserver.observe({ type: "resource", buffered: true });
  check();
  report();
}

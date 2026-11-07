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

/** Only the installed Vercel SDK's advertised, same-origin destinations. */
export function acceptanceTelemetryURLs(scripts, location) {
  const base = new URL(location),
    urls = new Set();
  for (const script of scripts) {
    const data = script.dataset || {};
    const sdk = /^@vercel\/(analytics|speed-insights)(?:\/[a-z-]+)?$/.exec(
      data.sdkn || "",
    );
    if (!sdk) continue;
    const analytics = sdk[1] === "analytics";
    const raw = analytics
      ? data.viewEndpoint ||
        `${(data.endpoint || "/_vercel/insights").replace(/\/$/, "")}/view`
      : data.endpoint || "/_vercel/speed-insights/vitals";
    try {
      const url = new URL(raw, base);
      if (
        url.origin === base.origin &&
        !url.search &&
        !url.hash &&
        url.pathname.endsWith(analytics ? "/view" : "/vitals")
      )
        urls.add(url.href);
    } catch {
      /* Unknown destinations remain blocking requests. */
    }
  }
  return urls;
}

export function acceptanceRequestKind(
  url,
  { method = "GET", headers, telemetryURLs = new Set() } = {},
) {
  if (url.searchParams.has("_rsc") || new Headers(headers).has("RSC"))
    return "rsc";
  if (url.pathname.startsWith("/api/")) return "api";
  if (method.toUpperCase() === "POST" && telemetryURLs.has(url.href))
    return "telemetry";
  return "other";
}

export function acceptanceNetworkEvidence({
  requests,
  reads,
  startMs,
  finished,
  inFlight,
  blockingInFlight,
  cache,
  incomplete = false,
}) {
  const overlaps = requests.filter(
    (request) =>
      request.startMs <= finished &&
      (request.endMs === null || request.endMs >= startMs),
  );
  const blocking = overlaps.filter((request) => request.kind !== "telemetry");
  const transfers = reads.filter(
    (read) => read.startMs <= finished && read.endMs >= startMs,
  );
  return {
    fetchesStarted: overlaps.filter((request) => request.startMs >= startMs)
      .length,
    fetchesDuringInterval: overlaps.length,
    fetchesInFlightAtClick: inFlight,
    blockingFetchesDuringInterval: blocking.length,
    blockingFetchesInFlightAtClick: blockingInFlight,
    telemetryFetchesDuringInterval: overlaps.length - blocking.length,
    dataTransfersDuringInterval: transfers.length,
    networkEvidenceComplete: !incomplete,
    dataInMemory:
      cache.fresh > 0 &&
      cache.pending === 0 &&
      cache.loader === 0 &&
      blocking.length === 0 &&
      blockingInFlight === 0 &&
      transfers.length === 0 &&
      !incomplete,
  };
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
    initialPreparation: null,
    reads: [],
    imageReads: [],
    requests: [],
    inFlight: 0,
    blockingInFlight: 0,
    discardedBlockingEndMs: -Infinity,
    discardedReadEndMs: -Infinity,
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
        version: 4,
        startedAt: state.startedAt,
        documentId: state.documentId,
        environment,
        initialReadyMs: state.initialReadyMs,
        initialPreparation: state.initialPreparation,
        visibility: document.visibilityState,
        reads: state.reads,
        imageReads: state.imageReads,
        fetches: state.requests.map(({ url, ...request }) => request),
        transitions: state.transitions,
        method:
          "captured link click to new visible ready workspace, followed by two animation frames",
        excludes:
          "same-identity filters; hidden tabs; only same-origin POST view/vitals destinations advertised by the installed Vercel SDK are excluded from dataInMemory, but retained in fetch counts; this is not a screenshot-based paint measurement",
      }),
    );
    // Let a test await the completed receipt before starting another click.
    // This is updated only after the existing two-frame completion criterion.
    document.documentElement.setAttribute(
      "data-vega-acceptance-count",
      String(state.transitions.length),
    );
  }
  // Observe starts, including Next/RSC and unfinished bodies. Return the native
  // promise unchanged; this opt-in wrapper never retries or changes a request.
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    let request;
    try {
      const input = args[0];
      const options = args[1] || {};
      const url = new URL(
        typeof input === "string" || input instanceof URL
          ? String(input)
          : input.url,
        window.location.href,
      );
      request = {
        url: url.href,
        path: url.pathname,
        kind: acceptanceRequestKind(url, {
          method: options.method || input?.method || "GET",
          headers: options.headers ?? input?.headers,
          telemetryURLs: acceptanceTelemetryURLs(
            document.querySelectorAll("script[data-sdkn]"),
            window.location.href,
          ),
        }),
        startMs: performance.now(),
        endMs: null,
        responseMs: null,
        status: null,
      };
    } catch {
      // Diagnostics cannot interfere with the native fetch input validation.
      // A request that cannot be classified must still prevent a memory claim.
      request = {
        url: null,
        path: "[unclassified]",
        kind: "other",
        startMs: performance.now(),
        endMs: null,
        responseMs: null,
        status: null,
      };
    }
    state.requests.push(request);
    state.inFlight++;
    if (request.kind !== "telemetry") state.blockingInFlight++;
    for (const removed of state.requests.slice(0, -100))
      if (removed.kind !== "telemetry")
        state.discardedBlockingEndMs = Math.max(
          state.discardedBlockingEndMs,
          removed.endMs ?? Infinity,
        );
    state.requests = state.requests.slice(-100);
    const ended = () => {
      if (request.endMs !== null) return;
      state.inFlight--;
      if (request.kind !== "telemetry") state.blockingInFlight--;
      request.endMs = performance.now();
    };
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
            ended();
            request.status = "error";
          }
        },
      );
      return promise;
    } catch (error) {
      if (request) {
        ended();
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
  function preparation(main) {
    try {
      const value = main?.getAttribute("data-vega-preparation");
      return value && value.length < 20000 ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }
  function check() {
    if (
      state.initialReadyMs === null &&
      document.querySelector('main#main[data-page-ready="true"]')
    ) {
      state.initialReadyMs = Math.round(performance.now() * 1000) / 1000;
      state.initialPreparation = preparation(
        document.querySelector("main#main"),
      );
      report();
    }
    const pending = state.pending;
    if (!pending || state.frames) return;
    const main = document.querySelector("main#main");
    if (
      pending.workspaceSeenMs === null &&
      main &&
      main !== pending.previous &&
      main.isConnected &&
      acceptancePageIdentity(new URL(window.location.href)) === pending.identity
    )
      pending.workspaceSeenMs = performance.now();
    if (!ready(pending, main)) return;
    const readyObservedMs = performance.now();
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
        state.transitions.push({
          from: pending.from,
          to: pending.to,
          startedAt: pending.startedAt,
          durationMs: Math.round((finished - pending.startMs) * 1000) / 1000,
          eventQueueMs: Math.round(pending.eventQueueMs * 1000) / 1000,
          startClock: pending.startClock,
          phases: {
            workspaceObservedMs:
              pending.workspaceSeenMs === null
                ? null
                : Math.round(
                    (pending.workspaceSeenMs - pending.startMs) * 1000,
                  ) / 1000,
            readyObservedMs:
              Math.round((readyObservedMs - pending.startMs) * 1000) / 1000,
            twoFramesAfterReadyMs:
              Math.round((finished - readyObservedMs) * 1000) / 1000,
          },
          observedImageTransfers: state.imageReads.filter(
            (read) => read.startMs <= finished && read.endMs >= pending.startMs,
          ),
          preparation: preparation(main),
          cache: { ...pending.cache },
          ...acceptanceNetworkEvidence({
            requests: state.requests,
            reads: state.reads,
            startMs: pending.startMs,
            finished,
            inFlight: pending.inFlight,
            blockingInFlight: pending.blockingInFlight,
            cache: pending.cache,
            incomplete:
              Math.max(
                state.discardedBlockingEndMs,
                state.discardedReadEndMs,
              ) >= pending.startMs,
          }),
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
        workspaceSeenMs: null,
        eventQueueMs: handlerTime - startMs,
        startClock: eventClockValid
          ? "event.timeStamp"
          : "handler performance.now fallback",
        inFlight: state.inFlight,
        blockingInFlight: state.blockingInFlight,
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
        if (request.kind !== "telemetry") state.blockingInFlight--;
      }
      if (entry.initiatorType === "img") {
        state.imageReads.push({
          path: url.pathname,
          sameOrigin: url.origin === window.location.origin,
          startMs: Math.round(entry.startTime * 1000) / 1000,
          endMs: Math.round((entry.startTime + entry.duration) * 1000) / 1000,
          durationMs: Math.round(entry.duration * 1000) / 1000,
          transferBytes: entry.transferSize,
          encodedBytes: entry.encodedBodySize,
          decodedBytes: entry.decodedBodySize,
        });
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
    for (const removed of state.reads.slice(0, -100))
      state.discardedReadEndMs = Math.max(
        state.discardedReadEndMs,
        removed.endMs,
      );
    state.reads = state.reads.slice(-100);
    state.imageReads = state.imageReads.slice(-100);
    report();
  });
  timingObserver.observe({ type: "resource", buffered: true });
  check();
  report();
}

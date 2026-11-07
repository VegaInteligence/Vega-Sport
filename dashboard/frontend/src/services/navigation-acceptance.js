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
        transitions: state.transitions,
        method:
          "captured link click to new visible ready workspace, followed by two animation frames",
        excludes:
          "same-identity filters; hidden tabs; this is not a screenshot-based paint measurement",
      }),
    );
  }
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
          (read) => read.startMs >= pending.startMs,
        );
        state.transitions.push({
          from: pending.from,
          to: pending.to,
          startedAt: pending.startedAt,
          durationMs: Math.round((finished - pending.startMs) * 1000) / 1000,
          cache: { ...pending.cache },
          apiReadsStarted: reads.length,
          inMemory:
            pending.cache.fresh > 0 &&
            pending.cache.pending === 0 &&
            pending.cache.loader === 0 &&
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
      state.pending = {
        startMs: performance.now(),
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
      if (
        !url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/api/assets")
      )
        continue;
      state.reads.push({
        path: url.pathname,
        startMs: Math.round(entry.startTime * 1000) / 1000,
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

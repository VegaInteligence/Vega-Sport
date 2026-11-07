/** Reveal the first viewport together, without waiting for offscreen images. */
export function prepareInitialPage(
  root,
  reveal,
  { imageTimeout = 5000, pageTimeout = 10000 } = {},
) {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  const images = new Map();
  let phase = "preparing";
  let microtaskQueued = false;
  let frame = null;
  let fallbackFrame = null;
  let deadline = null;
  let pageDeadline = null;
  const trace = doc.documentElement?.hasAttribute?.("data-vega-acceptance")
    ? {
        startedMs: view.performance.now(),
        totalChecks: 0,
        checkWorkMs: 0,
        checkQueueMs: 0,
        checks: [],
        reason: "ready",
      }
    : null;
  let queuedAt = null;

  const viewportCheck = () => {
    // A page's images share most of their ancestors. Read each ancestor once
    // during this pass, but never reuse layout across a mutation/scroll/resize.
    const styles = new Map(),
      clips = new Map();
    const styleFor = (node) => {
      if (!styles.has(node)) {
        const style = view.getComputedStyle?.(node);
        styles.set(node, {
          position: style?.position,
          overflowX: style?.overflowX,
          overflowY: style?.overflowY,
        });
      }
      return styles.get(node);
    };
    const clipFor = (parent) => {
      if (!clips.has(parent)) {
        const bounds = parent.getBoundingClientRect();
        const scaleX = parent.offsetWidth
            ? bounds.width / parent.offsetWidth
            : 1,
          scaleY = parent.offsetHeight
            ? bounds.height / parent.offsetHeight
            : 1;
        const left = bounds.left + (parent.clientLeft || 0) * scaleX,
          top = bounds.top + (parent.clientTop || 0) * scaleY;
        clips.set(parent, {
          left,
          right: left + (parent.clientWidth ?? bounds.width) * scaleX,
          top,
          bottom: top + (parent.clientHeight ?? bounds.height) * scaleY,
        });
      }
      return clips.get(parent);
    };
    return (node) => {
      if (!node.getClientRects().length) return false;
      const rect = node.getBoundingClientRect();
      let left = Math.max(0, rect.left),
        right = Math.min(view.innerWidth, rect.right),
        top = Math.max(0, rect.top),
        bottom = Math.min(view.innerHeight, rect.bottom);
      if (rect.width <= 0 || rect.height <= 0 || right <= left || bottom <= top)
        return false;
      // IntersectionObserver also clips against scrolling/overflow ancestors.
      // ApiImage deliberately has no src until that observer admits it. An image
      // inside the window but outside its scrollport must not hold the page until
      // the image deadline. Ignore opacity: the page's own preparation mask and
      // Media's pending image are intentionally transparent while we wait.
      const ancestors = [];
      for (let element = node; element; element = element.parentElement) {
        const style = styleFor(element);
        // Out-of-flow descendants can escape an intermediate overflow clip when
        // their containing block is elsewhere. Keep the conservative old wait
        // for these layouts instead of declaring an actually visible image ready.
        if (style?.position === "absolute" || style?.position === "fixed")
          return true;
        if (element !== node) ancestors.push([element, style]);
      }
      for (const [parent, style] of ancestors) {
        const clipsX = /^(auto|scroll|hidden|clip)$/.test(style?.overflowX),
          clipsY = /^(auto|scroll|hidden|clip)$/.test(style?.overflowY);
        if (!clipsX && !clipsY) continue;
        const clip = clipFor(parent);
        if (clipsX) {
          left = Math.max(left, clip.left);
          right = Math.min(right, clip.right);
        }
        if (clipsY) {
          top = Math.max(top, clip.top);
          bottom = Math.min(bottom, clip.bottom);
        }
        if (right <= left || bottom <= top) return false;
      }
      return true;
    };
  };
  const markQueued = () => {
    if (trace && queuedAt === null) queuedAt = view.performance.now();
  };
  const cancelCheckFrame = () => {
    if (frame === null) return;
    view.cancelAnimationFrame(frame);
    frame = null;
  };
  const scheduleNotification = () => {
    if (phase !== "preparing" || microtaskQueued) return;
    markQueued();
    microtaskQueued = true;
    view.queueMicrotask(() => {
      microtaskQueued = false;
      if (phase !== "preparing") return;
      // This pass reads current geometry too, so it consumes any pending
      // scroll/resize check without leaving a second scan in the next frame.
      cancelCheckFrame();
      check();
    });
  };
  const scheduleFrame = () => {
    if (phase !== "preparing" || frame !== null || microtaskQueued) return;
    markQueued();
    frame = view.requestAnimationFrame(() => {
      frame = null;
      check();
    });
  };
  const imageEvent = (event) => {
    const mediaState = event?.target
      ?.closest?.("[data-page-media]")
      ?.getAttribute?.("data-media-state");
    // Media commits ready only after decoding, or removes the image for its
    // terminal fallback. Those DOM mutations already notify this gate. Native
    // load/error arrives earlier and cannot prove either state; scanning on
    // every such event repeats layout for all images, including offscreen ones.
    if (["loading", "ready", "fallback"].includes(mediaState)) return;
    scheduleNotification();
  };
  const observer = new view.MutationObserver(scheduleNotification);
  const cleanup = () => {
    phase = "disposed";
    microtaskQueued = false;
    observer.disconnect();
    cancelCheckFrame();
    view.cancelAnimationFrame(fallbackFrame);
    fallbackFrame = null;
    view.clearTimeout(deadline);
    view.clearTimeout(pageDeadline);
    root.removeEventListener("load", imageEvent, true);
    root.removeEventListener("error", imageEvent, true);
    view.removeEventListener("resize", scheduleFrame);
    view.removeEventListener("scroll", scheduleFrame, true);
  };
  const finish = () => {
    if (phase === "disposed") return;
    if (trace) {
      trace.finishedMs = view.performance.now();
      root.setAttribute("data-vega-preparation", JSON.stringify(trace));
    }
    cleanup();
    reveal();
  };
  const dataLoading = (inViewport = viewportCheck()) =>
    [...root.querySelectorAll("[data-page-loading]")].some(inViewport);
  function finishWithFallbacks() {
    if (phase !== "preparing") return;
    // A queued notification or React's fallback commit must not reveal early.
    // Only the dedicated frame below may finish once this phase starts.
    phase = "fallback";
    cancelCheckFrame();
    view.clearTimeout(deadline);
    view.clearTimeout(pageDeadline);
    if (trace) trace.reason = "deadline";
    const media = new Set();
    for (const image of pendingImages()) {
      const owner = image.closest("[data-page-media]");
      if (owner) media.add(owner);
      else image.setAttribute("data-page-image-deferred", "");
    }
    for (const owner of media) {
      owner.dispatchEvent(new view.Event("vega:defer-image"));
      if (phase !== "fallback") return;
    }
    fallbackFrame = view.requestAnimationFrame(() => {
      fallbackFrame = null;
      finish();
    });
  }
  function pendingImages(inViewport = viewportCheck()) {
    return [...root.querySelectorAll("img")].filter((image) => {
      if (!inViewport(image) || image.hasAttribute("data-page-image-deferred"))
        return false;
      // Native assets can start now too; ApiImage still controls API admission.
      if (image.loading !== "eager") image.loading = "eager";
      const src = image.getAttribute("src");
      if (!src) return true;
      if (!image.complete) return true;
      const mediaState = image
        .closest("[data-page-media]")
        ?.getAttribute?.("data-media-state");
      // Media owns decoding, error alternatives and the final visible state.
      // Its loading marker must commit to ready (or remove the image for its
      // fallback). A second decode here adds another browser decode/frame even
      // after the component has already proved this source ready.
      if (mediaState === "loading") return true;
      // React's error handler can now replace the image with its alternate or
      // terminal fallback. Native broken assets retain their layout, not an icon.
      if (!image.naturalWidth) {
        if (mediaState === "ready") return true;
        image.setAttribute("data-page-image-deferred", "");
        return false;
      }
      if (mediaState === "ready") return false;
      let record = images.get(image);
      const source = `${src}\n${image.getAttribute("srcset") || ""}\n${image.currentSrc || src}`;
      if (record?.source !== source) {
        record = { source, decoded: false };
        images.set(image, record);
        Promise.resolve()
          .then(() => image.decode?.())
          .catch(() => {})
          .then(() => {
            if (phase !== "preparing" || images.get(image) !== record) return;
            record.decoded = true;
            scheduleNotification();
          });
      }
      return !record.decoded;
    });
  }
  function check() {
    if (phase !== "preparing") return;
    const checkStarted = trace ? view.performance.now() : null;
    const inViewport = viewportCheck();
    const loading = dataLoading(inViewport);
    const pending = pendingImages(inViewport);
    if (trace) {
      const checked = view.performance.now();
      trace.totalChecks++;
      trace.checkWorkMs += checked - checkStarted;
      trace.checkQueueMs += queuedAt === null ? 0 : checkStarted - queuedAt;
      trace.checks.push({
        startMs: checkStarted,
        durationMs: checked - checkStarted,
        queueMs: queuedAt === null ? 0 : checkStarted - queuedAt,
        dataLoading: loading,
        pendingImages: pending.length,
      });
      trace.checks = trace.checks.slice(-20);
      queuedAt = null;
    }
    if (loading) {
      // Route data may mount its images later. Its existing error/retry UI owns
      // data failure; the image deadline starts only once that content exists.
      view.clearTimeout(deadline);
      deadline = null;
      return;
    }
    if (!pending.length) {
      finish();
      return;
    }
    if (deadline === null)
      deadline = view.setTimeout(() => {
        deadline = null;
        if (phase !== "preparing") return;
        if (dataLoading()) {
          scheduleNotification();
          return;
        }
        // A slow asset must neither block the page nor pop in after its reveal.
        // Media cancels its request and keeps initials until its source changes.
        // Give React's fallback update a frame before exposing the content.
        finishWithFallbacks();
      }, imageTimeout);
  }
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcset", "data-page-loading", "data-media-state"],
  });
  root.addEventListener("load", imageEvent, true);
  root.addEventListener("error", imageEvent, true);
  view.addEventListener("resize", scheduleFrame);
  view.addEventListener("scroll", scheduleFrame, {
    passive: true,
    capture: true,
  });
  // A stalled optional data source must not hide the page's own retry/status UI.
  pageDeadline = view.setTimeout(finishWithFallbacks, pageTimeout);
  // PageWorkspace installs this during its layout effect. Already decoded
  // content can be revealed in that commit; pending work still uses the same
  // observer and deadlines as subsequent checks. DOM/load/decode notifications
  // coalesce in a microtask; geometry-only events still wait for a frame.
  check();
  return cleanup;
}

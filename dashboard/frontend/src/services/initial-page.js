/** Reveal the first viewport together, without waiting for offscreen images. */
export function prepareInitialPage(
  root,
  reveal,
  { imageTimeout = 5000, pageTimeout = 10000 } = {},
) {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  const images = new Map();
  let disposed = false;
  let frame = null;
  let deadline = null;
  let pageDeadline = null;

  const inViewport = (node) => {
    if (!node.getClientRects().length) return false;
    const rect = node.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < view.innerHeight &&
      rect.left < view.innerWidth
    );
  };
  const schedule = () => {
    if (!disposed && frame === null) frame = view.requestAnimationFrame(check);
  };
  const observer = new view.MutationObserver(schedule);
  const cleanup = () => {
    disposed = true;
    observer.disconnect();
    view.cancelAnimationFrame(frame);
    view.clearTimeout(deadline);
    view.clearTimeout(pageDeadline);
    root.removeEventListener("load", schedule, true);
    root.removeEventListener("error", schedule, true);
    view.removeEventListener("resize", schedule);
    view.removeEventListener("scroll", schedule);
  };
  const finish = () => {
    if (disposed) return;
    cleanup();
    reveal();
  };
  const dataLoading = () =>
    [...root.querySelectorAll("[data-page-loading]")].some(inViewport);
  function finishWithFallbacks() {
    if (disposed) return;
    const media = new Set();
    for (const image of pendingImages()) {
      const owner = image.closest("[data-page-media]");
      if (owner) media.add(owner);
      else image.setAttribute("data-page-image-deferred", "");
    }
    for (const owner of media)
      owner.dispatchEvent(new view.Event("vega:defer-image"));
    view.cancelAnimationFrame(frame);
    frame = view.requestAnimationFrame(finish);
  }
  function pendingImages() {
    return [...root.querySelectorAll("img")].filter((image) => {
      if (!inViewport(image) || image.hasAttribute("data-page-image-deferred"))
        return false;
      // Native assets can start now too; ApiImage still controls API admission.
      image.loading = "eager";
      const src = image.getAttribute("src");
      if (!src) return true;
      if (!image.complete) return true;
      // React's error handler can now replace the image with its alternate or
      // terminal fallback. Native broken assets retain their layout, not an icon.
      if (!image.naturalWidth) {
        image.setAttribute("data-page-image-deferred", "");
        return false;
      }
      let record = images.get(image);
      if (record?.src !== src) {
        record = { src, decoded: false };
        images.set(image, record);
        Promise.resolve()
          .then(() => image.decode?.())
          .catch(() => {})
          .then(() => {
            record.decoded = true;
            schedule();
          });
      }
      return !record.decoded;
    });
  }
  function check() {
    frame = null;
    if (disposed) return;
    const loading = dataLoading();
    const pending = pendingImages();
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
        if (disposed) return;
        if (dataLoading()) {
          schedule();
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
    attributeFilter: ["src", "data-page-loading"],
  });
  root.addEventListener("load", schedule, true);
  root.addEventListener("error", schedule, true);
  view.addEventListener("resize", schedule);
  view.addEventListener("scroll", schedule, { passive: true });
  // A stalled optional data source must not hide the page's own retry/status UI.
  pageDeadline = view.setTimeout(finishWithFallbacks, pageTimeout);
  schedule();
  return cleanup;
}

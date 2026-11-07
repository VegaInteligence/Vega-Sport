import test from "node:test";
import assert from "node:assert/strict";
import { prepareInitialPage } from "../dashboard/frontend/src/services/initial-page.js";

function fixture({ trace = false } = {}) {
  let next = 0,
    now = 0,
    scans = 0;
  const microtasks = [];
  const frames = new Map(),
    timers = new Map(),
    listeners = new Map(),
    styleReads = new Map();
  let observer;
  const view = {
    innerWidth: 1000,
    innerHeight: 800,
    performance: { now: () => now },
    queueMicrotask(fn) {
      microtasks.push(fn);
    },
    getComputedStyle(node) {
      styleReads.set(node, (styleReads.get(node) || 0) + 1);
      return node.style || {};
    },
    requestAnimationFrame(fn) {
      const id = ++next;
      frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    setTimeout(fn, delay) {
      const id = ++next;
      timers.set(id, { fn, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addEventListener(name, fn) {
      listeners.set(name, fn);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    MutationObserver: class {
      constructor(fn) {
        this.fn = fn;
        observer = this;
        this.connected = false;
      }
      observe() {
        this.connected = true;
      }
      disconnect() {
        this.connected = false;
      }
    },
  };
  const nodes = { images: [], loading: [], errors: [] };
  const rootListeners = new Map();
  const rootAttributes = new Map();
  const root = {
    ownerDocument: {
      defaultView: view,
      documentElement: {
        hasAttribute: (name) => trace && name === "data-vega-acceptance",
      },
    },
    setAttribute: (name, value) => rootAttributes.set(name, value),
    getAttribute: (name) => rootAttributes.get(name),
    querySelectorAll(selector) {
      if (selector === "img") scans++;
      return selector === "img"
        ? nodes.images
        : selector === "[data-page-loading]"
          ? nodes.loading
          : selector.includes(".loading-state")
            ? nodes.errors
            : [];
    },
    addEventListener(name, fn) {
      rootListeners.set(name, fn);
    },
    removeEventListener(name) {
      rootListeners.delete(name);
    },
  };
  const rect = (visible = true) => ({
    width: 20,
    height: 20,
    left: 0,
    right: 20,
    top: visible ? 0 : 900,
    bottom: visible ? 20 : 920,
  });
  function element(visible = true) {
    return {
      getClientRects: () => [rect(visible)],
      getBoundingClientRect: () => rect(visible),
    };
  }
  function image({
    visible = true,
    complete = true,
    width = 20,
    decode = () => Promise.resolve(),
    media = null,
  } = {}) {
    const attrs = new Map([["src", "/crest.png"]]);
    return Object.assign(element(visible), {
      complete,
      naturalWidth: width,
      decode,
      getAttribute: (name) => attrs.get(name) ?? null,
      hasAttribute: (name) => attrs.has(name),
      setAttribute: (name, value) => attrs.set(name, value),
      closest: () => media,
    });
  }
  function flushMicrotasks() {
    let rounds = 0;
    while (microtasks.length) {
      if (++rounds > 100) throw new Error("microtasks did not settle");
      for (const callback of microtasks.splice(0)) callback();
    }
  }
  return {
    root,
    nodes,
    styleReads,
    image,
    element,
    container(bounds, style = {}, parentElement = null) {
      return {
        style,
        parentElement,
        clientLeft: 0,
        clientTop: 0,
        clientWidth: bounds.right - bounds.left,
        clientHeight: bounds.bottom - bounds.top,
        offsetWidth: bounds.right - bounds.left,
        offsetHeight: bounds.bottom - bounds.top,
        getBoundingClientRect: () => ({
          ...bounds,
          width: bounds.right - bounds.left,
          height: bounds.bottom - bounds.top,
        }),
      };
    },
    mutate() {
      if (observer.connected) observer.fn();
    },
    event(name, target) {
      rootListeners.get(name)?.({ target });
    },
    viewportEvent(name) {
      listeners.get(name)?.();
    },
    microtasks: flushMicrotasks,
    frame() {
      flushMicrotasks();
      const batch = [...frames.values()];
      frames.clear();
      batch.forEach((fn) => {
        fn();
        flushMicrotasks();
      });
    },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
      }
      now = target;
    },
    get timerCount() {
      return timers.size;
    },
    get connected() {
      return observer.connected;
    },
    get scanCount() {
      return scans;
    },
    get frameCount() {
      return frames.size;
    },
    get microtaskCount() {
      return microtasks.length;
    },
  };
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

test("visible image must decode before the page is revealed", async () => {
  const f = fixture();
  let finishDecode;
  let reveals = 0;
  f.nodes.images.push(
    f.image({
      decode: () =>
        new Promise((resolve) => {
          finishDecode = resolve;
        }),
    }),
  );
  prepareInitialPage(f.root, () => reveals++);
  f.frame();
  await settle();
  f.frame();
  assert.equal(reveals, 0);
  finishDecode();
  await settle();
  f.microtasks();
  assert.equal(reveals, 1);
  assert.equal(f.connected, false);
});

test("images below the viewport do not delay the initial reveal", () => {
  const f = fixture();
  let reveals = 0;
  f.nodes.images.push(f.image({ visible: false, complete: false }));
  prepareInitialPage(f.root, () => reveals++);
  f.frame();
  assert.equal(reveals, 1);
});

test("an unadmitted image fully clipped by a scrollport does not delay reveal", () => {
  const f = fixture();
  let reveals = 0;
  const image = f.image({ complete: false });
  image.setAttribute("src", "");
  // The image itself overlaps the window (0..20), but its scrolling parent's
  // visible content starts at x=50. IntersectionObserver will not admit it.
  image.parentElement = f.container(
    { left: 50, right: 200, top: 0, bottom: 100 },
    { overflowX: "auto", overflowY: "hidden" },
  );
  f.nodes.images.push(image);
  prepareInitialPage(f.root, () => reveals++);
  f.frame();
  assert.equal(reveals, 1);
  assert.equal(image.loading, undefined, "no forced request for clipped media");
  assert.equal(image.hasAttribute("data-page-image-deferred"), false);
});

test("partially visible media still waits for decoding inside a clipping ancestor", async () => {
  const f = fixture();
  let reveals = 0,
    finishDecode;
  const image = f.image({
    decode: () =>
      new Promise((resolve) => {
        finishDecode = resolve;
      }),
  });
  image.parentElement = f.container(
    { left: 10, right: 200, top: 0, bottom: 100 },
    { overflowX: "hidden", overflowY: "auto", opacity: "0" },
  );
  f.nodes.images.push(image);
  prepareInitialPage(f.root, () => reveals++);
  f.frame();
  await settle();
  f.frame();
  assert.equal(
    reveals,
    0,
    "neither clipping nor the preparation mask bypasses decode",
  );
  finishDecode();
  await settle();
  f.frame();
  assert.equal(reveals, 1);
});

test("nested clipping applies to both data loaders and images", () => {
  const f = fixture();
  let reveals = 0;
  const outer = f.container(
    { left: 0, right: 200, top: 50, bottom: 100 },
    { overflowY: "hidden" },
  );
  const inner = f.container(
    { left: 0, right: 200, top: 0, bottom: 100 },
    { overflowX: "auto" },
    outer,
  );
  const image = f.image({ complete: false });
  image.parentElement = inner;
  f.nodes.images.push(image);
  f.nodes.loading.push(f.element());
  prepareInitialPage(f.root, () => reveals++);
  f.frame();
  assert.equal(
    reveals,
    0,
    "the actual visible data loader still owns readiness",
  );
  f.nodes.loading[0].parentElement = inner;
  f.mutate();
  f.frame();
  assert.equal(
    reveals,
    1,
    "fully clipped data and media do not block the first viewport",
  );
});

test("out-of-flow media conservatively waits when its containing block may escape a clip", () => {
  const f = fixture();
  let reveals = 0;
  const image = f.image({ complete: false });
  image.style = { position: "fixed" };
  image.parentElement = f.container(
    { left: 50, right: 200, top: 0, bottom: 100 },
    { overflowX: "hidden", overflowY: "hidden" },
  );
  f.nodes.images.push(image);
  prepareInitialPage(f.root, () => reveals++);
  f.frame();
  assert.equal(reveals, 0);
});

test("visible loading state waits for subsequently mounted images", async () => {
  const f = fixture();
  let reveals = 0;
  let finishDecode;
  f.nodes.loading.push(f.element());
  prepareInitialPage(f.root, () => reveals++);
  f.frame();
  assert.equal(reveals, 0);
  assert.equal(f.timerCount, 1);
  f.nodes.loading.length = 0;
  f.nodes.images.push(
    f.image({
      decode: () =>
        new Promise((resolve) => {
          finishDecode = resolve;
        }),
    }),
  );
  f.mutate();
  f.frame();
  await settle();
  assert.equal(reveals, 0);
  finishDecode();
  await settle();
  f.frame();
  assert.equal(reveals, 1);
});

test("broken image and rejected decode reach a terminal reveal", async () => {
  const f = fixture();
  let reveals = 0;
  f.nodes.images.push(
    f.image({ width: 0 }),
    f.image({ decode: () => Promise.reject(new Error("bad image")) }),
  );
  prepareInitialPage(f.root, () => reveals++);
  f.frame();
  await settle();
  f.frame();
  assert.equal(reveals, 1);
  assert.equal(
    f.nodes.images[0].hasAttribute("data-page-image-deferred"),
    true,
  );
});

test("timeout requests media fallback before revealing", () => {
  const f = fixture();
  let reveals = 0;
  const events = [];
  const media = {
    dispatchEvent(event) {
      events.push(event.type);
    },
  };
  f.nodes.images.push(f.image({ complete: false, media }));
  prepareInitialPage(f.root, () => reveals++, { imageTimeout: 5 });
  f.frame();
  assert.equal(reveals, 0);
  f.advance(5);
  assert.deepEqual(events, ["vega:defer-image"]);
  assert.equal(reveals, 0);
  f.frame();
  assert.equal(reveals, 1);
});

test("disposal prevents pending work from revealing", async () => {
  const f = fixture();
  let reveals = 0;
  let finishDecode;
  f.nodes.images.push(
    f.image({
      decode: () =>
        new Promise((resolve) => {
          finishDecode = resolve;
        }),
    }),
  );
  const dispose = prepareInitialPage(f.root, () => reveals++);
  f.frame();
  await settle();
  dispose();
  finishDecode();
  await settle();
  f.mutate();
  f.event("load");
  f.advance(20000);
  f.frame();
  assert.equal(reveals, 0);
  assert.equal(f.connected, false);
});

test("later mutations cannot trigger another reveal", () => {
  const f = fixture();
  let reveals = 0;
  prepareInitialPage(f.root, () => reveals++);
  f.frame();
  f.nodes.loading.push(f.element());
  f.mutate();
  f.event("load");
  f.frame();
  assert.equal(reveals, 1);
});

test("terminal error with loading-state class does not block reveal", () => {
  const f = fixture();
  let reveals = 0;
  // The error remains in the DOM but has no pending-data marker.
  const error = Object.assign(f.element(), { className: "loading-state" });
  f.nodes.errors.push(error);
  prepareInitialPage(f.root, () => reveals++);
  f.frame();
  assert.equal(reveals, 1);
});

test("a newly mounted loader blocks an image deadline even before its mutation frame", () => {
  const f = fixture();
  let reveals = 0;
  f.nodes.images.push(f.image({ complete: false }));
  prepareInitialPage(f.root, () => reveals++, {
    imageTimeout: 5,
    pageTimeout: 100,
  });
  f.frame();
  f.nodes.loading.push(f.element());
  f.mutate();
  f.advance(5);
  f.frame();
  assert.equal(reveals, 0);
  assert.equal(
    f.nodes.images[0].hasAttribute("data-page-image-deferred"),
    false,
  );
});

test("disposing after deadline cancels its pending reveal frame", () => {
  const f = fixture();
  let reveals = 0;
  f.nodes.images.push(f.image({ complete: false }));
  const dispose = prepareInitialPage(f.root, () => reveals++, {
    imageTimeout: 5,
  });
  f.frame();
  f.advance(5);
  dispose();
  f.frame();
  assert.equal(reveals, 0);
});

test("overall deadline reveals stalled data status and freezes pending media", () => {
  const f = fixture();
  let reveals = 0;
  const events = [];
  f.nodes.loading.push(f.element());
  f.nodes.images.push(
    f.image({
      complete: false,
      media: { dispatchEvent: (event) => events.push(event.type) },
    }),
  );
  prepareInitialPage(f.root, () => reveals++, {
    imageTimeout: 5,
    pageTimeout: 20,
  });
  f.frame();
  f.advance(19);
  f.frame();
  assert.equal(reveals, 0);
  f.advance(1);
  assert.deepEqual(events, ["vega:defer-image"]);
  assert.equal(reveals, 0);
  f.frame();
  assert.equal(reveals, 1);
});

test("decoded media waits for its visible logo state to commit", async () => {
  const f = fixture();
  let reveals = 0;
  let state = "loading";
  const media = {
    getAttribute: (name) => (name === "data-media-state" ? state : null),
  };
  f.nodes.images.push(f.image({ media }));
  prepareInitialPage(f.root, () => reveals++);
  f.frame();
  await settle();
  f.frame();
  assert.equal(reveals, 0);
  state = "ready";
  f.mutate();
  f.frame();
  assert.equal(reveals, 1);
});

test("already decoded Media reveals immediately without a second decode or frame", () => {
  const f = fixture();
  let reveals = 0,
    decodes = 0;
  f.nodes.images.push(
    f.image({
      media: { getAttribute: () => "ready" },
      decode() {
        decodes++;
        return new Promise(() => {});
      },
    }),
  );
  prepareInitialPage(f.root, () => reveals++);
  assert.equal(
    reveals,
    1,
    "the current decoded viewport is already safe to reveal",
  );
  assert.equal(decodes, 0, "Media's own successful decode is authoritative");
  assert.equal(f.timerCount, 0);
});

test("Media owns decoding while loading and the gate waits for its committed ready state", () => {
  const f = fixture();
  let reveals = 0,
    decodes = 0,
    state = "loading";
  f.nodes.images.push(
    f.image({
      media: { getAttribute: () => state },
      decode() {
        decodes++;
        return Promise.resolve();
      },
    }),
  );
  prepareInitialPage(f.root, () => reveals++);
  f.frame();
  assert.equal(reveals, 0);
  assert.equal(decodes, 0, "do not submit a duplicate browser decode");
  state = "ready";
  f.mutate();
  f.frame();
  assert.equal(reveals, 1);
});

test("broken managed images wait for their alternate or terminal fallback", () => {
  const f = fixture();
  let reveals = 0,
    state = "loading";
  const image = f.image({ width: 0, media: { getAttribute: () => state } });
  f.nodes.images.push(image);
  prepareInitialPage(f.root, () => reveals++);
  f.frame();
  assert.equal(reveals, 0);
  assert.equal(
    image.hasAttribute("data-page-image-deferred"),
    false,
    "the primary error must not bypass Media's fallback attempt",
  );
  image.setAttribute("src", "/alternate.png");
  image.complete = false;
  f.mutate();
  f.frame();
  assert.equal(reveals, 0);
  // The alternate also fails. Media commits its terminal initials and removes
  // the native image; only this final visible state releases the page.
  state = "fallback";
  f.nodes.images.length = 0;
  f.mutate();
  f.frame();
  assert.equal(reveals, 1);
});

test("a changed managed source loses its ready state until the new decode commits", () => {
  const f = fixture();
  let reveals = 0,
    state = "ready";
  const image = f.image({ media: { getAttribute: () => state } });
  f.nodes.images.push(image);
  f.nodes.loading.push(f.element());
  prepareInitialPage(f.root, () => reveals++);
  assert.equal(reveals, 0);
  image.setAttribute("src", "/replacement.png");
  state = "loading";
  f.nodes.loading.length = 0;
  f.mutate();
  f.frame();
  assert.equal(
    reveals,
    0,
    "an old ready source cannot qualify the replacement",
  );
  state = "ready";
  f.mutate();
  f.frame();
  assert.equal(reveals, 1);
});

test("an unmanaged srcset selection still requires the replacement decode", async () => {
  const f = fixture();
  let reveals = 0;
  const finish = [];
  const image = f.image({
    decode: () => new Promise((resolve) => finish.push(resolve)),
  });
  image.currentSrc = "/crest-small.png";
  f.nodes.images.push(image);
  prepareInitialPage(f.root, () => reveals++);
  await settle();
  image.currentSrc = "/crest-large.png";
  f.mutate();
  f.frame();
  await settle();
  assert.equal(finish.length, 2);
  finish[0]();
  await settle();
  assert.equal(
    f.microtaskCount,
    0,
    "an obsolete decode cannot schedule a new scan",
  );
  f.frame();
  assert.equal(reveals, 0);
  finish[1]();
  await settle();
  f.frame();
  assert.equal(reveals, 1);
});

test("shared ancestor layout is read once per pass and refreshed after a mutation", () => {
  const f = fixture();
  let reveals = 0,
    clipReads = 0,
    left = 0;
  const parent = f.container(
    { left: 0, right: 100, top: 0, bottom: 100 },
    { overflowX: "hidden", overflowY: "hidden" },
  );
  parent.getBoundingClientRect = () => {
    clipReads++;
    return {
      left,
      right: left + 100,
      top: 0,
      bottom: 100,
      width: 100,
      height: 100,
    };
  };
  for (let i = 0; i < 24; i++) {
    const image = f.image({ complete: false });
    image.parentElement = parent;
    f.nodes.images.push(image);
  }
  prepareInitialPage(f.root, () => reveals++);
  f.frame();
  assert.equal(reveals, 0);
  assert.equal(f.styleReads.get(parent), 1);
  assert.equal(clipReads, 1);
  left = 50;
  f.mutate();
  f.frame();
  assert.equal(
    f.styleReads.get(parent),
    2,
    "layout is not reused across passes",
  );
  assert.equal(clipReads, 2);
  assert.equal(reveals, 1, "new clipping must be observed immediately");
});

test("managed native image events wait for the committed Media state without redundant scans", () => {
  const f = fixture();
  let reveals = 0,
    state = "loading";
  const image = f.image({ media: { getAttribute: () => state } });
  f.nodes.images.push(image);
  prepareInitialPage(f.root, () => reveals++);
  for (let i = 0; i < 24; i++) {
    f.event("load", image);
    f.microtasks();
  }
  assert.equal(f.scanCount, 1);
  assert.equal(f.microtaskCount, 0);
  assert.equal(reveals, 0, "native load is not a successful committed decode");
  state = "ready";
  f.mutate();
  f.microtasks();
  assert.equal(f.scanCount, 2);
  assert.equal(reveals, 1);
});

test("managed native errors still wait for the committed terminal fallback", () => {
  const f = fixture();
  let reveals = 0;
  const image = f.image({ width: 0, media: { getAttribute: () => "loading" } });
  f.nodes.images.push(image);
  prepareInitialPage(f.root, () => reveals++);
  f.event("error", image);
  assert.equal(f.microtaskCount, 0);
  assert.equal(reveals, 0);
  f.nodes.images.length = 0;
  f.mutate();
  f.microtasks();
  assert.equal(
    reveals,
    1,
    "removing the failed image exposes the final fallback",
  );
});

test("unmanaged native image loads still schedule and await their own decode", async () => {
  const f = fixture();
  let reveals = 0,
    finish;
  const image = f.image({
    complete: false,
    decode: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  f.nodes.images.push(image);
  prepareInitialPage(f.root, () => reveals++);
  image.complete = true;
  f.event("load", image);
  assert.equal(f.microtaskCount, 1);
  f.microtasks();
  await settle();
  assert.equal(reveals, 0);
  finish();
  await settle();
  f.microtasks();
  assert.equal(reveals, 1);
});

test("ready DOM notifications coalesce without waiting for another frame", () => {
  const f = fixture();
  let reveals = 0,
    state = "loading";
  f.nodes.images.push(f.image({ media: { getAttribute: () => state } }));
  prepareInitialPage(f.root, () => reveals++);
  assert.equal(f.scanCount, 1);
  state = "ready";
  f.mutate();
  f.mutate();
  f.event("load");
  f.event("error");
  assert.equal(f.microtaskCount, 1);
  assert.equal(f.frameCount, 0);
  assert.equal(f.scanCount, 1, "notifications never check reentrantly");
  assert.equal(reveals, 0);
  f.microtasks();
  assert.equal(f.scanCount, 2);
  assert.equal(reveals, 1);
  assert.equal(f.timerCount, 0);
});

test("scroll and resize stay on a frame which a DOM check can consume", () => {
  const f = fixture();
  f.nodes.loading.push(f.element());
  const dispose = prepareInitialPage(f.root, () =>
    assert.fail("data is pending"),
  );
  f.viewportEvent("scroll");
  f.viewportEvent("resize");
  assert.equal(f.frameCount, 1);
  assert.equal(f.microtaskCount, 0);
  assert.equal(f.scanCount, 1);
  f.frame();
  assert.equal(f.scanCount, 2);
  f.viewportEvent("resize");
  f.mutate();
  assert.equal(f.frameCount, 1);
  assert.equal(f.microtaskCount, 1);
  f.microtasks();
  assert.equal(f.scanCount, 3);
  assert.equal(f.frameCount, 0, "the same geometry must not be scanned twice");
  f.frame();
  assert.equal(f.scanCount, 3);
  dispose();
});

test("queued notifications and late decode cannot bypass the fallback frame", async () => {
  const f = fixture();
  let reveals = 0,
    finishDecode,
    fallbacks = 0;
  const media = {
    dispatchEvent() {
      fallbacks++;
      f.nodes.images.splice(0, 1);
      // React committing the terminal initials emits an observer notification.
      f.mutate();
    },
  };
  f.nodes.images.push(
    f.image({ complete: false, media }),
    f.image({
      decode: () => new Promise((resolve) => (finishDecode = resolve)),
    }),
  );
  prepareInitialPage(f.root, () => reveals++, {
    imageTimeout: 5,
    pageTimeout: 20,
  });
  await settle();
  f.mutate();
  assert.equal(f.microtaskCount, 1);
  f.advance(5);
  assert.equal(fallbacks, 1);
  assert.equal(f.frameCount, 1);
  finishDecode();
  await settle();
  f.event("load");
  f.event("error");
  f.viewportEvent("resize");
  f.microtasks();
  assert.equal(
    reveals,
    0,
    "the deadline still owes its fallback commit a frame",
  );
  assert.equal(f.frameCount, 1);
  assert.equal(f.microtaskCount, 0);
  f.advance(100);
  assert.equal(fallbacks, 1, "the second deadline cannot restart the fallback");
  assert.equal(reveals, 0);
  f.frame();
  assert.equal(reveals, 1);
  f.frame();
  assert.equal(reveals, 1);
});

test("cleanup invalidates a queued microtask and cancels its geometry frame", async () => {
  const f = fixture();
  let reveals = 0,
    finishDecode;
  f.nodes.images.push(
    f.image({
      decode: () => new Promise((resolve) => (finishDecode = resolve)),
    }),
  );
  const dispose = prepareInitialPage(f.root, () => reveals++);
  await settle();
  f.viewportEvent("scroll");
  f.mutate();
  assert.equal(f.frameCount, 1);
  assert.equal(f.microtaskCount, 1);
  dispose();
  assert.equal(f.frameCount, 0);
  f.microtasks();
  finishDecode();
  await settle();
  f.frame();
  f.advance(20000);
  assert.equal(f.scanCount, 1);
  assert.equal(f.microtaskCount, 0);
  assert.equal(f.timerCount, 0);
  assert.equal(f.connected, false);
  assert.equal(reveals, 0);
});

test("cleanup during the fallback event cannot leave a reveal frame behind", () => {
  const f = fixture();
  let reveals = 0,
    dispose;
  f.nodes.images.push(
    f.image({ complete: false, media: { dispatchEvent: () => dispose() } }),
  );
  dispose = prepareInitialPage(f.root, () => reveals++, { imageTimeout: 5 });
  f.advance(5);
  assert.equal(f.frameCount, 0);
  assert.equal(f.timerCount, 0);
  f.microtasks();
  f.frame();
  assert.equal(reveals, 0);
});

test("pending images do not create a microtask loop or repeat their decode", async () => {
  const f = fixture();
  let decodes = 0;
  f.nodes.images.push(
    f.image({
      decode() {
        decodes++;
        return new Promise(() => {});
      },
    }),
  );
  const dispose = prepareInitialPage(f.root, () =>
    assert.fail("decode is pending"),
  );
  await settle();
  for (let i = 0; i < 20; i++) {
    f.mutate();
    f.event("load");
  }
  f.microtasks();
  await settle();
  assert.equal(f.scanCount, 2);
  assert.equal(decodes, 1);
  assert.equal(f.microtaskCount, 0);
  assert.equal(f.frameCount, 0);
  dispose();
});

test("trace keeps the first queued time when a notification absorbs a frame", () => {
  const f = fixture({ trace: true });
  let reveals = 0;
  f.nodes.loading.push(f.element());
  prepareInitialPage(f.root, () => reveals++);
  f.advance(1);
  f.viewportEvent("resize");
  f.advance(2);
  f.nodes.loading.length = 0;
  f.mutate();
  f.advance(2);
  f.microtasks();
  const receipt = JSON.parse(f.root.getAttribute("data-vega-preparation"));
  assert.equal(reveals, 1);
  assert.equal(receipt.reason, "ready");
  assert.equal(receipt.totalChecks, 2);
  assert.equal(receipt.checks[1].startMs, 5);
  assert.equal(receipt.checks[1].queueMs, 4);
  assert.equal(receipt.checks[1].durationMs, 0);
  assert.equal(f.frameCount, 0);
});

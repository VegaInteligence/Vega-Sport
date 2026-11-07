import test from "node:test";
import assert from "node:assert/strict";
import { prepareInitialPage } from "../dashboard/frontend/src/services/initial-page.js";

function fixture() {
  let next = 0,
    now = 0;
  const frames = new Map(),
    timers = new Map(),
    listeners = new Map();
  let observer;
  const view = {
    innerWidth: 1000,
    innerHeight: 800,
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
  const root = {
    ownerDocument: { defaultView: view },
    querySelectorAll(selector) {
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
  return {
    root,
    nodes,
    image,
    element,
    mutate() {
      if (observer.connected) observer.fn();
    },
    event(name) {
      rootListeners.get(name)?.();
    },
    frame() {
      const batch = [...frames.values()];
      frames.clear();
      batch.forEach((fn) => fn());
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
  f.frame();
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

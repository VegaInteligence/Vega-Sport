import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createResourceCache } from "../dashboard/frontend/src/services/resource-cache.js";

process.env.NODE_ENV = "development";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = createRequire(path.join(root, "dashboard/package.json"));
const React = local("react");
const { renderToStaticMarkup } = local("react-dom/server");
const babel = local("next/dist/compiled/babel/core");
const commonjs = local(
  "next/dist/compiled/babel/plugin-transform-modules-commonjs",
);
const h = React.createElement;

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener);
    },
    emit(name) {
      for (const listener of [...(listeners.get(name) || [])]) listener();
    },
  };
}
// A real ReactDOM root renders null: no fake hook dispatcher or scheduler.
// This host supplies only the container/document APIs needed by that empty
// output. It does not stand in for native layout, image decoding or paint.
function host() {
  const doc = {
    ...eventTarget(),
    nodeType: 9,
    activeElement: null,
    visibilityState: "visible",
  };
  const element = (name) => ({
    ...eventTarget(),
    nodeType: 1,
    nodeName: name.toUpperCase(),
    tagName: name.toUpperCase(),
    ownerDocument: doc,
    namespaceURI: "http://www.w3.org/1999/xhtml",
    style: {},
    textContent: "",
    setAttribute() {},
    removeAttribute() {},
    getRootNode: () => doc,
  });
  doc.createElement = element;
  doc.documentElement = element("html");
  doc.body = element("body");
  const view = {
    ...eventTarget(),
    document: doc,
    HTMLIFrameElement: class {},
    HTMLElement: class {},
  };
  doc.defaultView = view;
  return { doc, view, container: element("div") };
}

async function withHook(run, { strict = false } = {}) {
  const before = {
    window: globalThis.window,
    document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  const { doc, view, container } = host();
  globalThis.window = view;
  globalThis.document = doc;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = local("react-dom/client");
  const renderer = createRoot(container);
  const Bootstrap = React.createContext(null);
  const reads = [],
    renders = [],
    commits = [],
    accepted = [];
  let cache,
    clock = 1000,
    mounted = true,
    committed;
  const filename = path.join(
    root,
    "dashboard/frontend/src/services/resources.js",
  );
  const code = babel.transformSync(await fs.readFile(filename, "utf8"), {
    plugins: [commonjs],
    babelrc: false,
    configFile: false,
    filename,
  }).code;
  const mod = { exports: {} };
  const stubs = {
    react: React,
    "../data-url.js": { apiUrl: (url) => url },
    "./public-api-fetch.js": {
      publicApiFetch: () => {
        throw Error("Unexpected HTTP");
      },
    },
    "./resource-bootstrap.js": {
      useResourceBootstrap: () => React.useContext(Bootstrap),
    },
    "./media-registry.js": {
      acceptMediaPayload: (...args) => accepted.push(args),
    },
    "./navigation-acceptance.js": {
      recordAcceptanceCacheRead: (kind) => reads.push(kind),
    },
    "./resource-cache.js": {
      createResourceCache: (options) =>
        (cache = createResourceCache({ ...options, now: () => clock })),
    },
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, {
    filename,
  })(
    (name) => {
      if (!(name in stubs)) throw Error(`Unexpected import ${name}`);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  function Probe({ resourceKey, loader, enabled = true, suspend }) {
    const value = mod.exports.useResource(resourceKey, loader, enabled);
    renders.push({ requestedKey: resourceKey, ...value });
    React.useLayoutEffect(() => {
      committed = value;
      commits.push({ requestedKey: resourceKey, ...value });
    });
    if (suspend) throw suspend;
    return null;
  }
  function Publisher({ publish }) {
    React.useLayoutEffect(() => publish?.(), [publish]);
    return null;
  }
  function tree(props, bootstrap, publish) {
    let content = h(
      Bootstrap.Provider,
      { value: bootstrap || null },
      h(
        React.Suspense,
        { fallback: null },
        h(Probe, props),
        h(Publisher, { publish }),
      ),
    );
    if (strict) content = h(React.StrictMode, null, content);
    return content;
  }
  const act = (operation) =>
    React.act(async () => {
      await operation?.();
    });
  const unmount = async () => {
    if (mounted) {
      mounted = false;
      await act(() => renderer.unmount());
    }
  };
  try {
    await run({
      cache,
      reads,
      renders,
      commits,
      accepted,
      doc,
      view,
      act,
      get value() {
        return committed;
      },
      advance(ms) {
        clock += ms;
      },
      render(props, { bootstrap, publish } = {}) {
        return act(() => renderer.render(tree(props, bootstrap, publish)));
      },
      transition(props) {
        return act(() =>
          React.startTransition(() => renderer.render(tree(props))),
        );
      },
      server(props, bootstrap) {
        let value;
        function ServerProbe() {
          value = mod.exports.useResource(
            props.resourceKey,
            props.loader,
            props.enabled,
          );
          return null;
        }
        globalThis.window = undefined;
        globalThis.document = undefined;
        try {
          renderToStaticMarkup(
            h(Bootstrap.Provider, { value: bootstrap || null }, h(ServerProbe)),
          );
        } finally {
          globalThis.window = view;
          globalThis.document = doc;
        }
        return value;
      },
      unmount,
    });
  } finally {
    await unmount();
    globalThis.window = before.window;
    globalThis.document = before.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = before.act;
  }
}

test("React warm mount commits once while retaining the real fresh cache read", async () => {
  await withHook(async (f) => {
    const value = { marker: "warm" };
    f.cache.seed("A", value);
    await f.render({
      resourceKey: "A",
      loader: () => {
        throw Error("must not load");
      },
    });
    assert.equal(f.renders.length, 1);
    assert.equal(f.commits.length, 1);
    assert.equal(f.value.value, value);
    assert.deepEqual(f.reads, ["fresh"]);
  });
});

test("React A to B to A reads a newer unsubscribed A without an old-value commit", async () => {
  await withHook(async (f) => {
    const loader = () => {
      throw Error("must not load");
    };
    f.cache.seed("A", { marker: "A1" });
    f.cache.seed("B", { marker: "B1" });
    await f.render({ resourceKey: "A", loader });
    await f.render({ resourceKey: "B", loader });
    f.advance(1);
    f.cache.seed("A", { marker: "A2" });
    await f.render({ resourceKey: "A", loader });
    assert.deepEqual(
      f.commits.map((entry) => entry.value.marker),
      ["A1", "B1", "A2"],
    );
    assert.equal(f.renders.length, 3);
    assert.deepEqual(f.reads, ["fresh", "fresh", "fresh"]);
  });
});

test("publication between React render and subscription wins the consistency check", async () => {
  await withHook(async (f) => {
    f.cache.seed("A", { marker: "before" });
    await f.render(
      {
        resourceKey: "A",
        loader: () => {
          throw Error("must not load");
        },
      },
      {
        publish() {
          f.advance(1);
          f.cache.seed("A", { marker: "after" });
        },
      },
    );
    assert.equal(f.commits[0].value.marker, "before");
    assert.equal(f.value.value.marker, "after");
    assert.equal(f.cache.peek("A").value.marker, "after");
    assert.deepEqual(f.reads, ["fresh"]);
  });
});

test("React retains refresh, error and retry notifications after a warm subscription", async () => {
  await withHook(async (f) => {
    f.cache.seed("A", { marker: "before" });
    let complete, pending;
    const loader = () =>
      new Promise((resolve, reject) => {
        complete = { resolve, reject };
      });
    await f.render({ resourceKey: "A", loader });
    await f.act(() => {
      pending = f.value.revalidate();
      pending.catch(() => {});
    });
    assert.equal(f.value.refreshing, true);
    assert.equal(f.value.value.marker, "before");
    await f.act(async () => {
      complete.reject(Error("offline"));
      await pending.catch(() => {});
    });
    assert.equal(f.value.refreshing, false);
    assert.equal(f.value.refreshError, "offline");
    assert.equal(f.value.value.marker, "before");
    await f.act(() => {
      pending = f.value.retry();
    });
    assert.equal(f.value.refreshing, true);
    await f.act(async () => {
      complete.resolve({ marker: "after" });
      await pending;
    });
    assert.equal(f.value.value.marker, "after");
    assert.equal(f.value.refreshError, undefined);
    assert.deepEqual(f.reads, ["fresh", "loader", "loader"]);
  });
});

test("React ignores an older bootstrap and accepts a newer committed bootstrap", async () => {
  await withHook(async (f) => {
    const loader = () => {
      throw Error("must not load");
    };
    f.cache.seed("A", { marker: "cache" }, { updatedAt: 900 });
    await f.render(
      { resourceKey: "A", loader },
      { bootstrap: { createdAt: 800, resources: { A: { marker: "older" } } } },
    );
    assert.equal(f.renders.length, 1);
    assert.equal(f.value.value.marker, "cache");
    await f.render(
      { resourceKey: "A", loader },
      { bootstrap: { createdAt: 1000, resources: { A: { marker: "newer" } } } },
    );
    assert.equal(f.value.value.marker, "newer");
    assert.equal(f.cache.peek("A").value.marker, "newer");
    assert.ok(f.renders.every((entry) => entry.value.marker !== "older"));
    assert.equal(f.accepted.length, 2);
  });
});

test("server snapshots stay request-specific and never seed or expose the shared cache", async () => {
  await withHook(async (f) => {
    const loader = () => {
      throw Error("SSR must not load");
    };
    f.cache.seed("A", { marker: "other-request" });
    const first = f.server(
      { resourceKey: "A", loader },
      { createdAt: 1, resources: { A: { marker: "request-1" } } },
    );
    const second = f.server(
      { resourceKey: "A", loader },
      { createdAt: 2, resources: { A: { marker: "request-2" } } },
    );
    const absent = f.server({ resourceKey: "A", loader });
    assert.equal(first.value.marker, "request-1");
    assert.equal(second.value.marker, "request-2");
    assert.equal(absent.value, undefined);
    assert.equal(absent.loading, true);
    assert.equal(f.cache.peek("A").value.marker, "other-request");
    assert.equal(f.accepted.length, 0);
    assert.deepEqual(f.reads, []);
  });
});

test("a bootstrap cannot hide or replace a request already pending at subscription", async () => {
  await withHook(async (f) => {
    let resolve,
      calls = 0;
    const loader = () => {
      calls++;
      return new Promise((done) => {
        resolve = done;
      });
    };
    const pending = f.cache.load("A", loader);
    await f.render(
      { resourceKey: "A", loader },
      {
        bootstrap: { createdAt: 1000, resources: { A: { marker: "seed" } } },
      },
    );
    assert.equal(calls, 1);
    assert.equal(f.value.loading, true);
    assert.equal(f.value.value, undefined);
    assert.deepEqual(f.reads, ["loader", "pending"]);
    await f.act(async () => {
      resolve({ marker: "network" });
      await pending;
    });
    assert.equal(f.value.value.marker, "network");
  });
});

test("a suspended uncommitted React render cannot replace the active key's loader", async () => {
  await withHook(async (f) => {
    const loads = [];
    f.cache.seed("A", { marker: "A1" });
    await f.render({
      resourceKey: "A",
      loader: () => {
        loads.push("A");
        return { marker: "A2" };
      },
    });
    const refreshA = f.value.revalidate;
    await f.transition({
      resourceKey: "B",
      loader: () => {
        loads.push("B");
        return { marker: "B" };
      },
      suspend: new Promise(() => {}),
    });
    await f.act(() => refreshA());
    assert.equal(f.cache.peek("A").value.marker, "A2");
    assert.equal(f.cache.peek("B"), undefined);
    assert.deepEqual(loads, ["A"]);
    assert.ok(f.commits.every((entry) => entry.requestedKey === "A"));
  });
});

test("StrictMode resubscription keeps a single pending request until actual unmount", async () => {
  await withHook(
    async (f) => {
      let calls = 0,
        signal,
        resolve;
      await f.render({
        resourceKey: "A",
        loader: (options) => {
          calls++;
          signal = options.signal;
          return new Promise((done) => {
            resolve = done;
          });
        },
      });
      assert.equal(calls, 1);
      assert.equal(signal.aborted, false);
      await f.unmount();
      assert.equal(signal.aborted, true);
      resolve({ marker: "ignored" });
      await Promise.resolve();
      assert.equal(f.cache.value("A"), undefined);
    },
    { strict: true },
  );
});

test("disabled resources do not subscribe and visibility/focus still refresh stale values", async () => {
  await withHook(async (f) => {
    let calls = 0;
    const loader = () => ({ marker: ++calls });
    await f.render({ resourceKey: "A", loader, enabled: false });
    assert.equal(f.cache.peek("A"), undefined);
    assert.deepEqual(f.reads, []);
    await f.render({ resourceKey: "A", loader });
    assert.equal(f.value.value.marker, 1);
    f.advance(300001);
    f.doc.visibilityState = "hidden";
    await f.act(() => f.view.emit("focus"));
    assert.equal(calls, 1);
    f.doc.visibilityState = "visible";
    await f.act(() => f.doc.emit("visibilitychange"));
    assert.equal(f.value.value.marker, 2);
    assert.equal(calls, 2);
    await f.render({ resourceKey: "A", loader, enabled: false });
    assert.equal(f.cache.forget("A"), true);
  });
});

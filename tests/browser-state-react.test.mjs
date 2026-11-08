import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.NODE_ENV = "development";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = createRequire(path.join(root, "dashboard/package.json"));
const React = local("react");
const { renderToStaticMarkup } = local("react-dom/server");
const { createBrowserStateStore, useBrowserState } =
  await import("../dashboard/frontend/src/services/browser-state.js");
const h = React.createElement;
const season = "2026/2027";
const preferenceKey = "orion.preferences.v1";
const pageKey = "statarena:page-seasons:v1";
const researchKey = "statarena.research.v1";

function events() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener);
    },
    emit(name, event) {
      for (const listener of [...(listeners.get(name) || [])]) listener(event);
    },
    listenerCount(name) {
      return listeners.get(name)?.size || 0;
    },
  };
}
function storage() {
  const values = new Map();
  return {
    writes: [],
    reads: 0,
    failRead: false,
    failWrite: false,
    getItem(key) {
      this.reads++;
      if (this.failRead) throw Error("storage is blocked");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (this.failWrite) throw Error("quota exceeded");
      this.writes.push({ key, value });
      values.set(key, value);
    },
    external(key, value) {
      if (value === null) values.delete(key);
      else
        values.set(
          key,
          typeof value === "string" ? value : JSON.stringify(value),
        );
    },
  };
}
async function withBrowser(run) {
  const before = {
    window: globalThis.window,
    document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  const doc = {
    ...events(),
    nodeType: 9,
    activeElement: null,
    visibilityState: "visible",
  };
  const element = (name) => ({
    ...events(),
    nodeType: 1,
    nodeName: name.toUpperCase(),
    tagName: name.toUpperCase(),
    ownerDocument: doc,
    namespaceURI: "http://www.w3.org/1999/xhtml",
    style: {},
    dataset: {},
    textContent: "",
    firstChild: null,
    setAttribute() {},
    removeAttribute() {},
    getRootNode: () => doc,
  });
  doc.createElement = element;
  doc.documentElement = element("html");
  doc.body = element("body");
  const view = {
    ...events(),
    document: doc,
    HTMLIFrameElement: class {},
    HTMLElement: class {},
    localStorage: storage(),
    sessionStorage: storage(),
    location: new URL("https://statarena.invalid/?season=" + season),
    history: {
      replaceState(_state, _title, href) {
        view.location = new URL(href, view.location);
      },
    },
  };
  doc.defaultView = view;
  globalThis.window = view;
  globalThis.document = doc;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot, hydrateRoot } = local("react-dom/client");
  const container = element("div");
  let renderer;
  const act = (operation) =>
    React.act(async () => {
      await operation?.();
    });
  const unmount = async () => {
    if (!renderer) return;
    await act(() => renderer.unmount());
    renderer = null;
  };
  try {
    await run({
      view,
      doc,
      act,
      local: view.localStorage,
      session: view.sessionStorage,
      render(tree) {
        return act(() => {
          renderer ||= createRoot(container);
          renderer.render(tree);
        });
      },
      hydrate(tree) {
        return act(() => {
          renderer = hydrateRoot(container, tree);
        });
      },
      server(tree) {
        globalThis.window = undefined;
        globalThis.document = undefined;
        try {
          return renderToStaticMarkup(tree);
        } finally {
          globalThis.window = view;
          globalThis.document = doc;
        }
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
function exampleStore(options = {}) {
  return createBrowserStateStore({
    key: "example",
    storage: "localStorage",
    fallback: { count: 0 },
    normalize: (value) => ({
      count: Number.isFinite(value?.count) ? value.count : 0,
    }),
    ...options,
  });
}
function witness(store) {
  const renders = [],
    commits = [];
  let value;
  function Probe({ serverValue = { count: -1 }, suspend }) {
    const [data, set, ready] = useBrowserState(store, serverValue);
    const snapshot = { data, set, ready };
    renders.push(snapshot);
    React.useLayoutEffect(() => {
      value = snapshot;
      commits.push(snapshot);
    });
    if (suspend) throw suspend;
    return null;
  }
  return {
    Probe,
    renders,
    commits,
    get value() {
      return value;
    },
  };
}

test("client remount starts with reconciled state and makes no identical storage write", async () => {
  await withBrowser(async (f) => {
    const w = witness(exampleStore());
    f.local.external("example", { count: 5 });
    await f.render(h(w.Probe));
    assert.equal(w.commits.length, 1);
    assert.deepEqual(w.value.data, { count: 5 });
    assert.equal(w.value.ready, true);
    const first = w.value.data;
    await f.unmount();
    await f.render(h(w.Probe, { serverValue: { count: 99 } }));
    assert.equal(w.commits.length, 2);
    assert.equal(w.value.data, first);
    await f.act(() => w.value.set({ count: 5 }));
    assert.equal(w.commits.length, 2);
    assert.equal(f.local.writes.length, 0);
  });
});

test("SSR and hydration use their request seed before reconciling browser storage", async () => {
  await withBrowser(async (f) => {
    const w = witness(exampleStore());
    f.local.external("example", { count: 5 });
    f.server(h(w.Probe, { serverValue: { count: 1 } }));
    assert.deepEqual(w.renders.at(-1).data, { count: 1 });
    assert.equal(w.renders.at(-1).ready, false);
    assert.equal(f.local.reads, 0);
    await f.hydrate(h(w.Probe, { serverValue: { count: 1 } }));
    assert.deepEqual(
      w.commits.map((v) => [v.data.count, v.ready]),
      [
        [1, false],
        [5, true],
      ],
    );
    f.server(h(w.Probe, { serverValue: { count: 9 } }));
    assert.deepEqual(w.renders.at(-1).data, { count: 9 });
    assert.equal(w.renders.at(-1).ready, false);
    assert.equal(f.local.writes.length, 0);
  });
});

test("storage changes between visits win before the first client commit", async () => {
  await withBrowser(async (f) => {
    const w = witness(exampleStore());
    f.local.external("example", { count: 1 });
    await f.render(h(w.Probe));
    await f.unmount();
    f.local.external("example", { count: 2 });
    await f.render(h(w.Probe, { serverValue: { count: 1 } }));
    assert.deepEqual(
      w.commits.map((v) => v.data.count),
      [1, 2],
    );
    assert.equal(f.local.writes.length, 0);
  });
});

test("a storage publication between render and subscribe passes React's consistency check", async () => {
  await withBrowser(async (f) => {
    const w = witness(exampleStore());
    f.local.external("example", { count: 1 });
    function Publisher() {
      React.useLayoutEffect(
        () => f.local.external("example", { count: 2 }),
        [],
      );
      return null;
    }
    await f.render(h(React.Fragment, null, h(w.Probe), h(Publisher)));
    assert.deepEqual(
      w.commits.map((v) => v.data.count),
      [1, 2],
    );
    assert.equal(f.local.writes.length, 0);
  });
});

test("same-document edits and other-tab changes notify consumers without replaying equal values", async () => {
  await withBrowser(async (f) => {
    const store = exampleStore(),
      w = witness(store),
      other = witness(store);
    await f.render(h(React.Fragment, null, h(w.Probe), h(other.Probe)));
    await f.act(() => w.value.set((data) => ({ count: data.count + 1 })));
    assert.equal(w.value.data.count, 1);
    assert.equal(other.value.data, w.value.data);
    assert.equal(f.local.writes.length, 1);
    f.local.external("example", { count: 2 });
    await f.act(() =>
      f.view.emit("storage", { key: "example", storageArea: f.local }),
    );
    assert.equal(w.value.data.count, 2);
    assert.equal(other.value.data, w.value.data);
    const commits = w.commits.length;
    await f.act(() =>
      f.view.emit("storage", { key: "example", storageArea: f.local }),
    );
    assert.equal(w.commits.length, commits);
    f.local.external("example", null);
    await f.act(() =>
      f.view.emit("storage", { key: null, storageArea: f.local }),
    );
    assert.equal(w.value.data.count, 0);
    await f.unmount();
    assert.equal(f.view.listenerCount("storage"), 0);
  });
});

test("an initially blocked document keeps an unsaved edit when storage becomes readable", async () => {
  await withBrowser(async (f) => {
    const w = witness(exampleStore());
    f.local.failRead = true;
    f.local.failWrite = true;
    await f.render(h(w.Probe));
    await f.act(() => assert.equal(w.value.set({ count: 7 }), false));
    await f.unmount();
    f.local.failRead = false;
    await f.render(h(w.Probe));
    assert.equal(w.value.data.count, 7);
    f.local.failWrite = false;
    await f.act(() => assert.equal(w.value.set({ count: 7 }), true));
    assert.equal(JSON.parse(f.local.getItem("example")).count, 7);
  });
});

test("two browser documents cannot reuse each other's in-memory snapshot", async () => {
  const store = exampleStore();
  await withBrowser(async (first) => {
    first.local.external("example", { count: 1 });
    const a = witness(store);
    await first.render(h(a.Probe));
    const firstValue = a.value.data;
    await withBrowser(async (second) => {
      second.local.external("example", { count: 2 });
      const b = witness(store);
      await second.render(h(b.Probe));
      assert.equal(b.value.data.count, 2);
      assert.notEqual(b.value.data, firstValue);
      assert.equal(second.local.writes.length, 0);
    });
    assert.equal(store.getSnapshot().value, firstValue);
    assert.equal(first.local.writes.length, 0);
  });
});

test("failed storage writes retain edits across remounts and retry without losing them", async () => {
  await withBrowser(async (f) => {
    const w = witness(exampleStore());
    f.local.external("example", { count: 1 });
    await f.render(h(w.Probe));
    f.local.failWrite = true;
    await f.act(() => assert.equal(w.value.set({ count: 7 }), false));
    assert.equal(w.value.data.count, 7);
    await f.unmount();
    await f.render(h(w.Probe));
    assert.equal(
      w.value.data.count,
      7,
      "the old persisted value cannot erase the edit",
    );
    f.local.failRead = true;
    await f.unmount();
    await f.render(h(w.Probe));
    assert.equal(w.value.data.count, 7);
    f.local.failRead = false;
    f.local.failWrite = false;
    await f.act(() => assert.equal(w.value.set({ count: 7 }), true));
    assert.equal(JSON.parse(f.local.getItem("example")).count, 7);
    assert.equal(f.local.writes.length, 1);
  });
});

test("blocked or malformed storage never marks the cookie seed as reconciled", async () => {
  await withBrowser(async (f) => {
    const w = witness(exampleStore());
    f.local.failRead = true;
    await f.render(h(w.Probe, { serverValue: { count: 99 } }));
    assert.deepEqual(w.value.data, { count: 0 });
    assert.equal(
      w.value.ready,
      true,
      "ready describes the client fallback, not the cookie",
    );
    await f.unmount();
    f.local.failRead = false;
    f.local.external("example", "{invalid");
    await f.render(h(w.Probe, { serverValue: { count: 99 } }));
    assert.deepEqual(w.value.data, { count: 0 });
    assert.equal(f.local.writes.length, 0);
  });
});

test("StrictMode and an abandoned render do not persist a bootstrap or leak listeners", async () => {
  await withBrowser(async (f) => {
    const w = witness(exampleStore());
    f.local.external("example", { count: 3 });
    await f.render(h(React.StrictMode, null, h(w.Probe)));
    assert.equal(f.view.listenerCount("storage"), 1);
    await f.render(
      h(
        React.Suspense,
        { fallback: null },
        h(w.Probe, {
          serverValue: { count: 999 },
          suspend: new Promise(() => {}),
        }),
      ),
    );
    assert.equal(f.local.writes.length, 0);
    await f.unmount();
    assert.equal(f.view.listenerCount("storage"), 0);
    await f.render(h(w.Probe));
    assert.equal(w.value.data.count, 3);
  });
});

test("an unavailable first read can retain a committed request fallback but not an abandoned one", async () => {
  await withBrowser(async (f) => {
    const store = exampleStore({ preserveRequestFallback: true });
    const w = witness(store);
    f.local.failRead = true;
    await f.render(
      h(
        React.Suspense,
        { fallback: null },
        h(w.Probe, {
          serverValue: { count: 99 },
          suspend: new Promise(() => {}),
        }),
      ),
    );
    assert.equal(w.commits.length, 0);
    await f.render(h(w.Probe, { serverValue: { count: 7 } }));
    assert.equal(w.value.data.count, 7);
    assert.equal(w.commits.length, 1);
    await f.unmount();
    await f.render(h(w.Probe, { serverValue: { count: 9 } }));
    assert.equal(
      w.value.data.count,
      7,
      "the committed document state wins over another seed",
    );
    assert.equal(f.local.writes.length, 0);
  });
});

test("readable storage overrides a request fallback before commit, including recovery", async () => {
  await withBrowser(async (f) => {
    const w = witness(exampleStore({ preserveRequestFallback: true }));
    f.local.failRead = true;
    await f.render(h(w.Probe, { serverValue: { count: 99 } }));
    assert.equal(w.value.data.count, 99);
    await f.unmount();
    f.local.failRead = false;
    f.local.external("example", { count: 4 });
    await f.render(h(w.Probe, { serverValue: { count: 99 } }));
    assert.equal(w.value.data.count, 4);
    assert.deepEqual(
      w.commits.map((value) => value.data.count),
      [99, 4],
    );
    await f.unmount();
    f.local.external("example", null);
    await f.render(h(w.Probe, { serverValue: { count: 99 } }));
    assert.equal(
      w.value.data.count,
      0,
      "a valid absent preference is the default, not a failed read",
    );
    assert.equal(f.local.writes.length, 0);
  });
});

async function providers() {
  const babel = local("next/dist/compiled/babel/core");
  const preset = local("next/dist/compiled/babel/preset-react");
  const commonjs = local(
    "next/dist/compiled/babel/plugin-transform-modules-commonjs",
  );
  const manifest = {
    storage: "aws-relational",
    defaultSeason: season,
    publicationVersion: "g1",
    capabilities: { compactReads: { home: true, players: true, clubs: true } },
    seasons: [
      { id: season, chunks: [] },
      { id: "2025/2026", chunks: [] },
    ],
    competitions: [],
  };
  const empty = {
    meta: { storage: "aws-relational" },
    competitions: [],
    teams: [],
    matches: [],
    appearances: [],
    fixtures: [],
    metrics: [],
  };
  const refresh = async () => {};
  const searches = new Map();
  const searchParams = () => {
    const search = globalThis.window?.location.search || "";
    if (!searches.has(search))
      searches.set(search, new URLSearchParams(search));
    return searches.get(search);
  };
  async function compile(file, overrides) {
    const filename = path.join(root, "dashboard/frontend/src", file);
    const source = await fs.readFile(filename, "utf8");
    const stubs = { react: React, ...overrides };
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const name = match[1];
      if (!(name in stubs) && name.endsWith(".js"))
        stubs[name] = await import(
          pathToFileURL(path.resolve(path.dirname(filename), name)).href
        );
    }
    const code = babel.transformSync(source, {
      presets: [[preset, { runtime: "classic" }]],
      plugins: [commonjs],
      babelrc: false,
      configFile: false,
      filename,
    }).code;
    const mod = { exports: {} };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, {
      filename,
    })(
      (name) => {
        if (!(name in stubs)) throw Error("Unexpected import " + name);
        return stubs[name];
      },
      mod,
      mod.exports,
    );
    return mod.exports;
  }
  const football = await compile("hooks/FootballContext.jsx", {
    "next/navigation": {
      usePathname: () => globalThis.window?.location.pathname || "/",
      useSearchParams: searchParams,
    },
    "../services/resources.js": {
      useResource: (key) => ({
        loading: false,
        value:
          key === "manifest"
            ? manifest
            : key.startsWith("status:")
              ? true
              : empty,
        revalidate: refresh,
        retry() {},
      }),
      cachedResource: () => undefined,
      primeResource: async () => empty,
      json: async () => {
        throw Error("unexpected HTTP");
      },
      download() {},
    },
    "./usePublishedDataRefresh.js": { __esModule: true, default: () => {} },
    "../components/UI.jsx": {
      AsyncState: ({ resource, children }) => children(resource.value),
    },
    "../components/LoadingPage.jsx": { __esModule: true, default: () => null },
  });
  return { ...football, ...(await compile("hooks/ResearchContext.jsx", {})) };
}

test("actual Football and Research providers commit once on a warm Home remount", async () => {
  const p = await providers();
  await withBrowser(async (f) => {
    const preferences = {
      focus: "all",
      defaultSeason: "",
      favoriteLeagueIds: ["l_3FJFUl"],
      onboardingComplete: true,
    };
    f.local.external(preferenceKey, preferences);
    f.session.external(pageKey, { "/": season, "/clubs": season });
    f.local.external(researchKey, {
      version: 1,
      lists: [
        {
          id: "main",
          name: "Ma sélection",
          entries: [{ kind: "clubs", id: "t_0BrMnM" }],
        },
      ],
    });
    const commits = [];
    let current;
    function Probe() {
      const football = p.useFootball(),
        research = p.useResearch();
      React.useLayoutEffect(() => {
        current = { football, research };
        commits.push(current);
      });
      return null;
    }
    const tree = () =>
      h(
        p.FootballProvider,
        { loadData: false },
        h(p.ResearchProvider, null, h(Probe)),
      );
    await f.render(tree());
    assert.equal(commits.length, 1);
    assert.equal(current.football.preferencesReady, true);
    assert.equal(current.research.ready, true);
    const firstPreferences = current.football.preferences;
    const firstResearch = current.research.data;
    await f.unmount();
    await f.render(tree());
    assert.equal(
      commits.length,
      2,
      "no passive preference/research hydration replay",
    );
    assert.equal(current.football.preferences, firstPreferences);
    assert.equal(current.research.data, firstResearch);
    assert.equal(f.local.writes.length, 0);
    assert.equal(f.session.writes.length, 0);
    await f.act(() => current.football.savePreferences({ focus: "europe" }));
    assert.equal(current.football.preferences.focus, "europe");
    assert.equal(f.local.writes.length, 1);
    await f.unmount();
    await f.render(tree());
    assert.equal(current.football.preferences.focus, "europe");
    assert.equal(f.local.writes.length, 1);
  });
});

test("actual Football keeps its request preferences and season on a failed first read, then retains edits", async () => {
  const p = await providers();
  for (const failure of ["blocked", "malformed", "null"]) {
    await withBrowser(async (f) => {
      const initialState = {
        preferences: {
          focus: "all",
          defaultSeason: "",
          favoriteLeagueIds: ["l_3FJFUl"],
          onboardingComplete: true,
        },
        season: "2025/2026",
        personalTeams: ["t_0BrMnM"],
        personalPlayers: [],
      };
      f.view.location = new URL("https://statarena.invalid/");
      if (failure === "blocked") {
        f.local.failRead = true;
        f.session.failRead = true;
      } else {
        f.local.external(
          preferenceKey,
          failure === "null" ? "null" : "{invalid",
        );
        f.session.external(pageKey, failure === "null" ? "null" : "{invalid");
      }
      f.local.failWrite = true;
      f.session.failWrite = true;
      const commits = [];
      let current;
      function Probe() {
        const football = p.useFootball(),
          research = p.useResearch();
        React.useLayoutEffect(() => {
          current = { football, research };
          commits.push(current);
        });
        return null;
      }
      const tree = (seed) =>
        h(
          p.FootballProvider,
          { initialState: seed, loadData: false },
          h(p.ResearchProvider, { initialState: seed }, h(Probe)),
        );
      await f.render(tree(initialState));
      assert.equal(current.football.preferences.focus, "all", failure);
      assert.deepEqual(
        current.football.preferences.favoriteLeagueIds,
        ["l_3FJFUl"],
        failure,
      );
      assert.equal(current.football.season, "2025/2026", failure);
      assert.equal(commits.length, 1, failure);
      assert.equal(current.football.preferencesReady, true);
      assert.equal(
        current.research.data.lists[0].entries.length,
        0,
        "Research keeps its existing EMPTY fallback",
      );
      await f.act(() =>
        current.football.savePreferences({ favoriteLeagueIds: ["l_4WFCIZ"] }),
      );
      await f.unmount();
      await f.render(
        tree({
          ...initialState,
          preferences: { ...initialState.preferences, focus: "europe" },
        }),
      );
      assert.equal(current.football.preferences.focus, "all", failure);
      assert.deepEqual(
        current.football.preferences.favoriteLeagueIds,
        ["l_4WFCIZ"],
        failure,
      );
      assert.equal(f.local.writes.length, 0);
      assert.equal(f.session.writes.length, 0);
    });
  }
});

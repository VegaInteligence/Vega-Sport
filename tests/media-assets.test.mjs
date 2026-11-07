import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadMediaAsset } from "../dashboard/frontend/src/services/media-assets.js";

const turn = () => new Promise((resolve) => setImmediate(resolve));
const source =
  "/api/assets?url=https%3A%2F%2Fcdn.pitchapi.dev%2Fimages%2Fteam.webp";
const image = (body = "small-image") =>
  new Response(body, { headers: { "Content-Type": "image/webp" } });

test("duplicate visible images share bytes and one subscriber leaving does not cancel the others", async () => {
  let calls = 0,
    complete,
    sharedSignal;
  const fetcher = (_url, options) => {
    calls++;
    sharedSignal = options.signal;
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.deepEqual(options.headers, { Accept: "image/*" });
    return new Promise((resolve) => {
      complete = resolve;
    });
  };
  const controller = new AbortController();
  const a = loadMediaAsset(source, { fetcher, signal: controller.signal });
  const rejection = assert.rejects(a, { name: "AbortError" });
  const b = loadMediaAsset(source, { fetcher });
  await turn();
  controller.abort();
  await rejection;
  assert.equal(calls, 1);
  assert.equal(sharedSignal.aborted, false);
  complete(image());
  const blob = await b;
  assert.equal(blob.type, "image/webp");
  assert.equal(await loadMediaAsset(source, { fetcher }), blob);
  assert.equal(calls, 1, "remounting reuses the retained successful Blob");
});

test("the final image subscriber aborts its request and a later mount can retry", async () => {
  const signals = [];
  let calls = 0;
  const fetcher = (_url, { signal }) => {
    calls++;
    signals.push(signal);
    if (calls > 1) return Promise.resolve(image());
    return new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      }),
    );
  };
  const controller = new AbortController();
  const pending = loadMediaAsset(source, {
    fetcher,
    signal: controller.signal,
  });
  const rejection = assert.rejects(pending, { name: "AbortError" });
  await turn();
  controller.abort();
  await rejection;
  await turn();
  assert.equal(signals[0].aborted, true);
  assert.equal((await loadMediaAsset(source, { fetcher })).type, "image/webp");
  assert.equal(calls, 2);
});

test("the image cache retains a bounded set of small assets and releases larger ones", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return image();
  };
  for (let i = 0; i < 65; i++)
    await loadMediaAsset(`${source}&test=${i}`, { fetcher });
  await loadMediaAsset(`${source}&test=64`, { fetcher });
  assert.equal(calls, 65);
  await loadMediaAsset(`${source}&test=0`, { fetcher });
  assert.equal(calls, 66, "old unused images are evicted");
  let largeCalls = 0;
  const largeFetcher = async () => {
    largeCalls++;
    return image(new Uint8Array(256 * 1024 + 1));
  };
  await loadMediaAsset(source, { fetcher: largeFetcher });
  await loadMediaAsset(source, { fetcher: largeFetcher });
  assert.equal(largeCalls, 2, "large photos do not occupy the in-memory cache");
});

test("image HTTP errors and invalid formats remain failures, without accepting arbitrary routes", async () => {
  let calls = 0;
  const unavailable = async () => {
    calls++;
    return new Response(null, { status: 404 });
  };
  await assert.rejects(loadMediaAsset(source, { fetcher: unavailable }), {
    status: 404,
  });
  assert.equal(calls, 1);
  await assert.rejects(
    loadMediaAsset(source, {
      fetcher: async () => Response.json({ error: "not an image" }),
    }),
    { status: 415 },
  );
  await assert.rejects(
    loadMediaAsset(source, {
      fetcher: async () =>
        new Response("short", {
          headers: {
            "Content-Type": "image/webp",
            "Content-Length": String(4 * 1024 * 1024 + 1),
          },
        }),
    }),
    { status: 413 },
  );
  await assert.rejects(
    loadMediaAsset("/api/read/player", {
      fetcher: () => {
        throw new Error("must not run");
      },
    }),
    /Route d’image/,
  );
});

// Exercise the real component's lifecycle, without mounting a browser or loading
// its network. Shared Blob cancellation is checked above with the real cache.
async function imageComponent(t, run, component = "ApiImage") {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const requireLocal = createRequire(path.join(root, "dashboard/package.json"));
  const babel = requireLocal("next/dist/compiled/babel/core"),
    preset = requireLocal("next/dist/compiled/babel/preset-react"),
    commonjs = requireLocal(
      "next/dist/compiled/babel/plugin-transform-modules-commonjs",
    );
  const filename = path.join(
    root,
    `dashboard/frontend/src/components/${component === "Media" ? "UI" : "ApiImage"}.jsx`,
  );
  const slots = [],
    requests = [],
    created = [],
    revoked = [];
  let cursor = 0,
    pending = [],
    visible = false;
  const equal = (a, b) =>
    a?.length === b?.length && a.every((x, i) => Object.is(x, b[i]));
  const React = {
    createElement: (tag, props, ...children) => ({
      tag,
      props: { ...props, children },
    }),
    useState: (initial) => {
      const index = cursor++,
        slot = (slots[index] ||= { value: initial });
      return [
        slot.value,
        (value) => {
          slot.value = value;
        },
      ];
    },
    useRef: (initial) => (slots[cursor++] ||= { current: initial }),
    useEffect: (effect, deps) => {
      const index = cursor++;
      if (!equal(slots[index]?.deps, deps))
        pending.push({ index, effect, deps });
    },
  };
  const stubs = {
    react: React,
    "../hooks/useVisibleIntent.js": {
      __esModule: true,
      default: () => [null, visible],
    },
    "../services/media-assets.js": {
      loadMediaAsset: (src, { signal }) =>
        new Promise((resolve, reject) =>
          requests.push({ src, signal, resolve, reject }),
        ),
    },
    "./Icon.jsx": { __esModule: true, default: () => null },
    "./ApiImage.jsx": { __esModule: true, default: () => null },
    "../services/format.js":
      await import("../dashboard/frontend/src/services/format.js"),
  };
  const code = babel.transformSync(await fs.readFile(filename, "utf8"), {
    presets: [[preset, { runtime: "classic" }]],
    plugins: [commonjs],
    babelrc: false,
    configFile: false,
    filename,
  }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})", {
    filename,
  })(
    (name) => {
      if (!(name in stubs)) throw new Error("Unexpected import " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  t.mock.method(URL, "createObjectURL", (blob) => {
    const url = `blob:test-${created.length}`;
    created.push({ blob, url });
    return url;
  });
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  const unmount = () => {
    for (const slot of slots) slot?.cleanup?.();
  };
  try {
    await run({
      requests,
      created,
      revoked,
      unmount,
      visible: (next) => {
        visible = next;
      },
      render: (props) => {
        cursor = 0;
        pending = [];
        return (
          component === "Media" ? mod.exports.Media : mod.exports.default
        )(props);
      },
      commit: () => {
        for (const { index } of pending) slots[index]?.cleanup?.();
        for (const item of pending)
          slots[item.index] = { ...item, cleanup: item.effect() };
        pending = [];
      },
    });
  } finally {
    unmount();
  }
}

test("images wait for visible intent, rerenders reuse bytes, and URLs are released on source change", async (t) => {
  await imageComponent(
    t,
    async ({
      visible,
      render,
      commit,
      requests,
      created,
      revoked,
      unmount,
    }) => {
      const first = {
        src: source,
        alt: "",
        loading: "lazy",
        onError: () => {},
      };
      assert.equal(render(first).props.src, undefined);
      commit();
      assert.equal(requests.length, 0);
      visible(true);
      render(first);
      commit();
      assert.equal(requests.length, 1);
      requests[0].resolve(new Blob(["image"], { type: "image/webp" }));
      await turn();
      assert.equal(
        render({ ...first, onError: () => {} }).props.src,
        "blob:test-0",
      );
      commit();
      assert.equal(requests.length, 1);
      assert.equal(created.length, 1);
      const second = { ...first, src: source + "&next=1" };
      assert.equal(render(second).props.src, undefined);
      commit();
      assert.deepEqual(revoked, ["blob:test-0"]);
      assert.equal(requests.length, 2);
      unmount();
      assert.equal(requests[1].signal.aborted, true);
      requests[1].resolve(new Blob(["late"]));
      await turn();
      assert.equal(
        created.length,
        1,
        "a late abandoned download cannot allocate another URL",
      );
    },
  );
});

test("real image failures invoke the existing fallback handler once; cancellation does not", async (t) => {
  await imageComponent(
    t,
    async ({ visible, render, commit, requests, unmount }) => {
      const failures = [];
      visible(true);
      const props = {
        src: source,
        onError: (error) => failures.push(error.status),
      };
      render(props);
      commit();
      requests[0].reject(Object.assign(new Error("missing"), { status: 404 }));
      await turn();
      render({ ...props });
      commit();
      assert.deepEqual(failures, [404]);
      assert.equal(requests.length, 1);
      render({ ...props, src: source + "&next=1" });
      commit();
      unmount();
      requests[1].reject(new DOMException("Aborted", "AbortError"));
      await turn();
      assert.deepEqual(failures, [404]);
    },
  );
});

test("Media retains its alternate-source fallback but never changes URL to evade capacity backoff", async (t) => {
  const props = {
    name: "Paris Club",
    url: "https://cdn.pitchapi.dev/first.webp",
    fallbackUrl: "https://cdn.pitchapi.dev/second.webp",
  };
  await imageComponent(
    t,
    async ({ render, commit }) => {
      const initial = render(props).props.children[0];
      commit();
      initial.props.onError(
        Object.assign(new Error("missing"), { status: 404 }),
      );
      const alternate = render(props).props.children[0];
      commit();
      assert.ok(alternate.props.src.includes("second.webp"));
      alternate.props.onError({});
      const unavailable = render(props).props.children[0];
      commit();
      assert.equal(unavailable.props.className, "image-fallback");
      assert.deepEqual(unavailable.props.children, ["PC"]);
    },
    "Media",
  );
  await imageComponent(
    t,
    async ({ render, commit }) => {
      const initial = render(props).props.children[0];
      commit();
      initial.props.onError(
        Object.assign(new Error("capacity"), { status: 429, throttled: true }),
      );
      const unavailable = render(props).props.children[0];
      commit();
      assert.equal(unavailable.props.className, "image-fallback");
      assert.equal(unavailable.props.src, undefined);
    },
    "Media",
  );
});

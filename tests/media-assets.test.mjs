import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createPublicApiTransport } from "../dashboard/frontend/src/services/public-api-fetch.js";
import { apiUrl } from "../dashboard/frontend/src/data-url.js";

const turn = () => new Promise((resolve) => setImmediate(resolve));
const source =
  "/api/assets?url=https%3A%2F%2Fcdn.pitchapi.dev%2Fimages%2Fteam.webp";

// Exercise the compiled component, its refs/effect cleanup and native load/error
// handlers against the real shared scheduler. No fetch/Blob/CORS mock stands in
// for image decoding; a native browser decode remains a deployment acceptance.
async function imageComponent(
  run,
  { component = "ApiImage", transport = createPublicApiTransport() } = {},
) {
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
    admissions = [],
    assignments = [],
    removals = [];
  let cursor = 0,
    pending = [],
    visible = false,
    tree,
    node,
    mediaKey;
  const equal = (a, b) =>
    a?.length === b?.length && a.every((x, i) => Object.is(x, b[i]));
  const visibilityRef = () => {};
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
    useCallback: (callback, deps) => {
      const index = cursor++;
      if (!equal(slots[index]?.deps, deps))
        slots[index] = { value: callback, deps };
      return slots[index].value;
    },
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
      default: () => [visibilityRef, visible],
    },
    "../data-url.js": { apiUrl },
    "../services/public-api-fetch.js": {
      acquirePublicImage: (options) => {
        admissions.push(options);
        return transport.imagePermit(options);
      },
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
  function createNode(key) {
    const attrs = new Map();
    const listeners = new Map();
    return {
      key,
      props: null,
      addEventListener(type, handler) { listeners.set(type, handler); },
      removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
      dispatchEvent(event) { listeners.get(event.type)?.(event); },
      get src() {
        return attrs.get("src");
      },
      set src(value) {
        attrs.set("src", value);
        assignments.push({ node: this, src: value });
      },
      removeAttribute(name) {
        removals.push({ node: this, name, before: transport.pending() });
        attrs.delete(name);
      },
    };
  }
  const unmount = () => {
    for (const slot of slots) slot?.cleanup?.();
    if (component === "ApiImage") node?.props.ref?.(null);
    else if (node?.props.ref) node.props.ref.current = null;
    node = null;
  };
  try {
    await run({
      admissions,
      assignments,
      removals,
      transport,
      unmount,
      node: () => node,
      visible: (value) => {
        visible = value;
      },
      render: (props) => {
        cursor = 0;
        pending = [];
        tree = (component === "Media" ? mod.exports.Media : mod.exports.default)(props);
        if (component === "Media") {
          if (mediaKey !== undefined && mediaKey !== tree.props.key) {
            for (const slot of slots) slot?.cleanup?.();
            slots.length = 0;
            node = null;
          }
          mediaKey = tree.props.key;
          tree = tree.tag(tree.props);
        }
        return tree;
      },
      commit: () => {
        if (component === "ApiImage") {
          if (!node || node.key !== tree.props.key) {
            node?.props.ref?.(null);
            node = createNode(tree.props.key);
            tree.props.ref(node);
          }
          node.props = tree.props;
        } else {
          node ||= createNode(mediaKey);
          node.props = tree.props;
          tree.props.ref.current = node;
        }
        // React changes the DOM/ref before passive cleanup. A source-change
        // cleanup must remove src from its captured old node, not the new one.
        for (const { index } of pending) slots[index]?.cleanup?.();
        for (const item of pending)
          slots[item.index] = { ...item, cleanup: item.effect() };
        pending = [];
      },
      emit: (type, target = node) =>
        target.props[type]({ currentTarget: target }),
    });
  } finally {
    unmount();
  }
}

test("native images wait for visible admission and release only on load", async () => {
  await imageComponent(
    async ({
      visible,
      render,
      commit,
      admissions,
      assignments,
      node,
      emit,
      transport,
    }) => {
      let loaded = 0;
      const props = {
        src: source,
        alt: "",
        loading: "lazy",
        onLoad: () => loaded++,
      };
      assert.equal(render(props).props.src, undefined);
      commit();
      await turn();
      assert.equal(admissions.length, 0);
      visible(true);
      assert.equal(
        render(props).props.loading,
        "eager",
        "native lazy loading cannot strand an admitted permit",
      );
      commit();
      await turn();
      assert.equal(admissions.length, 1);
      assert.equal(node().src, apiUrl(source));
      assert.equal(
        node().props.crossOrigin,
        undefined,
        "redirected images retain native no-CORS delivery",
      );
      assert.deepEqual(transport.pending(), {
        active: 1,
        images: 1,
        queued: 0,
      });
      render({ ...props, onError: () => {} });
      commit();
      await turn();
      assert.equal(
        assignments.length,
        1,
        "rerender does not reassign/reload the native source",
      );
      emit("onLoad");
      emit("onLoad");
      assert.equal(loaded, 1);
      assert.deepEqual(transport.pending(), {
        active: 0,
        images: 0,
        queued: 0,
      });
    },
  );
});

test("unmounting a queued image prevents source assignment and allows a later mount", async () => {
  const transport = createPublicApiTransport({
    concurrency: 1,
    imageConcurrency: 1,
  });
  const releaseBlocker = await transport.imagePermit();
  await imageComponent(
    async ({ visible, render, commit, assignments, unmount }) => {
      visible(true);
      render({ src: source });
      commit();
      await turn();
      assert.deepEqual(transport.pending(), {
        active: 1,
        images: 1,
        queued: 1,
      });
      unmount();
      await turn();
      assert.equal(assignments.length, 0);
      assert.deepEqual(transport.pending(), {
        active: 1,
        images: 1,
        queued: 0,
      });
    },
    { transport },
  );
  releaseBlocker();
  await imageComponent(
    async ({ visible, render, commit, assignments, emit }) => {
      visible(true);
      render({ src: source });
      commit();
      await turn();
      assert.equal(assignments.length, 1);
      emit("onLoad");
    },
    { transport },
  );
  assert.deepEqual(transport.pending(), { active: 0, images: 0, queued: 0 });
});

test("active unmount removes the native source before returning its permit", async () => {
  await imageComponent(
    async ({
      visible,
      render,
      commit,
      removals,
      node,
      emit,
      unmount,
      transport,
    }) => {
      let callbacks = 0;
      visible(true);
      render({
        src: source,
        onLoad: () => callbacks++,
        onError: () => callbacks++,
      });
      commit();
      await turn();
      const old = node();
      unmount();
      assert.equal(old.src, undefined);
      assert.equal(removals.at(-1).before.active, 1);
      assert.deepEqual(transport.pending(), {
        active: 0,
        images: 0,
        queued: 0,
      });
      emit("onLoad", old);
      emit("onError", old);
      assert.equal(callbacks, 0);
    },
  );
});

test("source replacement ignores old events and cannot release the new image permit", async () => {
  await imageComponent(
    async ({ visible, render, commit, assignments, node, emit, transport }) => {
      let loaded = 0,
        failed = 0;
      const props = {
        src: source,
        onLoad: () => loaded++,
        onError: () => failed++,
      };
      visible(true);
      render(props);
      commit();
      await turn();
      const old = node();
      render({ ...props, src: source + "&next=1" });
      commit();
      await turn();
      assert.notEqual(node(), old);
      assert.equal(old.src, undefined);
      assert.equal(assignments.length, 2);
      emit("onError", old);
      emit("onLoad", old);
      assert.equal(failed, 0);
      assert.equal(loaded, 0);
      assert.deepEqual(transport.pending(), {
        active: 1,
        images: 1,
        queued: 0,
      });
      emit("onLoad");
      assert.equal(loaded, 1);
      assert.deepEqual(transport.pending(), {
        active: 0,
        images: 0,
        queued: 0,
      });
    },
  );
});

test("native decode errors release capacity and call fallback once without retry", async () => {
  await imageComponent(
    async ({ visible, render, commit, assignments, emit, transport }) => {
      const failures = [];
      const props = { src: source, onError: (event) => failures.push(event) };
      visible(true);
      render(props);
      commit();
      await turn();
      emit("onError");
      emit("onError");
      emit("onLoad");
      render({ ...props });
      commit();
      await turn();
      assert.equal(failures.length, 1);
      assert.ok(failures[0].currentTarget);
      assert.equal(assignments.length, 1);
      assert.deepEqual(transport.pending(), {
        active: 0,
        images: 0,
        queued: 0,
      });
    },
  );
});

test("unmount between admission and its continuation cannot assign an abandoned source", async () => {
  await imageComponent(
    async ({ visible, render, commit, assignments, unmount, transport }) => {
      visible(true);
      render({ src: source });
      commit();
      await Promise.resolve();
      assert.equal(transport.pending().active, 1);
      unmount();
      await turn();
      assert.equal(assignments.length, 0);
      assert.deepEqual(transport.pending(), {
        active: 0,
        images: 0,
        queued: 0,
      });
    },
  );
});

test("two native images of one URL retain independent element ownership", async () => {
  const transport = createPublicApiTransport();
  await imageComponent(
    async (first) => {
      first.visible(true);
      first.render({ src: source });
      first.commit();
      await turn();
      await imageComponent(
        async (second) => {
          second.visible(true);
          second.render({ src: source });
          second.commit();
          await turn();
          assert.deepEqual(transport.pending(), {
            active: 2,
            images: 2,
            queued: 0,
          });
          first.unmount();
          assert.equal(second.node().src, apiUrl(source));
          assert.deepEqual(transport.pending(), {
            active: 1,
            images: 1,
            queued: 0,
          });
          second.emit("onLoad");
        },
        { transport },
      );
    },
    { transport },
  );
  assert.deepEqual(transport.pending(), { active: 0, images: 0, queued: 0 });
});

test("a non-asset route cannot use native image admission", async () => {
  await imageComponent(
    async ({ visible, render, commit, admissions, assignments }) => {
      const failures = [];
      visible(true);
      render({
        src: "/api/read/player",
        onError: (error) => failures.push(error.message),
      });
      commit();
      await turn();
      assert.equal(admissions.length, 0);
      assert.equal(assignments.length, 0);
      assert.match(failures[0], /Route d’image/);
    },
  );
});

test("Media preserves its single alternate source and then shows initials", async () => {
  const props = {
    name: "Paris Club",
    url: "https://cdn.pitchapi.dev/first.webp",
    fallbackUrl: "https://cdn.pitchapi.dev/second.webp",
  };
  await imageComponent(
    async ({ render, commit }) => {
      const first = render(props).props.children[0];
      commit();
      first.props.onError({ currentTarget: {} });
      const alternate = render(props).props.children[0];
      commit();
      assert.ok(alternate.props.src.includes("second.webp"));
      alternate.props.onError({ currentTarget: {} });
      const unavailable = render(props).props.children[0];
      commit();
      assert.equal(unavailable.props.className, "image-fallback");
      assert.deepEqual(unavailable.props.children, ["PC"]);
    },
    { component: "Media" },
  );
});


test("Media keeps initials after deferral and resets for a new source", async () => {
  await imageComponent(async ({ render, commit, node }) => {
    const props = { name: "Paris Club", url: "https://cdn.pitchapi.dev/first.webp" };
    const oldImage = render(props).props.children[0];
    commit();
    node().dispatchEvent({ type: "vega:defer-image" });
    let fallback = render(props).props.children[0];
    commit();
    assert.equal(fallback.props.className, "image-fallback");
    oldImage.props.onLoad();
    oldImage.props.onError();
    fallback = render(props).props.children[0];
    commit();
    assert.deepEqual(fallback.props.children, ["PC"]);
    const replacement = render({ ...props, url: "https://cdn.pitchapi.dev/new.webp" }).props.children[0];
    commit();
    assert.ok(replacement.props.src.includes("new.webp"));
  }, { component: "Media" });
});

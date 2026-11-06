import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createResourceCache } from "../dashboard/frontend/src/services/resource-cache.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  requireLocal = createRequire(path.join(root, "dashboard/package.json")),
  babel = requireLocal("next/dist/compiled/babel/core"),
  commonjs = requireLocal(
    "next/dist/compiled/babel/plugin-transform-modules-commonjs",
  ),
  flush = () => new Promise((resolve) => setImmediate(resolve));

// Render and commit are separate so the tests can reproduce a route change
// before a queued loader runs, including a render that never commits.
async function withResourceHook(run) {
  const previousWindow = globalThis.window,
    previousDocument = globalThis.document,
    slots = [];
  let cursor = 0,
    pending = [],
    cache;
  const equal = (left, right) =>
    left?.length === right?.length &&
    left.every((value, index) => Object.is(value, right[index]));
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener() {},
    removeEventListener() {},
  };
  try {
    const filename = path.join(
        root,
        "dashboard/frontend/src/services/resources.js",
      ),
      code = babel.transformSync(await fs.readFile(filename, "utf8"), {
        plugins: [commonjs],
        babelrc: false,
        configFile: false,
        filename,
      }).code,
      mod = { exports: {} },
      stubs = {
        react: {
          useState(initial) {
            const index = cursor++,
              slot = (slots[index] ||= { value: initial });
            return [slot.value, (value) => (slot.value = value)];
          },
          useRef(initial) {
            const index = cursor++;
            return (slots[index] ||= { current: initial });
          },
          useEffect(effect, deps) {
            const index = cursor++;
            if (!equal(slots[index]?.deps, deps))
              pending.push({ index, effect, deps });
          },
          useCallback(callback, deps) {
            const index = cursor++;
            if (equal(slots[index]?.deps, deps)) return slots[index].callback;
            pending.push({ index, callback, deps });
            return callback;
          },
        },
        "../data-url.js": { apiUrl: (url) => url },
        "./resource-cache.js": {
          createResourceCache: () => (cache = createResourceCache()),
        },
      };
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
    await run({
      cache,
      render(key, loader) {
        cursor = 0;
        pending = [];
        return mod.exports.useResource(key, loader);
      },
      commit() {
        for (const change of pending) slots[change.index]?.cleanup?.();
        for (const change of pending) {
          slots[change.index] = {
            ...change,
            cleanup: change.effect?.(),
          };
        }
        pending = [];
      },
    });
  } finally {
    for (const slot of slots) slot?.cleanup?.();
    await flush();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
}

test("a route change cannot store its response under the previous shared key", async () => {
  await withResourceHook(async ({ cache, render, commit }) => {
    const requested = [],
      loader = (key) => () => {
        requested.push(key);
        return key;
      };
    render("A", loader("A"));
    commit();
    // Another mounted consumer still needs A while this component moves to B.
    const unsubscribeOther = cache.subscribe("A", () => {});
    render("B", loader("B"));
    commit();
    await flush();
    assert.deepEqual(requested, ["A", "B"]);
    assert.equal(cache.peek("A").value, "A");
    assert.equal(cache.peek("B").value, "B");
    unsubscribeOther();
  });
});

test("uncommitted renders cannot replace a committed key's refresh loader", async () => {
  await withResourceHook(async ({ cache, render, commit }) => {
    const first = render("A", () => "A1");
    commit();
    await flush();
    const latest = render("A", () => "A2");
    commit();
    assert.equal(latest.revalidate, first.revalidate);
    render("B", () => "B"); // This speculative route never commits.
    await first.revalidate();
    assert.equal(cache.peek("A").value, "A2");
    assert.equal(cache.peek("B"), undefined);
  });
});

test("a retained callback keeps its key after a different route commits", async () => {
  await withResourceHook(async ({ cache, render, commit }) => {
    const previous = render("A", () => "A");
    commit();
    await flush();
    const unsubscribeOther = cache.subscribe("A", () => {});
    render("B", () => "B");
    commit();
    await previous.revalidate();
    await flush();
    assert.equal(cache.peek("A").value, "A");
    assert.equal(cache.peek("B").value, "B");
    unsubscribeOther();
  });
});

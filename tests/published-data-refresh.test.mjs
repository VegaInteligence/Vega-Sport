import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as fixtures from "../dashboard/frontend/src/services/fixtures.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  requireLocal = createRequire(path.join(root, "dashboard/package.json")),
  babel = requireLocal("next/dist/compiled/babel/core"),
  commonjs = requireLocal(
    "next/dist/compiled/babel/plugin-transform-modules-commonjs",
  ),
  maxAge = 5 * 60_000;

async function withRefreshHook({ start, refresh, enabled = true }, run) {
  const previousWindow = globalThis.window,
    previousDocument = globalThis.document,
    previousNow = Date.now,
    timers = new Map(),
    windowEvents = new Map(),
    documentEvents = new Map(),
    refs = [];
  let now = Date.parse(start),
    nextTimer = 0,
    refIndex = 0,
    effects = [],
    cleanups = [],
    reloads = 0;
  const add = (events, type, callback) => {
    if (!events.has(type)) events.set(type, new Set());
    events.get(type).add(callback);
  };
  const remove = (events, type, callback) => events.get(type)?.delete(callback);
  const emit = (events, type) =>
    Promise.all([...(events.get(type) || [])].map((callback) => callback()));
  globalThis.window = {
    setTimeout(callback, delay) {
      assert.ok(delay > 0 && delay <= 60_000, `bounded delay: ${delay}`);
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (type, callback) => add(windowEvents, type, callback),
    removeEventListener: (type, callback) =>
      remove(windowEvents, type, callback),
    location: { reload: () => reloads++ },
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener: (type, callback) => add(documentEvents, type, callback),
    removeEventListener: (type, callback) =>
      remove(documentEvents, type, callback),
  };
  Date.now = () => now;
  try {
    const filename = path.join(
        root,
        "dashboard/frontend/src/hooks/usePublishedDataRefresh.js",
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
          useRef(initial) {
            const index = refIndex++;
            return (refs[index] ||= { current: initial });
          },
          useEffect: (effect) => effects.push(effect),
        },
        "../services/fixtures.js": fixtures,
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
    const mount = async (active) => {
      cleanups.forEach((cleanup) => cleanup?.());
      refIndex = 0;
      effects = [];
      mod.exports.default(refresh, active);
      cleanups = effects.map((effect) => effect());
      await Promise.resolve();
      await Promise.resolve();
    };
    await mount(enabled);
    await run({
      tick(elapsed) {
        now += elapsed;
        const due = [...timers].filter(([, timer]) => timer.at <= now);
        return Promise.all(
          due.map(([id, timer]) => {
            timers.delete(id);
            return timer.callback();
          }),
        );
      },
      elapse: (elapsed) => {
        now += elapsed;
      },
      focus: () => emit(windowEvents, "focus"),
      async visible(visible) {
        document.visibilityState = visible ? "visible" : "hidden";
        await emit(documentEvents, "visibilitychange");
      },
      mount,
      unmount() {
        cleanups.forEach((cleanup) => cleanup?.());
        cleanups = [];
      },
      timerCount: () => timers.size,
      nextDelay: () => Math.min(...[...timers.values()].map((t) => t.at - now)),
    });
    assert.equal(reloads, 0, "refreshes preserve the current page");
  } finally {
    cleanups.forEach((cleanup) => cleanup?.());
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    Date.now = previousNow;
  }
}

test("published data refreshes during the day, on stale focus and after a failure", async () => {
  let calls = 0,
    resolvePending;
  const refresh = () => {
    calls++;
    if (calls === 3)
      return new Promise((resolve) => {
        resolvePending = resolve;
      });
    if (calls === 5) return Promise.reject(new Error("Temporary outage"));
    return Promise.resolve();
  };
  await withRefreshHook(
    { start: "2026-11-06T12:00:00Z", refresh },
    async (clock) => {
      assert.equal(calls, 0, "initial manifest is already loaded");
      assert.equal(clock.timerCount(), 1);
      await clock.tick(maxAge - 1);
      assert.equal(calls, 0);
      await clock.tick(1);
      assert.equal(calls, 1, "new data does not wait until midnight");
      await clock.visible(false);
      await clock.tick(2 * maxAge);
      assert.equal(calls, 1, "hidden tabs do not poll");
      await clock.visible(true);
      assert.equal(calls, 2);
      await clock.focus();
      assert.equal(
        calls,
        2,
        "focus and visibility share the same freshness check",
      );
      const pending = clock.tick(maxAge);
      assert.equal(calls, 3);
      clock.elapse(maxAge);
      await clock.focus();
      assert.equal(calls, 3, "an in-flight refresh is not duplicated");
      resolvePending();
      await pending;
      await clock.tick(0);
      assert.equal(
        calls,
        3,
        "a slow request does not trigger a tight retry loop",
      );
      await clock.tick(60_000);
      assert.equal(calls, 4);
      await clock.tick(maxAge);
      assert.equal(calls, 5);
      await clock.tick(maxAge);
      assert.equal(calls, 6, "a rejected refresh can recover");
      clock.unmount();
      await clock.focus();
      await clock.visible(true);
      assert.equal(calls, 6);
      assert.equal(clock.timerCount(), 0);
    },
  );
});

test("focus between ticks preserves the exact five-minute deadline", async () => {
  let calls = 0;
  await withRefreshHook(
    {
      start: "2026-11-06T12:00:00Z",
      refresh: async () => {
        calls++;
      },
    },
    async (clock) => {
      await clock.tick(maxAge - 60_000);
      clock.elapse(40_000);
      await clock.focus();
      assert.equal(calls, 0);
      assert.equal(clock.nextDelay(), 20_000);
      await clock.tick(19_999);
      assert.equal(calls, 0);
      await clock.tick(1);
      assert.equal(calls, 1, "the next check is not shifted by a focus event");
      assert.equal(clock.timerCount(), 1);
    },
  );
});

test("a remount shares an in-flight request and leaves only one live timer", async () => {
  let calls = 0,
    resolvePending;
  await withRefreshHook(
    {
      start: "2026-11-06T12:00:00Z",
      refresh: () => {
        calls++;
        return calls === 1
          ? new Promise((resolve) => {
              resolvePending = resolve;
            })
          : Promise.resolve();
      },
    },
    async (clock) => {
      const pending = clock.tick(maxAge);
      assert.equal(calls, 1);
      await clock.mount(true);
      assert.equal(clock.timerCount(), 1);
      await clock.tick(2 * maxAge);
      assert.equal(calls, 1);
      assert.equal(clock.nextDelay(), 60_000);
      resolvePending();
      await pending;
      assert.equal(
        clock.timerCount(),
        1,
        "the old effect cannot rearm its timer",
      );
      await clock.tick(60_000);
      assert.equal(calls, 2);
      assert.equal(clock.timerCount(), 1);
      clock.unmount();
      assert.equal(clock.timerCount(), 0);
    },
  );
});

test("Paris midnight invalidates the period before the five-minute budget expires", async () => {
  for (const start of ["2026-03-29T21:59:30Z", "2026-10-25T22:59:30Z"]) {
    let calls = 0;
    await withRefreshHook(
      {
        start,
        refresh: async () => {
          calls++;
        },
      },
      async (clock) => {
        assert.equal(calls, 0);
        await clock.tick(60_000);
        assert.equal(calls, 1, start);
        await clock.tick(60_000);
        assert.equal(calls, 1);
      },
    );
  }
});

test("the subscription is inactive until a publication is available", async () => {
  let calls = 0;
  await withRefreshHook(
    {
      start: "2026-11-06T12:00:00Z",
      enabled: false,
      refresh: async () => {
        calls++;
      },
    },
    async (clock) => {
      assert.equal(clock.timerCount(), 0);
      await clock.tick(maxAge);
      await clock.focus();
      assert.equal(calls, 0);
      await clock.mount(true);
      assert.equal(clock.timerCount(), 1);
      assert.equal(calls, 1);
    },
  );
});

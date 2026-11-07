import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as catalog from "../dashboard/frontend/src/services/catalog-client.js";
import * as archive from "../dashboard/frontend/src/services/archive.js";
import * as format from "../dashboard/frontend/src/services/format.js";
import * as selector from "../dashboard/frontend/src/services/competition-selector.js";

const root = fileURLToPath(new URL("../", import.meta.url)),
  requireLocal = createRequire(path.join(root, "dashboard/package.json")),
  React = requireLocal("react"),
  { renderToStaticMarkup } = requireLocal("react-dom/server"),
  babel = requireLocal("next/dist/compiled/babel/core"),
  preset = requireLocal("next/dist/compiled/babel/preset-react"),
  commonjs = requireLocal(
    "next/dist/compiled/babel/plugin-transform-modules-commonjs",
  ),
  e = React.createElement,
  season = "2018/2019",
  version = "a".repeat(64);

function pageRecord() {
  return {
    data: {
      season,
      competitions: [
        {
          id: "bundesliga",
          name: "Bundesliga",
          country: "Allemagne",
          matches: 1000,
        },
        { id: "ligue-1", name: "Ligue 1", country: "France", matches: 900 },
      ],
      summary: { matches: 1900, withGoals: 1400, goals: 4000, competitions: 2 },
      matches: [
        {
          key: "match-51",
          date: "2018-09-01",
          competition: "Bundesliga",
          team1: "Bayern",
          team2: "Berlin",
          score: [2, 1],
          notes: [],
          hasGoals: true,
          goalCount: 3,
        },
        {
          key: "match-52",
          date: "2018-09-01",
          competition: "Bundesliga",
          team1: "Bremen",
          team2: "Mainz",
          score: [0, 0],
          notes: [],
          hasGoals: false,
          goalCount: 0,
        },
      ],
    },
    pagination: { page: 2, pages: 38, total: 1900, limit: 50, version },
    meta: { version },
  };
}

test("an archive read requests exactly one bounded page and forwards cancellation", async () => {
  const signal = new AbortController().signal,
    calls = [],
    expected = pageRecord();
  const actual = await catalog.archivePage(
    {
      season,
      page: 2,
      limit: 50,
      competition: "all",
      q: "Müller",
      version: undefined,
    },
    {
      signal,
      fetcher: async (path, options) => {
        calls.push(new URL(path, "https://test.local"));
        assert.equal(options.signal, signal);
        return Response.json(expected);
      },
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, "/api/read/archive");
  assert.deepEqual(Object.fromEntries(calls[0].searchParams), {
    competition: "all",
    limit: "50",
    page: "2",
    q: "Müller",
    season,
  });
  assert.deepEqual(actual, expected);
});

test("an archive publication conflict atomically replaces only the requested page", async () => {
  const calls = [],
    expected = pageRecord();
  expected.meta.version = "b".repeat(64);
  const actual = await catalog.archivePage(
    { season, page: 2, limit: 50, version },
    {
      fetcher: async (path) => {
        const url = new URL(path, "https://test.local");
        calls.push(url);
        return calls.length === 1
          ? new Response("changed", { status: 409 })
          : Response.json(expected);
      },
    },
  );
  assert.deepEqual(
    calls.map((url) => url.pathname),
    ["/api/read/archive", "/api/read/archive"],
  );
  assert.equal(calls[0].searchParams.get("version"), version);
  assert.equal(calls[1].searchParams.has("version"), false);
  assert.equal(calls[1].searchParams.get("page"), "2");
  assert.deepEqual(actual, expected);
});

test("a stale match key is never retried against a different archive publication", async () => {
  let calls = 0;
  await assert.rejects(
    catalog.archivePage(
      { season, match: "r:league:51", version },
      {
        fetcher: async () => {
          calls++;
          return new Response(null, { status: 409 });
        },
      },
    ),
    (error) => error.status === 409,
  );
  assert.equal(calls, 1);
});

test("archive errors never fall back to full seasons or retry an abandoned page", async () => {
  for (const status of [404, 503]) {
    let calls = 0;
    await assert.rejects(
      catalog.archivePage(
        { season, version },
        {
          fetcher: async () => {
            calls++;
            return new Response(null, { status });
          },
        },
      ),
      (error) => error.status === status,
    );
    assert.equal(calls, 1);
  }
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    catalog.archivePage(
      { season, version },
      {
        signal: controller.signal,
        fetcher: async () => {
          calls++;
          controller.abort();
          return new Response(null, { status: 409 });
        },
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
});

async function archiveFixture({ bounded = true, match = null, settled } = {}) {
  const requested = [],
    loaders = [],
    links = [],
    inputs = [],
    navigated = [],
    params = new URLSearchParams({ as: "2018-2019", ap: "2", aq: "Bayern" });
  if (match) params.set("m", match);
  let envelope = pageRecord(),
    legacyError = null;
  if (match) {
    envelope.data.match = {
      ...envelope.data.matches[0],
      goals: [
        {
          player: "Thomas Müller",
          minute: "23",
          team: "Bayern",
          score: [1, 0],
        },
      ],
    };
    envelope.data.matches = [];
    delete envelope.pagination;
  }
  const results = {
    season,
    competitions: [
      {
        id: "bundesliga",
        name: "Bundesliga",
        country: "Allemagne",
        matches: [
          {
            date: "2018-09-01",
            team1: "Bayern",
            team2: "Berlin",
            score: { ft: [2, 1] },
          },
        ],
      },
    ],
  };
  const UI = {
    Card: ({ children, title, action }) =>
      e("section", null, title, action, children),
    Empty: ({ children }) => e("p", null, children),
    AsyncState: ({ resource, children }) =>
      resource.loading
        ? e("p", null, "loading")
        : resource.error
          ? e("p", null, resource.error)
          : children(resource.value),
    Pager: ({ page, total, onChange }) => {
      inputs.push({ pager: true, page, total, onChange });
      return e(
        "nav",
        { "aria-label": `Page ${page} sur ${total}` },
        `${page} / ${total}`,
      );
    },
  };
  const stubs = {
    react: {
      ...React,
      createElement(type, props, ...children) {
        if (type === "input") inputs.push(props);
        return e(type, props, ...children);
      },
    },
    "next/link": {
      __esModule: true,
      default: ({ href, prefetch, children, ...props }) => {
        links.push({ href, prefetch });
        return e("a", { href, ...props }, children);
      },
    },
    "next/navigation": {
      usePathname: () => "/archives/",
      useSearchParams: () => params,
      useRouter: () => ({
        push: (...args) => navigated.push(args),
        replace: () => {
          throw new Error("Filters must not request a new RSC route");
        },
      }),
    },
    "../hooks/FootballContext.jsx": {
      useFootball: () => ({
        manifest: {
          publicationVersion: "42",
          capabilities: { boundedArchive: bounded },
        },
      }),
    },
    "../hooks/useDebouncedValue.js": {
      __esModule: true,
      default: (value) => settled ?? value,
    },
    "../services/catalog-client.js": {
      ...catalog,
      archiveIndex: async (kind, options) => {
        requested.push({ kind: "index", source: kind, options });
        return { seasons: [{ id: season }] };
      },
      archivePage: async (params, options) => {
        requested.push({ kind: "page", params, options });
        if (legacyError) throw legacyError;
        return envelope;
      },
      archiveSeason: async (kind, id, options) => {
        requested.push({ kind: "season", source: kind, id, options });
        return kind === "results" ? results : null;
      },
    },
    "../services/archive.js": archive,
    "../services/format.js": format,
    "../services/competition-selector.js": selector,
    "../services/resources.js": {
      useResource: (key, loader, enabled = true) => {
        loaders.push({ key, loader, enabled });
        return {
          value: key.startsWith("archive:indexes:")
            ? [{ id: season, results: true, goals: true }]
            : bounded
              ? envelope
              : archive.buildArchiveSeason(results, null),
        };
      },
    },
    "./UI.jsx": UI,
    "./CompetitionOptions.jsx": {
      __esModule: true,
      default: ({ competitions }) =>
        competitions.map((c) =>
          e("option", { key: c.id, value: c.id }, c.name),
        ),
    },
  };
  const filename = path.join(
      root,
      "dashboard/frontend/src/components/Archive.jsx",
    ),
    code = babel.transformSync(await fs.readFile(filename, "utf8"), {
      presets: [[preset, { runtime: "classic" }]],
      plugins: [commonjs],
      babelrc: false,
      configFile: false,
      filename,
    }).code,
    mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})", {
    filename,
  })(
    (name) => {
      if (!(name in stubs)) throw Error("Unexpected import " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  return {
    requested,
    loaders,
    links,
    inputs,
    params,
    render: () => renderToStaticMarkup(e(mod.exports.default)),
    respond: (value) => {
      envelope = value;
    },
    fail: (status) => {
      legacyError = Object.assign(new Error("not found"), { status });
    },
  };
}

test("archive page two uses exact server pagination and all-edition facets without another slice", async () => {
  const fixture = await archiveFixture(),
    html = fixture.render();
  assert.match(html, /data-archive-match="match-51"/);
  assert.match(html, /data-archive-match="match-52"/);
  assert.match(html, /Page 2 sur 38/);
  assert.match(html, /Ligue 1/);
  assert.equal((html.match(/archive-row-open/g) || []).length, 1);
  assert.equal(fixture.links.length, 1);
  assert.equal(fixture.links[0].prefetch, false);
  assert.match(fixture.links[0].href, new RegExp(`av=${version}`));
  const signal = new AbortController().signal;
  for (const { loader } of fixture.loaders) await loader({ signal });
  assert.deepEqual(
    fixture.requested.map(({ kind }) => kind),
    ["index", "index", "page"],
  );
  const read = fixture.requested.at(-1);
  assert.equal(read.params.page, 2);
  assert.equal(read.params.limit, 50);
  assert.equal(read.options.signal, signal);
});

test("an archived match requests only its goals and a 404 stays local to that detail", async () => {
  const fixture = await archiveFixture({ match: "match-51" }),
    html = fixture.render();
  assert.match(html, /Thomas Müller/);
  assert.doesNotMatch(html, /archive-results|Page 2 sur/);
  const detail = fixture.loaders.find(({ key }) =>
    key.startsWith("archive:read:"),
  );
  await detail.loader({ signal: new AbortController().signal });
  assert.deepEqual(fixture.requested[0].params, {
    season,
    match: "match-51",
    version: undefined,
  });
  fixture.fail(404);
  assert.deepEqual(await detail.loader({}), { data: { match: null } });
  assert.equal(
    fixture.requested.some(({ kind }) => kind === "season"),
    false,
  );
});

test("a changed archive detail shows a safe return to the unpinned list", async () => {
  const fixture = await archiveFixture({ match: "r:league:51" });
  fixture.params.set("av", version);
  fixture.render();
  fixture.fail(409);
  const value = await fixture.loaders
    .find(({ key }) => key.startsWith("archive:read:"))
    .loader({});
  assert.deepEqual(value, { data: { publicationChanged: true } });
  fixture.respond(value);
  fixture.links.length = 0;
  const html = fixture.render();
  assert.match(html, /Archives actualisées/);
  assert.doesNotMatch(html, /Thomas Müller|archive-goals/);
  assert.equal(fixture.links.length, 1);
  const back = new URL(fixture.links[0].href, "https://test.local")
    .searchParams;
  assert.equal(back.has("m"), false);
  assert.equal(back.has("av"), false);
});

test("full archive editions are fetched only for an older backend without the capability", async () => {
  const fixture = await archiveFixture({ bounded: false });
  fixture.render();
  for (const { loader } of fixture.loaders)
    await loader({ signal: new AbortController().signal });
  assert.deepEqual(
    fixture.requested.map(({ kind }) => kind),
    ["index", "index", "season", "season"],
  );
});

test("archive typing waits for the settled search and updates client history without an RSC request", async () => {
  const fixture = await archiveFixture({ settled: "Bay" }),
    html = fixture.render();
  assert.match(html, /aria-busy="true"/);
  assert.equal(
    fixture.loaders.find(({ key }) => key.startsWith("archive:read:")).enabled,
    false,
  );
  assert.equal(fixture.requested.length, 0);
  const settled = await archiveFixture();
  settled.render();
  const active = settled.loaders.find(({ key }) =>
    key.startsWith("archive:read:"),
  );
  assert.equal(active.enabled, true);
  await active.loader({});
  assert.equal(settled.requested[0].params.q, "Bayern");
  const previousWindow = globalThis.window,
    histories = [];
  globalThis.window = {
    history: { replaceState: (...args) => histories.push(args) },
  };
  try {
    fixture.inputs
      .find((input) => input.type === "search")
      .onChange({ target: { value: "Müller" } });
    const query = new URL(histories[0][2], "https://test.local").searchParams;
    assert.equal(query.get("aq"), "Müller");
    assert.equal(query.has("ap"), false);
    fixture.inputs.find((input) => input.pager).onChange(3);
    const next = new URL(histories[1][2], "https://test.local").searchParams;
    assert.equal(next.get("ap"), "3");
    assert.equal(next.get("av"), version);
  } finally {
    globalThis.window = previousWindow;
  }
});

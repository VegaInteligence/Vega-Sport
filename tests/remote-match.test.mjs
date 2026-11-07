import test from "node:test";
import assert from "node:assert/strict";
import { loadRemoteMatch } from "../dashboard/frontend/src/services/remote-match.js";
import { FootballDataClient } from "../dashboard/frontend/src/services/football-client.js";
import {
  matchResourceKey,
  validateMatchPublication,
} from "../dashboard/frontend/src/services/match-resources.js";

const fixture = { id: "m_000001", leagueId: "l_000001", season: "2026/2027" };
const familyKey = (family) => `${fixture.id}:${family}`;
const clientForDetails = (configured = true, manifest) => {
  const client = new FootballDataClient({
    data: { meta: {}, competitions: [], matches: [fixture] },
    manifest,
  });
  client.configured = configured;
  return client;
};
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
function pendingFetch(t) {
  const requests = [];
  t.mock.method(globalThis, "fetch", (url, { signal } = {}) => {
    return new Promise((resolve, reject) => {
      requests.push({ url: String(url), signal, resolve, reject });
      signal?.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  });
  return requests;
}

test("an archived fixture is used with its competition and season", async () => {
  let requested = false;
  const client = {
    normalizedRemote: (match) => match,
    request: () => {
      requested = true;
    },
  };
  const match = await loadRemoteMatch("m_123", client, async () => ({
    fixture: { id: "m_123" },
    competition_id: "l_123",
    competition_name: "Ligue",
    season: "2026/2027",
  }));
  assert.equal(match.league.id, "l_123");
  assert.equal(match.season, "2026/2027");
  assert.equal(requested, false);
});

test("a match absent from the archive falls back to PitchAPI", async () => {
  let route = "";
  const client = {
    normalizedRemote: (match) => ({ ...match, normalized: true }),
    request: async (path) => {
      route = path;
      return { data: { id: "m_123" } };
    },
  };
  const match = await loadRemoteMatch("m_123", client, async () => {
    throw new Error("HTTP 404");
  });
  assert.equal(route, "matches/m_123");
  assert.deepEqual(match, { id: "m_123", normalized: true });
});

test("a failed summary never starts a heavier archive/native request waterfall", async () => {
  for (const error of [
    Object.assign(new Error("unavailable"), { status: 503 }),
    new Error("HTTP 502"),
    new TypeError("Failed to fetch"),
  ]) {
    let reads = 0,
      native = 0;
    const client = {
      request: async () => {
        native++;
      },
      normalizedRemote: (match) => match,
    };
    await assert.rejects(
      loadRemoteMatch("m_123", client, async () => {
        reads++;
        throw error;
      }),
      (actual) => actual === error,
    );
    assert.equal(reads, 1);
    assert.equal(native, 0);
  }
});

test("a transient archive failure is surfaced after an unsupported summary", async () => {
  let reads = 0,
    native = 0;
  const error = Object.assign(new Error("archive timed out"), { status: 503 });
  await assert.rejects(
    loadRemoteMatch(
      "m_123",
      {
        request: async () => {
          native++;
        },
        normalizedRemote: (match) => match,
      },
      async () => {
        if (++reads === 1)
          throw Object.assign(new Error("not found"), { status: 404 });
        throw error;
      },
    ),
    (actual) => actual === error,
  );
  assert.equal(reads, 2);
  assert.equal(native, 0);
});

test("cancellation options reach every requested compatibility endpoint", async () => {
  const signal = new AbortController().signal;
  const seen = [];
  await loadRemoteMatch(
    "m_123",
    {
      normalizedRemote: (match) => match,
      request: async (path, options) => {
        seen.push([path, options.signal]);
        return { data: { id: "m_123" } };
      },
    },
    async (path, options) => {
      seen.push([path, options.signal]);
      throw Object.assign(new Error("not found"), { status: 404 });
    },
    { signal },
  );
  assert.equal(seen.length, 3);
  for (const [, observed] of seen) assert.equal(observed, signal);
});

test("aborting a summary never enters the compatibility fallback", async () => {
  const error = new DOMException("Aborted", "AbortError");
  let reads = 0;
  await assert.rejects(
    loadRemoteMatch(
      "m_123",
      { request: () => assert.fail("native request") },
      async () => {
        reads++;
        throw error;
      },
    ),
    (actual) => actual === error,
  );
  assert.equal(reads, 1);
});

test("temporary match-family failures never download the all-family archive", async (t) => {
  for (const failure of [500, 503, new TypeError("Failed to fetch")]) {
    const calls = [];
    const mock = t.mock.method(globalThis, "fetch", async (url) => {
      calls.push(String(url));
      if (failure instanceof Error) throw failure;
      return Response.json(
        { error: { code: "TEMPORARILY_UNAVAILABLE", message: "Try again" } },
        { status: failure },
      );
    });
    const client = clientForDetails();
    await client.ensureEndpoint(fixture, "shots");
    assert.deepEqual(calls, [`/api/pitchapi/matches/${fixture.id}/shots`]);
    assert.ok(client.payloads.get(familyKey("shots")).error);
    assert.equal(client.payloads.get(familyKey("shots")).source, undefined);
    mock.mock.restore();
  }
});

test("only absent legacy family endpoints fall back, including non-JSON errors", async (t) => {
  for (const status of [404, 405, 501]) {
    const calls = [];
    const mock = t.mock.method(globalThis, "fetch", async (url) => {
      calls.push(String(url));
      return calls.length === 1
        ? new Response("Unsupported endpoint", { status })
        : Response.json({
            endpoints: { lineups: { status: 200, data: null } },
          });
    });
    const client = clientForDetails();
    await client.ensureEndpoint(fixture, "lineups");
    assert.deepEqual(calls, [
      `/api/pitchapi/matches/${fixture.id}/lineups`,
      `/api/archive/matches/${fixture.id}`,
    ]);
    assert.equal(client.payloads.get(familyKey("lineups")).source, "snapshot");
    assert.equal(client.payloads.get(familyKey("lineups")).data, null);
    mock.mock.restore();
  }
});

test("authorization, version and rate-limit errors do not enter legacy fallback", async (t) => {
  for (const status of [400, 403, 409, 410, 413, 422, 429]) {
    const requests = [];
    const mock = t.mock.method(globalThis, "fetch", async (url) => {
      requests.push(url);
      return Response.json({ error: { message: "Unavailable" } }, { status });
    });
    const client = clientForDetails();
    await client.ensureEndpoint(fixture, "events");
    assert.equal(requests.length, status === 429 ? 3 : 1, String(status));
    assert.equal(
      new Set(requests).size,
      1,
      "bounded throttle retry never changes to an archive route",
    );
    assert.ok(requests.every((url) => url.includes("/events")));
    assert.ok(client.payloads.get(familyKey("events")).error);
    mock.mock.restore();
  }
});

test("one cancelled match-family reader does not cancel another reader", async (t) => {
  const requests = pendingFetch(t),
    client = clientForDetails();
  const first = new AbortController(),
    second = new AbortController();
  const abandoned = client.ensureEndpoint(fixture, "events", false, {
    signal: first.signal,
  });
  const remaining = client.ensureEndpoint(fixture, "events", false, {
    signal: second.signal,
  });
  await nextTurn();
  assert.equal(requests.length, 1);
  const rejected = assert.rejects(abandoned, { name: "AbortError" });
  first.abort();
  await rejected;
  assert.equal(requests[0].signal.aborted, false);
  const data = { events: [] };
  requests[0].resolve(Response.json({ data }));
  await remaining;
  assert.deepEqual(client.payloads.get(familyKey("events")), {
    data,
    source: "api",
  });
});

test("the last cancelled family reader aborts the fetch and a later visit retries", async (t) => {
  const requests = pendingFetch(t),
    client = clientForDetails();
  const first = new AbortController(),
    second = new AbortController();
  const a = client.ensureEndpoint(fixture, "shots", false, {
    signal: first.signal,
  });
  const b = client.ensureEndpoint(fixture, "shots", false, {
    signal: second.signal,
  });
  await nextTurn();
  const cancelled = Promise.all([
    assert.rejects(a, { name: "AbortError" }),
    assert.rejects(b, { name: "AbortError" }),
  ]);
  first.abort();
  second.abort();
  await cancelled;
  await nextTurn();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(client.payloads.has(familyKey("shots")), false);
  const retry = client.ensureEndpoint(fixture, "shots");
  await nextTurn();
  assert.equal(requests.length, 2);
  requests[1].resolve(Response.json({ data: { periods: [] } }));
  await retry;
  assert.equal(client.payloads.get(familyKey("shots")).source, "api");
});

test("two legacy families share an archive without transferring cancellation ownership", async (t) => {
  const requests = [];
  let archive;
  t.mock.method(globalThis, "fetch", async (url, { signal } = {}) => {
    requests.push(String(url));
    if (String(url).includes("/pitchapi/"))
      return Response.json({}, { status: 404 });
    return new Promise((resolve, reject) => {
      archive = { signal, resolve };
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  });
  const client = clientForDetails(),
    leaving = new AbortController();
  const lineups = client.ensureEndpoint(fixture, "lineups", false, {
    signal: leaving.signal,
  });
  const shots = client.ensureEndpoint(fixture, "shots");
  await nextTurn();
  assert.equal(requests.length, 3);
  const rejected = assert.rejects(lineups, { name: "AbortError" });
  leaving.abort();
  await rejected;
  await nextTurn();
  assert.equal(archive.signal.aborted, false);
  archive.resolve(
    Response.json({
      lineups: { data: null },
      shots: { data: { periods: [] } },
    }),
  );
  await shots;
  assert.equal(client.payloads.has(familyKey("lineups")), false);
  assert.equal(client.payloads.get(familyKey("shots")).source, "snapshot");
  await client.ensureEndpoint(fixture, "lineups");
  assert.equal(requests.length, 4, "the completed shared archive is reused");
  assert.equal(client.payloads.get(familyKey("lineups")).data, null);
});

test("leaving a legacy archive read cancels it and does not cache cancellation", async (t) => {
  const requests = pendingFetch(t),
    client = clientForDetails(false);
  const controller = new AbortController();
  const reading = client.ensureEndpoint(fixture, "lineups", false, {
    signal: controller.signal,
  });
  await nextTurn();
  assert.equal(requests[0].url, `/api/archive/matches/${fixture.id}`);
  const rejected = assert.rejects(reading, { name: "AbortError" });
  controller.abort();
  await rejected;
  await nextTurn();
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(client.payloads.has(familyKey("lineups")), false);
  const retry = client.ensureEndpoint(fixture, "lineups");
  await nextTurn();
  assert.equal(requests.length, 2);
  requests[1].resolve(Response.json({ lineups: { data: null } }));
  await retry;
  assert.equal(client.payloads.get(familyKey("lineups")).source, "snapshot");
});

test("cancellation while status is pending starts no family or archive request", async (t) => {
  const requests = pendingFetch(t),
    client = clientForDetails();
  let release;
  client.statusPromise = new Promise((resolve) => {
    release = resolve;
  });
  const controller = new AbortController();
  const reading = client.ensureEndpoint(fixture, "stats", false, {
    signal: controller.signal,
  });
  await nextTurn();
  const rejected = assert.rejects(reading, { name: "AbortError" });
  controller.abort();
  await rejected;
  await nextTurn();
  assert.equal(client.payloads.has(familyKey("stats")), false);
  release();
  await nextTurn();
  assert.equal(requests.length, 0);
  const retry = client.ensureEndpoint(fixture, "stats");
  await nextTurn();
  requests[0].resolve(Response.json({ data: null }));
  await retry;
  assert.equal(client.payloads.get(familyKey("stats")).data, null);
});

test("a transport completing after cancellation cannot overwrite the retried family", async (t) => {
  const pending = [];
  t.mock.method(
    globalThis,
    "fetch",
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const client = clientForDetails(),
    controller = new AbortController();
  const abandoned = client.ensureEndpoint(fixture, "events", false, {
    signal: controller.signal,
  });
  await nextTurn();
  const rejected = assert.rejects(abandoned, { name: "AbortError" });
  controller.abort();
  await rejected;
  const retry = client.ensureEndpoint(fixture, "events");
  await nextTurn();
  pending[0](Response.json({ data: { events: ["old"] } }));
  await nextTurn();
  assert.equal(client.payloads.get(familyKey("events")).loading, true);
  pending[1](Response.json({ data: { events: ["new"] } }));
  await retry;
  assert.deepEqual(client.payloads.get(familyKey("events")).data.events, [
    "new",
  ]);
});

test("an aborted forced refresh retains the last valid family value", async (t) => {
  const requests = pendingFetch(t),
    client = clientForDetails();
  const initial = client.ensureEndpoint(fixture, "shots");
  await nextTurn();
  requests[0].resolve(Response.json({ data: { periods: [] } }));
  await initial;
  const previous = client.payloads.get(familyKey("shots"));
  const controller = new AbortController();
  const refresh = client.ensureEndpoint(fixture, "shots", true, {
    signal: controller.signal,
  });
  await nextTurn();
  const rejected = assert.rejects(refresh, { name: "AbortError" });
  controller.abort();
  await rejected;
  await nextTurn();
  assert.equal(client.payloads.get(familyKey("shots")), previous);
  await client.ensureEndpoint(fixture, "shots");
  assert.equal(requests.length, 2);
});

test("a failed compatibility archive can be explicitly retried", async (t) => {
  let archives = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/pitchapi/"))
      return Response.json({}, { status: 405 });
    return ++archives === 1
      ? Response.json({}, { status: 503 })
      : Response.json({ lineups: { data: null } });
  });
  const client = clientForDetails();
  await client.ensureEndpoint(fixture, "lineups");
  assert.match(client.payloads.get(familyKey("lineups")).error, /HTTP 503/);
  await client.ensureEndpoint(fixture, "lineups", true);
  assert.equal(archives, 2);
  assert.equal(client.payloads.get(familyKey("lineups")).source, "snapshot");
});

test("a relational manifest still attempts the native family after a failed status check", async (t) => {
  for (const failure of [503, new TypeError("Failed to fetch")]) {
    const calls = [];
    const mock = t.mock.method(globalThis, "fetch", async (url) => {
      calls.push(String(url));
      if (failure instanceof Error) throw failure;
      return Response.json(
        { error: { message: "Unavailable" } },
        { status: failure },
      );
    });
    const client = clientForDetails(false, {
      storage: "aws-relational",
      publicationVersion: "42",
    });
    await client.ensureEndpoint(fixture, "events");
    assert.deepEqual(calls, [`/api/pitchapi/matches/${fixture.id}/events`]);
    assert.ok(client.payloads.get(familyKey("events")).error);
    mock.mock.restore();
  }
});

test("published family responses hydrate a new route client without another request", async (t) => {
  let reads = 0;
  t.mock.method(globalThis, "fetch", async () => {
    reads++;
    return Response.json({ data: { events: [reads] } });
  });
  const manifest = { storage: "aws-relational", publicationVersion: "42" };
  const first = clientForDetails(true, manifest);
  await first.ensureEndpoint(fixture, "events");
  const returned = clientForDetails(true, { ...manifest });
  assert.notEqual(first.id, returned.id);
  assert.equal(returned.payloads.size, 0);
  await returned.ensureEndpoint(fixture, "events");
  assert.equal(reads, 1);
  assert.deepEqual(
    returned.payloads.get(familyKey("events")),
    first.payloads.get(familyKey("events")),
  );
  const republished = clientForDetails(true, {
    ...manifest,
    publicationVersion: "43",
  });
  await republished.ensureEndpoint(fixture, "events");
  assert.equal(reads, 2);
  assert.deepEqual(
    republished.payloads.get(familyKey("events")).data.events,
    [2],
  );
  assert.deepEqual(first.payloads.get(familyKey("events")).data.events, [1]);
});

test("cross-client subscribers share the publication read and cancel independently", async (t) => {
  const requests = pendingFetch(t);
  const manifest = { storage: "aws-relational", publicationVersion: "42" };
  const first = clientForDetails(true, manifest),
    second = clientForDetails(true, { ...manifest });
  const controller = new AbortController();
  const leaving = first.ensureEndpoint(fixture, "lineups", false, {
    signal: controller.signal,
  });
  const remaining = second.ensureEndpoint(fixture, "lineups");
  await nextTurn();
  assert.equal(requests.length, 1);
  const rejected = assert.rejects(leaving, { name: "AbortError" });
  controller.abort();
  await rejected;
  await nextTurn();
  assert.equal(requests[0].signal.aborted, false);
  requests[0].resolve(Response.json({ data: null }));
  await remaining;
  assert.equal(first.payloads.has(familyKey("lineups")), false);
  assert.deepEqual(second.payloads.get(familyKey("lineups")), {
    data: null,
    source: "api",
  });
  await first.ensureEndpoint(fixture, "lineups");
  assert.equal(requests.length, 1);
  assert.deepEqual(
    first.payloads.get(familyKey("lineups")),
    second.payloads.get(familyKey("lineups")),
  );
});

test("failed shared reads and unknown publications cannot hydrate another client", async (t) => {
  let reads = 0;
  t.mock.method(globalThis, "fetch", async () => {
    reads++;
    return reads === 1
      ? Response.json({ error: { message: "Busy" } }, { status: 503 })
      : Response.json({ data: { events: [reads] } });
  });
  const manifest = { storage: "aws-relational", publicationVersion: "42" };
  await clientForDetails(true, manifest).ensureEndpoint(fixture, "events");
  const retry = clientForDetails(true, { ...manifest });
  await retry.ensureEndpoint(fixture, "events");
  assert.equal(reads, 2);
  assert.deepEqual(retry.payloads.get(familyKey("events")).data.events, [2]);
  await clientForDetails().ensureEndpoint(fixture, "events");
  await clientForDetails().ensureEndpoint(fixture, "events");
  assert.equal(reads, 4, "clients lacking a publication token stay isolated");
});

test("match response ownership includes the actual fetcher", async (t) => {
  const manifest = { storage: "aws-relational", publicationVersion: "42" };
  const first = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ data: { events: ["A"] } }),
  );
  await clientForDetails(true, manifest).ensureEndpoint(fixture, "events");
  first.mock.restore();
  let reads = 0;
  t.mock.method(globalThis, "fetch", async () => {
    reads++;
    return Response.json({ data: { events: ["B"] } });
  });
  const second = clientForDetails(true, { ...manifest });
  await second.ensureEndpoint(fixture, "events");
  assert.equal(reads, 1);
  assert.deepEqual(second.payloads.get(familyKey("events")).data.events, ["B"]);
});

test("all match view identities follow publication rather than route client identity", () => {
  const manifest = { storage: "aws-relational", publicationVersion: "42" };
  for (const kind of [
    "summary",
    "section",
    "statistics",
    "shots-view",
    "timeline",
    "context",
    "standings",
  ]) {
    assert.equal(
      matchResourceKey(manifest, kind, fixture),
      matchResourceKey({ ...manifest }, kind, fixture),
    );
    assert.notEqual(
      matchResourceKey(manifest, kind, fixture),
      matchResourceKey(
        { ...manifest, publicationVersion: "43" },
        kind,
        fixture,
      ),
    );
  }
  assert.equal(
    matchResourceKey(undefined, "summary", fixture),
    matchResourceKey(undefined, "summary", fixture),
  );
  assert.throws(
    () => validateMatchPublication(undefined, fixture),
    /version du match/,
  );
  assert.notEqual(
    matchResourceKey({}, "summary", fixture),
    matchResourceKey({}, "summary", fixture),
  );
});

test("a live client's payload map cannot bypass the shared response lifetime", async (t) => {
  let now = 0,
    reads = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ data: { events: [++reads] } }),
  );
  const client = clientForDetails(true, {
    storage: "aws-relational",
    publicationVersion: "42",
  });
  await client.ensureEndpoint(fixture, "events");
  await client.ensureEndpoint(fixture, "events");
  assert.equal(reads, 1);
  now += 5 * 60_000 + 1;
  await client.ensureEndpoint(fixture, "events");
  assert.equal(reads, 2);
  assert.deepEqual(client.payloads.get(familyKey("events")).data.events, [2]);
});

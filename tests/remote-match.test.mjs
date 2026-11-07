import test from "node:test";
import assert from "node:assert/strict";
import { loadRemoteMatch } from "../dashboard/frontend/src/services/remote-match.js";

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

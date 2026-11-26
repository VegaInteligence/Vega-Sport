// The player page's reads started early are held by its navigation (FAILURE_MODES_OPTIMISATIONS.md GH129-j, written
// before the change): the page releases them when it leaves; a read no block holds is then cancelled (its request
// aborted, its slot freed), one a block holds goes on; the next player's reads are each asked once.
import test from "node:test";
import assert from "node:assert/strict";
import { playerRecordResource, prefetchPlayerPage } from "../dashboard/frontend/src/services/player-prefetch.js";
import { holdResource } from "../dashboard/frontend/src/services/resources.js";

const MANIFEST = { storage: "aws-relational", publicationVersion: "7", capabilities: { marketValues: true } };
const SEASON = "2025/2026";
const turn = () => new Promise((done) => setTimeout(done, 5));

// Every request stays pending until aborted (the API slow for everyone).
function pendingFetch(t) {
  const requests = [];
  t.mock.method(globalThis, "fetch", (url, { signal } = {}) =>
    new Promise((resolve, reject) => {
      requests.push({ url: String(url), signal, resolve });
      signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")), { once: true });
    }));
  return requests;
}
const of = (requests, id) => requests.filter((r) => r.url.includes(id));
const path = (r) => new URL(r.url, "https://api.test").pathname;

test("GH129-j A's reads released with A's page, a block's read goes on, B's each asked once", async (t) => {
  const requests = pendingFetch(t);
  const leaveA = prefetchPlayerPage({ manifest: MANIFEST, season: SEASON }, "p_aaaab1");
  assert.equal(typeof leaveA, "function", "the page holds what it started, and lets it go");
  await turn();
  const a = of(requests, "p_aaaab1");
  assert.ok(a.length >= 5, a.map((r) => r.url).join(" "));
  // A block of A's page holds the record when the page leaves (a second consumer).
  const block = holdResource(...playerRecordResource("p_aaaab1"));
  leaveA();
  await turn();
  const record = a.find((r) => /\/players\/p_aaaab1$/.test(path(r)));
  assert.ok(record, a.map((r) => r.url).join(" "));
  assert.equal(record.signal.aborted, false, "the block's read goes on");
  for (const r of a) if (r !== record) assert.equal(r.signal.aborted, true, `${r.url}: cancelled with A's page`);
  block();
  await turn();
  assert.equal(record.signal.aborted, true, "the last holder gone, the read is cancelled");

  // B: started once, even when two holders ask (a remount).
  const leaveB = prefetchPlayerPage({ manifest: MANIFEST, season: SEASON }, "p_aaaab4");
  const again = prefetchPlayerPage({ manifest: MANIFEST, season: SEASON }, "p_aaaab4");
  await turn();
  const b = of(requests, "p_aaaab4");
  assert.ok(b.length >= 5, b.map((r) => r.url).join(" "));
  assert.equal(new Set(b.map((r) => r.url)).size, b.length, "each of B's reads asked once");
  leaveB();
  await turn();
  assert.ok(b.every((r) => !r.signal.aborted), "another holder of B's reads is left");
  again();
  await turn();
  assert.ok(b.every((r) => r.signal.aborted), "B's reads cancelled once both leave");
});

import test from "node:test";
import assert from "node:assert/strict";
import { loadRemoteMatch } from "../dashboard/frontend/src/services/remote-match.js";

test("an archived fixture is used with its competition and season", async () => {
  let requested = false;
  const client = { normalizedRemote: (match) => match, request: () => { requested = true; } };
  const match = await loadRemoteMatch("m_123", client, async () => ({ fixture: { id: "m_123" }, competition_id: "l_123", competition_name: "Ligue", season: "2026/2027" }));
  assert.equal(match.league.id, "l_123");
  assert.equal(match.season, "2026/2027");
  assert.equal(requested, false);
});

test("a match absent from the archive falls back to PitchAPI", async () => {
  let route = "";
  const client = { normalizedRemote: (match) => ({ ...match, normalized: true }), request: async (path) => { route = path; return { data: { id: "m_123" } }; } };
  const match = await loadRemoteMatch("m_123", client, async () => { throw new Error("HTTP 404"); });
  assert.equal(route, "matches/m_123");
  assert.deepEqual(match, { id: "m_123", normalized: true });
});

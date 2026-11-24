/**
 * Neon's API, for the one thing Vega asks of it: deleting a user of the auth branch when the
 * person deletes their account. `DELETE /projects/{project}/branches/{branch}/auth/users/{id}`
 * with a Neon API key (Neon's documentation, read on 23 Nov 2026; not yet called for real).
 * Failure modes: FAILURE_MODES.md, X3, X5, X6.
 */
import { withTimeout } from "./session.mjs";

const BASE = "https://console.neon.tech/api/v2";
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `deleteUser(id)` gives `{ ok: true, status }` (2xx, or 404: already gone) or
 * `{ ok: false, status, retry }` (status 0: no answer). `retry` is true when asking again can
 * help: no answer, 423 (locked), 429, 5xx.
 */
export function createNeonUsers({ apiKey, projectId, branchId, fetch = globalThis.fetch, timeoutMs = 5000 }) {
  if (typeof apiKey !== "string" || !apiKey) throw new Error("Neon API key required");
  if (!NAME.test(projectId ?? "") || !NAME.test(branchId ?? "")) throw new Error("invalid Neon project or branch id");
  return {
    async deleteUser(id) {
      if (typeof id !== "string" || !NAME.test(id)) throw new Error("invalid user id");
      const url = `${BASE}/projects/${projectId}/branches/${branchId}/auth/users/${encodeURIComponent(id)}`;
      let status;
      try {
        status = await withTimeout(timeoutMs, async (signal) => {
          const response = await fetch(url, { method: "DELETE", headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" }, redirect: "error", signal });
          await response.arrayBuffer().catch(() => {});
          return response.status;
        });
      } catch {
        return { ok: false, status: 0, retry: true };
      }
      if ((status >= 200 && status < 300) || status === 404) return { ok: true, status };
      return { ok: false, status, retry: status === 423 || status === 429 || status >= 500 };
    },
  };
}

/** The client from the environment, or null when the key, the project or the branch is missing. */
export function neonFromEnv(env, { fetch } = {}) {
  const apiKey = env.VEGA_NEON_API_KEY,
    projectId = env.VEGA_NEON_PROJECT_ID,
    branchId = env.VEGA_NEON_BRANCH_ID;
  if (!apiKey || !projectId || !branchId) return null;
  return createNeonUsers({ apiKey, projectId, branchId, ...(fetch && { fetch }) });
}

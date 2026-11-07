import { summarizeDiscipline } from "../../../shared/player-discipline.js";

export { summarizeDiscipline };

export async function loadDiscipline(
  client,
  matches,
  id,
  concurrency = 3,
  { signal } = {},
) {
  let index = 0;
  const results = new Array(matches.length);
  async function worker() {
    while (index < matches.length) {
      signal?.throwIfAborted();
      const current = index++;
      const match = matches[current];
      try {
        await client.ensureEndpoint(match, "events");
        signal?.throwIfAborted();
        const value = client.payloads.get(`${match.id}:events`);
        // ensureEndpoint also returns when another view already started this request.
        const data = value?.loading
          ? (await client.request(`matches/${match.id}/events`)).data
          : value?.data;
        results[current] = Array.isArray(data?.events) ? data : null;
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
        results[current] = null;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, matches.length) }, worker),
  );
  signal?.throwIfAborted();
  return summarizeDiscipline(id, results);
}

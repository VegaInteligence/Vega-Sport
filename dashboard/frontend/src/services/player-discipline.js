import { summarizeDiscipline } from "../../../shared/player-discipline.js";

export { summarizeDiscipline };

async function matchEvents(client, match, signal) {
  await client.ensureEndpoint(match, "events", false, { signal });
  signal?.throwIfAborted();
  const value = client.payloads.get(`${match.id}:events`);
  // Another view may have started the request already.
  const data = value?.loading
    ? (await client.request(`matches/${match.id}/events`, { signal })).data
    : value?.data;
  return Array.isArray(data?.events) ? data : null;
}

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
        results[current] = await matchEvents(client, match, signal);
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

/** Per-match cards are present only when the event sheet is available. */
export async function loadDisciplineByMatch(
  client,
  matches,
  id,
  { signal } = {},
) {
  let index = 0;
  const result = new Map();
  const native = [
    ...new Map(
      matches
        .filter((match) => /^m_[A-Za-z0-9]{6}$/.test(match?.id || ""))
        .map((match) => [match.id, match]),
    ).values(),
  ];
  async function worker() {
    while (index < native.length) {
      signal?.throwIfAborted();
      const match = native[index++];
      try {
        const data = await matchEvents(client, match, signal);
        if (!data) continue;
        const { yellow, secondYellow, directRed } = summarizeDiscipline(id, [
          data,
        ]);
        result.set(match.id, { yellow, secondYellow, directRed });
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, native.length) }, worker));
  signal?.throwIfAborted();
  return result;
}

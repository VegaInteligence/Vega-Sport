export function summarizeDiscipline(id, results) {
  const totals = { yellow: 0, directRed: 0, secondYellow: 0 };
  for (const result of results) {
    if (!Array.isArray(result?.events)) continue;
    const events = result.events.filter((event) => event.player?.id === id);
    const seen = new Set();
    for (const event of events) {
      const kind = String(event.event_type || "").toLowerCase();
      if (!["yellowcard", "secondyellow", "redcard"].includes(kind)) continue;
      if (event.id) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
      }
      if (kind === "yellowcard") totals.yellow++;
      if (kind === "secondyellow") totals.secondYellow++;
      if (kind === "redcard") {
        const paired = events.some(
          (other) =>
            String(other.event_type || "").toLowerCase() === "secondyellow" &&
            event.minute != null &&
            other.minute === event.minute &&
            (other.minute_added ?? 0) === (event.minute_added ?? 0) &&
            other.period === event.period,
        );
        if (!paired) totals.directRed++;
      }
    }
  }
  return {
    ...totals,
    covered: results.filter((r) => Array.isArray(r?.events)).length,
    total: results.length,
  };
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

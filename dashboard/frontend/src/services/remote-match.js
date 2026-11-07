const unsupported = (error) =>
  [404, 405, 501].includes(
    error?.status ??
      Number(String(error?.message || "").match(/\bHTTP\s+(\d{3})\b/)?.[1]),
  );

/** Compatibility fallbacks apply to absent endpoints, not transient failures. */
export async function loadRemoteMatch(id, client, readArchive, options = {}) {
  if (client.pro) return client.summary(id, options);
  try {
    const summary = await readArchive(
      "/api/matches/" + encodeURIComponent(id) + "/summary",
      options,
    );
    if (summary?.data?.match) return summary.data.match;
  } catch (error) {
    if (!unsupported(error)) throw error;
    // Older services can still resolve the established compatibility routes.
  }
  let record;
  try {
    record = await readArchive(
      "/api/archive/matches/" + encodeURIComponent(id),
      options,
    );
  } catch (error) {
    if (!unsupported(error)) throw error;
    // Upcoming or non-archived matches can still be available from PitchAPI.
  }
  if (record?.fixture) {
    return client.normalizedRemote({
      ...record.fixture,
      league: record.fixture.league || {
        id: record.competition_id,
        name: record.competition_name,
      },
      season: record.fixture.season || record.season,
    });
  }
  return client.normalizedRemote(
    (await client.request("matches/" + encodeURIComponent(id), options)).data,
  );
}

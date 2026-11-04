/** Prefer the bounded summary, retaining established archive/API fallbacks. */
export async function loadRemoteMatch(id, client, readArchive) {
  if (client.pro) return client.summary(id);
  try {
    const summary = await readArchive(
      "/api/matches/" + encodeURIComponent(id) + "/summary",
    );
    if (summary?.data?.match) return summary.data.match;
  } catch {
    // Older services can still resolve the established compatibility routes.
  }
  let record;
  try {
    record = await readArchive(
      "/api/archive/matches/" + encodeURIComponent(id),
    );
  } catch {
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
    (await client.request("matches/" + encodeURIComponent(id))).data,
  );
}

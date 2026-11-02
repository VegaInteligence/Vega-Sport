/** Use the local archive when available, then fall back to PitchAPI. */
export async function loadRemoteMatch(id, client, readArchive) {
  let record;
  try {
    record = await readArchive("/api/archive/matches/" + encodeURIComponent(id));
  } catch {
    // Upcoming or non-archived matches can still be available from PitchAPI.
  }
  if (record?.fixture) {
    return client.normalizedRemote({
      ...record.fixture,
      league: record.fixture.league || { id: record.competition_id, name: record.competition_name },
      season: record.fixture.season || record.season,
    });
  }
  return client.normalizedRemote((await client.request("matches/" + encodeURIComponent(id))).data);
}

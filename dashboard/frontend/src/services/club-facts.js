import { dataUrl } from "../data-url.js";

async function readJson(url, fetcher) {
  try {
    const response = await fetcher(url);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** Independent requests start together; external facts supplement PitchAPI. */
export async function loadClubFacts(
  clubId,
  matches,
  fetcher = fetch,
  identity = {},
) {
  const finished = matches
    .filter(
      (m) =>
        m.status === "finished" &&
        (m.home?.id === clubId || m.away?.id === clubId),
    )
    .sort((a, b) =>
      (b.timeUtc || b.date || "").localeCompare(a.timeUtc || a.date || ""),
    );
  const latest = finished[0],
    home = finished.find((m) => m.home?.id === clubId);
  const [links, lineup, match] = await Promise.all([
    readJson(dataUrl("raw/rankings/club-links.json"), fetcher),
    latest
      ? readJson(
          `/api/pitchapi/matches/${encodeURIComponent(latest.id)}/lineups`,
          fetcher,
        )
      : null,
    home
      ? readJson(
          `/api/pitchapi/matches/${encodeURIComponent(home.id)}`,
          fetcher,
        )
      : null,
  ]);
  const uefa =
    links?.links?.[clubId]?.entityId?.match(/^uefa:(\d{1,12})$/)?.[1];
  const lookup = uefa
    ? `uefa=${uefa}`
    : identity.name && identity.country
      ? new URLSearchParams({
          name: identity.name,
          country: identity.country,
        }).toString()
      : null;
  const wiki = lookup
    ? await readJson(`/api/club-wikidata?${lookup}`, fetcher)
    : null;
  const side = latest?.home?.id === clubId ? "home" : "away";
  const lineupData = lineup?.data;
  const lineupTeam = lineupData?.[`${side}_team`];
  const observedCoach =
    lineupTeam?.id === clubId ? lineupData?.[side]?.coach?.name : null;
  const matchData = match?.data;
  const observedStadium =
    matchData?.home_team?.id === clubId && typeof matchData.stadium === "string"
      ? matchData.stadium
      : null;
  return {
    wiki: wiki?.available === false ? null : wiki,
    observedCoach: observedCoach
      ? { name: observedCoach, date: latest.date }
      : null,
    observedStadium: observedStadium
      ? { name: observedStadium, date: home.date }
      : null,
  };
}

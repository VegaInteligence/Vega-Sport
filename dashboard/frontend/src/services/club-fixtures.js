/** A club may be present in the fixture list without a detailed match yet. */
export function fixtureClub(fixtures, id, countries = {}, competitions = []) {
  if (!id) return null;
  for (const match of fixtures || []) {
    const team = [match.home_team, match.away_team].find(
      (item) => item?.id === id,
    );
    if (!team?.name) continue;
    const leagueId = match.league?.id || match.leagueId;
    const competition = competitions.find((item) => item.id === leagueId);
    return {
      ...team,
      imageUrl: team.imageUrl || team.image_url,
      country: countries[id] || competition?.country || "unknown",
      league: match.league?.name || competition?.name || "",
    };
  }
  return null;
}

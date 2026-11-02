import { countryLabel } from "./competition-selector.js";

/** Merge competition metadata by stable provider ID, never by display name. */
export function competitionIndex(...collections) {
  const index = new Map();
  for (const collection of collections) {
    for (const competition of collection || []) {
      if (!competition?.id) continue;
      const previous = index.get(competition.id) || {};
      index.set(competition.id, {
        id: competition.id,
        name: competition.name || previous.name || "",
        country:
          competition.country ||
          competition.country_code ||
          competition.providerCountry ||
          previous.country ||
          "",
        imageUrl:
          competition.imageUrl ||
          competition.image_url ||
          previous.imageUrl ||
          "",
      });
    }
  }
  return index;
}

export function fixtureCompetition(fixture, index) {
  const league =
    fixture?.league && typeof fixture.league === "object" ? fixture.league : {};
  const info = index.get(league.id || fixture?.leagueId) || {};
  const country = info.country || league.country || league.country_code || "";
  return {
    id: league.id || fixture?.leagueId || "",
    name:
      league.name ||
      info.name ||
      (typeof fixture?.league === "string" ? fixture.league : "") ||
      "Compétition",
    country: country ? countryLabel(country) : "",
    imageUrl: league.image_url || league.imageUrl || info.imageUrl || "",
  };
}

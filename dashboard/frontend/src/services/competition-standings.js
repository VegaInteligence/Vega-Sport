// Preferred first divisions in the available PitchAPI catalogue.
export const COUNTRY_LEAGUES = {
  FR: "l_3FJFUl", GB: "l_4WFCIZ", DE: "l_1Isor4", ES: "l_0ErfuF",
  IT: "l_0ALvwF", PT: "l_4QexZg", NL: "l_4H43wr", BE: "l_2L6d1F",
  CH: "l_4d6Bwl", AT: "l_3zsMpo", TR: "l_0S1uaf", HR: "l_2tFk9k",
  CZ: "l_0F4I4F", DK: "l_49Zmno", FI: "l_3Ci5Cg", GR: "l_3xwVF2",
  IE: "l_1eJSA7", IS: "l_1TTHxD", IL: "l_16Sq13", LV: "l_45xKXM",
  NO: "l_0uqFK8", PL: "l_214sqK", RO: "l_0kSJLz", RU: "l_2Mh0jT",
  RS: "l_2xBPKk", SK: "l_4MU9Yh", SE: "l_1XsMdH",
};
// Provider country codes are not always ISO alpha-3 (for example ENG and NED).
const PROVIDER_COUNTRIES = { TH: "THA", AU: "AUS", US: "USA", BR: "BRA", AR: "ARG", JP: "JPN", KR: "KOR", MX: "MEX", CA: "CAN", CO: "COL", PE: "PER", QA: "QAT", AE: "UAE", SA: "KSA", ZA: "RSA", CL: "CHI", PY: "PAR", UY: "URU" };
export const DEFAULT_LEAGUE = COUNTRY_LEAGUES.FR;
export const PREFERRED_COMPETITION_KEY = "statarena.preferred-competition.v1";

// The result-derived table is suitable only for straightforward league phases.
// Cups and leagues with split/playoff phases require a dedicated standings source.
export const SIMPLE_LEAGUES = new Set([
  "l_3FJFUl", "l_0275VP", "l_4WFCIZ", "l_4DWyTT", "l_0ahLw8",
  "l_1W6idJ", "l_1Isor4", "l_3hvsne", "l_47077Y", "l_0ErfuF",
  "l_3kyHLd", "l_0ALvwF", "l_0jy5yE", "l_4QexZg", "l_4H43wr",
  "l_49KZaB", "l_0S1uaf", "l_1BFfna",
]);

export function localeCountry(languages = []) {
  for (const language of languages) {
    try {
      const region = new Intl.Locale(language).region;
      if (region && /^[A-Z]{2}$/.test(region)) return region;
    } catch {}
  }
  return null;
}

export function preferredCompetition(catalog, saved, country) {
  const available = new Set(catalog.map((competition) => competition.id));
  for (const id of [saved, COUNTRY_LEAGUES[country]]) {
    if (id && available.has(id)) return id;
  }
  const providerCountry = PROVIDER_COUNTRIES[country];
  const local = providerCountry ? catalog.filter((competition) => competition.country === providerCountry) : [];
  if (local.length) {
    const firstDivision = local.find((competition) => /(?:league|liga|division|ligue|série|serie)\s*(?:1|one|a)\b/i.test(competition.name || ""));
    return (firstDivision || local[0]).id;
  }
  if (available.has(DEFAULT_LEAGUE)) return DEFAULT_LEAGUE;
  return catalog.find((competition) => SIMPLE_LEAGUES.has(competition.id))?.id || catalog[0]?.id || null;
}

function validTeam(team) {
  return team && typeof team.id === "string" && team.id && typeof team.name === "string" && team.name;
}
function validScore(value) {
  return Number.isInteger(value) && value >= 0;
}

// No deductions, administrative decisions, head-to-head or playoff rules can be
// inferred from scores. Callers must label this as a result-derived table.
export function standingsFromFixtures(fixtures) {
  const matches = new Map();
  for (const fixture of fixtures || []) {
    if (!fixture?.id) continue;
    const previous = matches.get(fixture.id);
    if (!previous || (previous.status !== "finished" && fixture.status === "finished")) matches.set(fixture.id, fixture);
  }
  const teams = new Map(), pairCounts = new Map();
  let played = 0, excluded = 0, lastDate = null, complexSchedule = false;
  function teamRow(team) {
    if (!teams.has(team.id)) teams.set(team.id, { id: team.id, name: team.name, imageUrl: team.image_url || team.imageUrl || "", played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 });
    return teams.get(team.id);
  }
  for (const match of matches.values()) {
    const home = match.home_team, away = match.away_team;
    if (!validTeam(home) || !validTeam(away) || home.id === away.id) {
      if (match.status === "finished") excluded++;
      continue;
    }
    const pair = [home.id, away.id].sort().join("|");
    pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
    if (pairCounts.get(pair) > 2) complexSchedule = true;
    const h = teamRow(home), a = teamRow(away);
    if (match.status !== "finished") continue;
    if (!validScore(match.score_home) || !validScore(match.score_away)) { excluded++; continue; }
    const hs = match.score_home, as = match.score_away;
    h.played++; a.played++;
    h.goalsFor += hs; h.goalsAgainst += as;
    a.goalsFor += as; a.goalsAgainst += hs;
    if (hs > as) { h.wins++; a.losses++; h.points += 3; }
    else if (hs < as) { a.wins++; h.losses++; a.points += 3; }
    else { h.draws++; a.draws++; h.points++; a.points++; }
    played++;
    if (/^\d{4}-\d{2}-\d{2}$/.test(match.date || "") && (!lastDate || match.date > lastDate)) lastDate = match.date;
  }
  const rows = [...teams.values()].map((row) => ({ ...row, difference: row.goalsFor - row.goalsAgainst }));
  rows.sort((a, b) => b.points - a.points || b.difference - a.difference || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name, "fr"));
  return { rows, played, excluded, lastDate, complexSchedule };
}

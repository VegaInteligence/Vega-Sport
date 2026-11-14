// 2026/27 league-phase groups, as published by UEFA on 28 April 2026.
// https://editorial.uefa.com/resources/02a4-207fdf4b084e-a8a8727f0805-1000/unl_2627_-_league_phase_fixture_list_per_matchday_28_april_2026.pdf
export const NATIONS_OTHER_GROUPS = [
  ["B", 1, [["Scotland", "Écosse"], ["Switzerland", "Suisse"], ["Slovenia", "Slovénie"], ["North Macedonia", "Macédoine du Nord"]]],
  ["B", 2, [["Hungary", "Hongrie"], ["Ukraine", "Ukraine"], ["Georgia", "Géorgie"], ["Northern Ireland", "Irlande du Nord"]]],
  ["B", 3, [["Israel", "Israël"], ["Austria", "Autriche"], ["Republic of Ireland", "Irlande"], ["Kosovo", "Kosovo"]]],
  ["B", 4, [["Poland", "Pologne"], ["Bosnia and Herzegovina", "Bosnie-Herzégovine"], ["Romania", "Roumanie"], ["Sweden", "Suède"]]],
  ["C", 1, [["Albania", "Albanie"], ["Finland", "Finlande"], ["Belarus", "Biélorussie"], ["San Marino", "Saint-Marin"]]],
  ["C", 2, [["Montenegro", "Monténégro"], ["Armenia", "Arménie"], ["Cyprus", "Chypre"], ["Latvia", "Lettonie"]]],
  ["C", 3, [["Kazakhstan", "Kazakhstan"], ["Slovakia", "Slovaquie"], ["Faroe Islands", "Îles Féroé"], ["Moldova", "Moldavie"]]],
  ["C", 4, [["Iceland", "Islande"], ["Bulgaria", "Bulgarie"], ["Estonia", "Estonie"], ["Luxembourg", "Luxembourg"]]],
  ["D", 1, [["Gibraltar", "Gibraltar"], ["Malta", "Malte"], ["Andorra", "Andorre"]]],
  ["D", 2, [["Lithuania", "Lituanie"], ["Azerbaijan", "Azerbaïdjan"], ["Liechtenstein", "Liechtenstein"]]],
];
const MEMBERS = new Map(NATIONS_OTHER_GROUPS.flatMap(([league, group, teams]) => teams.map(([english, french]) => [english, { league, group, english, french }])));
function csvRow(line) {
  const fields = []; let value = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { fields.push(value); value = ""; }
    else value += char;
  }
  if (quoted) return null;
  fields.push(value);
  return fields;
}
/** Results from the CC0 international-results dataset; no fixtures are inferred. */
export function parseNationsResults(csv) {
  if (typeof csv !== "string" || csv.length > 12 * 1024 * 1024) throw new Error("Invalid results data");
  const lines = csv.split(/\r?\n/), header = csvRow(lines[0] || "");
  if (!header || header.slice(0, 6).join(",") !== "date,home_team,away_team,home_score,away_score,tournament") throw new Error("Invalid results header");
  const result = [], seen = new Set();
  for (const line of lines.slice(1)) {
    if (!line.startsWith("2026-")) continue;
    const row = csvRow(line);
    if (!row || row.length < 6 || row[5] !== "UEFA Nations League" || row[0] < "2026-09-01" || row[0] > "2026-11-30") continue;
    const home = MEMBERS.get(row[1]), away = MEMBERS.get(row[2]);
    if (!home || !away || home.league !== away.league || home.group !== away.group || !/^\d+$/.test(row[3]) || !/^\d+$/.test(row[4])) continue;
    const key = [row[0], home.english, away.english].join("|");
    if (seen.has(key)) throw new Error("Duplicate Nations League result");
    seen.add(key);
    result.push({ key: "nations:" + key, date: row[0], home: home.french, away: away.french, homeId: home.english, awayId: away.english, score: [Number(row[3]), Number(row[4])], status: "finished", league: home.league, group: home.group, round: "Groupe " + home.group });
  }
  return result;
}

// The national-team tournaments read from the same dataset, by its `tournament` column and
// the days each edition was played (its name is the year the confederation gives it: the
// Africa Cup of Nations 2023 was played in January and February 2024). Editions since the
// base's first season (2021/2022).
export const TOURNAMENT_EDITIONS = {
  afcon: { tournament: "African Cup of Nations", name: "Coupe d’Afrique des nations",
    seasons: { 2021: ["2022-01-01", "2022-02-28"], 2023: ["2024-01-01", "2024-02-29"], 2025: ["2025-12-01", "2026-01-31"] } },
  "copa-america": { tournament: "Copa América", name: "Copa América", seasons: { 2024: ["2024-06-01", "2024-07-31"] } },
  "asian-cup": { tournament: "AFC Asian Cup", name: "Coupe d’Asie des nations", seasons: { 2023: ["2024-01-01", "2024-02-29"] } },
  "gold-cup": { tournament: "Gold Cup", name: "Gold Cup", seasons: { 2023: ["2023-06-01", "2023-07-31"], 2025: ["2025-06-01", "2025-07-31"] } },
};

/** One edition of a national-team tournament from the CC0 dataset: its played matches,
 * home and away as the dataset writes them, with whether the ground was neutral. */
export function parseTournamentResults(csv, competition, season) {
  const edition = TOURNAMENT_EDITIONS[competition], days = edition?.seasons[season];
  if (!days) throw new Error("Unknown tournament edition");
  if (typeof csv !== "string" || csv.length > 12 * 1024 * 1024) throw new Error("Invalid results data");
  const lines = csv.split(/\r?\n/), header = csvRow(lines[0] || "");
  if (!header || header.slice(0, 9).join(",") !== "date,home_team,away_team,home_score,away_score,tournament,city,country,neutral") throw new Error("Invalid results header");
  const result = [], seen = new Set();
  for (const line of lines.slice(1)) {
    if (line.slice(0, 10) < days[0] || line.slice(0, 10) > days[1]) continue;
    const row = csvRow(line);
    if (!row || row.length < 9 || row[5] !== edition.tournament) continue;
    if (!/^\d+$/.test(row[3]) || !/^\d+$/.test(row[4])) continue;
    const key = [row[0], row[1], row[2]].join("|");
    if (seen.has(key)) throw new Error("Duplicate tournament result");
    seen.add(key);
    result.push({ key: `${competition}:${key}`, date: row[0], home: row[1], away: row[2], homeId: row[1], awayId: row[2],
      score: [Number(row[3]), Number(row[4])], status: "finished", neutral: row[8] === "TRUE" });
  }
  return result;
}

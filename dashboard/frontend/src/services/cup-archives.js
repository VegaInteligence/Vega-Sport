// Available CC0 archives with explicit cup rounds and scores.
export const NATIONAL_CUP_ARCHIVES = {
  "AUT_CUP_ofb-cup": { key: "austria-cup-archive", repo: "austria", path: "2024-25/cup.txt", season: "2024/2025", rounds: { "Round 1": "Round of 64", "Round 2": "Round of 32" } },
  "GER_CUP_dfb-pokal": { key: "germany-cup-archive", repo: "deutschland", path: "2024-25/cup.txt", season: "2024/2025", rounds: { "Round 1": "Round of 64", "Round 2": "Round of 32" } },
  "ENG_CUP_fa-cup": { key: "fa-cup-archive", repo: "england", path: "2024-25/facup.txt", season: "2024/2025", rounds: { "Round 3": "Round of 64", "Round 4": "Round of 32" } },
  "ENG_CUP_efl-cup": { key: "efl-cup-archive", twoLegged: true, repo: "england", path: "2024-25/eflcup.txt", season: "2024/2025", rounds: { "Round 3": "Round of 32" } },
  "ESP_CUP_copa-del-rey": { key: "copa-del-rey-archive", twoLegged: true, repo: "espana", path: "2024-25/cup.txt", season: "2024/2025", rounds: { "Round 3": "Round of 32" } },
  "ITA_CUP_coppa-italia": { key: "coppa-italia-archive", twoLegged: true, repo: "italy", path: "2024-25/cup.txt", season: "2024/2025", rounds: {} },
  "NED_CUP_knvb-beker": { key: "knvb-beker-archive", repo: "europe", path: "netherlands/2024-25_nlcup.txt", season: "2024/2025", rounds: { "Round 2": "Round of 32" } },
  "POR_CUP_taca-de-portugal": { key: "portugal-cup-archive", twoLegged: true, repo: "europe", path: "portugal/2024-25_ptcup.txt", season: "2024/2025", rounds: { "Round 4": "Round of 32" } },
  "SUI_CUP_swiss-cup": { key: "swiss-cup-archive", repo: "europe", path: "switzerland/2024-25_chcup.txt", season: "2024/2025", rounds: { "Round 1": "Round of 64", "Round 2": "Round of 32" } },
};
export const GERMAN_CUP_FOLDER = "GER_CUP_dfb-pokal";
export const GERMAN_CUP_SEASONS = ["2026/2027", "2025/2026"];

export function isGermanCupSeason(season) {
  const match = /^(\d{4})\/(\d{4})$/.exec(season || "");
  return Boolean(match && Number(match[1]) >= 2025 && Number(match[2]) === Number(match[1]) + 1);
}

import { COUNTRY_NAMES } from "./competition-selector.js";

const COUNTRY_ALIASES = { PRT: "POR" };
const GERMAN_ROUNDS = {
  "1. Runde": ["Round of 64", "Premier tour"],
  "2. Runde": ["Round of 32", "Seizièmes de finale"],
  Achtelfinale: ["Round of 16", "Huitièmes de finale"],
  Viertelfinale: ["Quarter-finals", "Quarts de finale"],
  Halbfinale: ["Semi-finals", "Demi-finales"],
  Endspiel: ["Final", "Finale"],
  Finale: ["Final", "Finale"],
};
const points = (item) => Number.isInteger(item?.pointsTeam1) && Number.isInteger(item?.pointsTeam2) && item.pointsTeam1 >= 0 && item.pointsTeam2 >= 0 ? [item.pointsTeam1, item.pointsTeam2] : null;
function namedTeam(team, nations) {
  const code = COUNTRY_ALIASES[team?.shortName] || team?.shortName;
  return { id: String(team?.teamId || ""), name: nations ? COUNTRY_NAMES[code] || team?.teamName || "" : team?.teamName || "" };
}
export function normalizeOpenLigaMatches(rows, competition) {
  if (!Array.isArray(rows) || rows.length > 300) throw new Error("Invalid OpenLigaDB data");
  return rows.flatMap((row) => {
    const home = namedTeam(row.team1, competition === "nations-league"), away = namedTeam(row.team2, competition === "nations-league");
    if (!row.matchID || !home.id || !away.id || !home.name || !away.name) return [];
    const finished = row.matchIsFinished === true, results = Array.isArray(row.matchResults) ? row.matchResults : [];
    const regulation = points(results.find((r) => r.resultTypeKind === "After90Minutes" || r.resultTypeID === 2));
    const extra = points(results.find((r) => r.resultTypeKind === "AfterExtraTime" || /verlängerung|nachspielzeit/i.test(r.resultName || "")));
    const penalties = points(results.find((r) => r.resultTypeKind === "AfterPenalties" || /elfmetersch/i.test(r.resultName || "")));
    const round = GERMAN_ROUNDS[row.group?.groupName] || ["", row.group?.groupName || ""];
    const group = Number(row.group?.groupOrderID);
    const notes = [];
    if (extra) notes.push("après prolongation");
    if (penalties) notes.push("tirs au but " + penalties[0] + " – " + penalties[1]);
    return [{ key: "openliga:" + row.matchID, date: String(row.matchDateTime || row.matchDateTimeUTC || "").slice(0, 10), home: home.name, away: away.name, homeId: home.id, awayId: away.id, score: finished ? extra || regulation : null, penalties: finished ? penalties : null, notes, status: finished ? "finished" : "scheduled", roundName: competition === "germany-cup" ? round[0] : "", round: competition === "germany-cup" ? round[1] : Number.isInteger(group) && group >= 1 && group <= 4 ? "Groupe " + group : "", group: competition === "nations-league" && Number.isInteger(group) && group >= 1 && group <= 4 ? group : null }];
  });
}

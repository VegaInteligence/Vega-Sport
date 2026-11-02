// Parse the published OpenFootball 2024/25 Coupe de France text without
// interpreting a penalty shootout as the match score.
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const MATCH = /^\s*(?:(\d{1,2}:\d{2})\s+)?(.+?)\s+v\s+(.+?)\s{2,}(\d+)\s*[-–]\s*(\d+)(?:\s+(pen\.))?\s*(?:\(([^)]*)\))?/i;
const DATE = /^\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:\s+(\d{4}))?/i;
const PAIR = /(\d+)\s*[-–]\s*(\d+)/g;

export function parseFranceCup(text) {
  if (typeof text !== "string") throw new Error("Invalid source");
  let currentDate = "", round = "", candidates = 0;
  const matches = [];
  for (const line of text.split(/\r?\n/)) {
    const roundLine = line.match(/^\s*▪\s*(.+?)\s*$/);
    if (roundLine) { round = roundLine[1]; continue; }
    const day = line.match(DATE);
    if (day) {
      const month = MONTHS[day[1][0].toUpperCase() + day[1].slice(1).toLowerCase()];
      const expectedYear = month >= 7 ? 2024 : 2025;
      const year = day[3] ? Number(day[3]) : expectedYear;
      if (year !== expectedYear) throw new Error("Unexpected season date");
      currentDate = year + "-" + String(month).padStart(2, "0") + "-" + day[2].padStart(2, "0");
      continue;
    }
    if (!/\s+v\s+/.test(line)) continue;
    candidates++;
    const row = line.match(MATCH);
    if (!row || !currentDate) throw new Error("Unrecognized match line");
    const sourceScore = [Number(row[4]), Number(row[5])];
    const otherScores = [...String(row[7] || "").matchAll(PAIR)].map((value) => [Number(value[1]), Number(value[2])]);
    const score = row[6] ? { ft: otherScores[0], p: sourceScore } : { ft: sourceScore };
    if (!score.ft) throw new Error("Missing match score before penalties");
    matches.push({ round, date: currentDate, team1: row[2].trim(), team2: row[3].trim(), score });
  }
  const declared = text.match(/#\s*Matches\s+(\d+)/i);
  if (!declared || matches.length !== candidates || matches.length !== Number(declared[1])) throw new Error("Incomplete source parsing");
  return matches;
}

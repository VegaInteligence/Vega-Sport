// Parse the OpenFootball cup archives without conflating shootouts with goals.
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const DATE = /^\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:\s+(\d{4}))?/i;
const MATCH = /^\s*(?:(\d{1,2}:\d{2})\s+)?(.+?)\s+v\s+(.+?)\s{2,}(\d+)\s*[-–]\s*(\d+)(.*)$/i;
const PAIR = /(\d+)\s*[-–]\s*(\d+)/;

export function parseOpenCupText(text, startYear, roundNames = {}) {
  if (typeof text !== "string" || !Number.isInteger(startYear)) throw new Error("Invalid cup archive");
  let day = "", round = "", candidates = 0;
  const matches = [];
  for (const line of text.split(/\r?\n/)) {
    const stage = line.match(/^\s*▪\s*(.+?)\s*$/);
    if (stage) { round = roundNames[stage[1]] || stage[1]; continue; }
    const foundDate = line.match(DATE);
    if (foundDate) {
      const month = MONTHS[foundDate[1][0].toUpperCase() + foundDate[1].slice(1).toLowerCase()];
      const year = foundDate[3] ? Number(foundDate[3]) : startYear + (month < 7 ? 1 : 0);
      if (year !== startYear && year !== startYear + 1) throw new Error("Unexpected cup date");
      day = year + "-" + String(month).padStart(2, "0") + "-" + foundDate[2].padStart(2, "0");
      continue;
    }
    if (!/\s+v\s+/.test(line)) continue;
    candidates++;
    const row = line.match(MATCH);
    if (!day) throw new Error("Unrecognized cup match");
    if (!row) {
      const pending = line.match(/^\s*(?:(\d{1,2}:\d{2})\s+)?(.+?)\s+v\s+(.+?)\s*$/i);
      if (!pending) throw new Error("Unrecognized cup match");
      matches.push({ round, date: day, team1: pending[2].trim(), team2: pending[3].trim() });
      continue;
    }
    const first = [Number(row[4]), Number(row[5])], tail = row[6] || "";
    let score;
    if (/^\s*pen\./i.test(tail)) {
      const afterPen = tail.replace(/^\s*pen\.\s*/i, "");
      const explicit = afterPen.match(/^\s*(\d+)\s*[-–]\s*(\d+)/);
      const inside = afterPen.match(/\(([^)]*)\)/)?.[1].match(PAIR);
      const actual = explicit || inside;
      if (!actual) throw new Error("Missing score before penalties");
      const goals = [Number(actual[1]), Number(actual[2])];
      score = { ft: goals, p: first };
      if (/a\.e\.t\./i.test(afterPen)) score.et = goals;
    } else {
      score = { ft: first };
      if (/a\.e\.t\./i.test(tail)) score.et = first;
    }
    matches.push({ round, date: day, team1: row[2].trim(), team2: row[3].trim(), score });
  }
  const declared = text.match(/#\s*Matches\s+(\d+)/i);
  if (!declared || matches.length !== candidates || matches.length !== Number(declared[1])) throw new Error("Incomplete cup archive");
  return matches;
}

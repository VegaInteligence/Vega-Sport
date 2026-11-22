// The Euros of 1960 to 2016 from openfootball/euro's text files (CC0): one file per edition, written in
// six layouts over the years (tests/openfootball-euro.test.mjs). 2020 and after are read from euro.json.

// Each edition's real number of matches (the 1968 final was replayed): a file read in part is refused.
export const EURO_HISTORY_MATCHES = {
  1960: 4, 1964: 4, 1968: 5, 1972: 4, 1976: 4, 1980: 14, 1984: 15, 1988: 15,
  1992: 15, 1996: 31, 2000: 31, 2004: 31, 2008: 31, 2012: 31, 2016: 51,
};
// The folder of each edition in openfootball/euro.
export const EURO_HISTORY_FOLDERS = {
  1960: "1960--france", 1964: "1964--spain", 1968: "1968--italy", 1972: "1972--belgium", 1976: "1976--yugoslavia",
  1980: "1980--italy", 1984: "1984--france", 1988: "1988--west-germany", 1992: "1992--sweden", 1996: "1996--england",
  2000: "2000--belgium-netherlands", 2004: "2004--portugal", 2008: "2008--austria-switzerland", 2012: "2012--poland-ukraine",
  2016: "2016--france",
};

// The group matches the files of 1984 and 1992 write without their day, dated from International Results
// (github.com/martj42/international_results, CC0), by the two teams whatever their order.
const UNDATED = {
  1984: {
    "Denmark|France": "06-12", "Belgium|Yugoslavia": "06-13", "Portugal|West Germany": "06-14", "Romania|Spain": "06-14",
    "Denmark|Yugoslavia": "06-16", "Belgium|France": "06-16", "Romania|West Germany": "06-17", "Portugal|Spain": "06-17",
    "Belgium|Denmark": "06-19", "France|Yugoslavia": "06-19", "Spain|West Germany": "06-20", "Portugal|Romania": "06-20",
  },
  1992: {
    "France|Sweden": "06-10", "Denmark|England": "06-11", "Netherlands|Scotland": "06-12", "CIS|Germany": "06-12",
    "England|France": "06-14", "Denmark|Sweden": "06-14", "CIS|Netherlands": "06-15", "Germany|Scotland": "06-15",
    "Denmark|France": "06-17", "England|Sweden": "06-17", "Germany|Netherlands": "06-18", "CIS|Scotland": "06-18",
  },
};
// The days a file writes wrongly, corrected from International Results: the 2016 file dates Group E's last two
// matches 21 June; they were played on 22 June.
const MISDATED = { 2016: { "Ireland|Italy": "06-22", "Belgium|Sweden": "06-22" } };
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DATE = /^(?:(?:Mo|Tu|We|Th|Fr|Sa|Su)[a-z]*\.?\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b(?:\s+(\d{4})\b)?/i;
const TIME = /(?:^|\s)\d{1,2}:\d{2}(?:\s*\(\d{1,2}:\d{2}\s*[A-Z]{2,5}\))?(?=\s|$)/g;
// The score and what follows it in the text: "4-2 pen. 0-0 a.e.t. (0-0)", "2-2 a.e.t., 5-3 pen.", "3-1 a.e.t.", "1-0".
const SCORE = /(?:^|\s)(?:(\d+)-(\d+)\s*pen\.?\s+)?(\d+)-(\d+)(\s*a\.e\.t\.)?(?:\s*\((\d+)-(\d+)\))?(?:\s*,\s*(\d+)-(\d+)\s*pen\.?)?(?=\s|$)/;
// What a file writes after the second team: "(aet, 4-2 pen)", "(aet/gg)", "(aet/sg)", "(9-8 pen)".
const AFTER = /\(\s*(?:(aet|a\.e\.t\.)(?:\/(?:gg|sg))?\s*(?:,\s*(\d+)-(\d+)\s*pen\.?)?|(\d+)-(\d+)\s*pen\.?)\s*\)/i;
const NAME = /^[A-Za-zÀ-ž][A-Za-zÀ-ž .'’-]{1,40}$/;

/** One edition's matches: {round, date, team1, team2, score[, group]}, in the file's order. */
export function parseEuroText(text, year, expected = EURO_HISTORY_MATCHES) {
  if (!Object.hasOwn(EURO_HISTORY_MATCHES, year)) throw new Error("Unknown Euro edition");
  if (typeof text !== "string" || text.length > 1024 * 1024) throw new Error("Invalid Euro archive");
  let round = "", day = "";
  const undated = UNDATED[year] || {}, misdated = MISDATED[year] || {};
  const matches = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/#.*$/, "").trim();
    if (!line || line.startsWith("=") || line.startsWith("(")) continue;
    const stage = line.match(/^▪\s*(.+)$/);
    if (stage) {
      // "▪ Matchday 1 | Jun 10 - Jun 14" lists days, not a round.
      if (!stage[1].includes("|")) round = stage[1].trim() === "Final, Replay" ? "Final" : stage[1].trim();
      continue;
    }
    const dated = line.match(DATE);
    if (dated) {
      if (dated[3] && Number(dated[3]) !== year) throw new Error("Unexpected Euro date");
      day = `${year}-${String(MONTHS[dated[1].slice(0, 3).toLowerCase()]).padStart(2, "0")}-${dated[2].padStart(2, "0")}`;
      line = line.slice(dated[0].length);
    }
    line = line.replace(TIME, " ").trim();
    // The venue: before the match, up to the wide gap that follows it, or after it, to the end.
    if (line.startsWith("@")) line = line.replace(/^@.*?(?:\s{2,}|$)/, "");
    line = line.replace(/\s@\s.*$/, "").trim();
    // Line-ups ("Netherlands: Schrijvers, …"), penalty sequences ("2-1 Nehoda, 2-2 Flohe", "Collovati (saved),
    // 9-8 Barmos"), group listings.
    if (!line || /^[^\d]*:/.test(line) || /^\d/.test(line) || line.includes("|") || /\((?:saved|over|missed|post|bar|wide)\)/i.test(line)) continue;
    const score = line.match(SCORE);
    if (!score) {
      if (/\sv\s/.test(line)) throw new Error("Unrecognized Euro match");
      continue;
    }
    const left = line.slice(0, score.index).trim();
    let right = line.slice(score.index + score[0].length).trim();
    const after = right.match(AFTER);
    if (after) right = (right.slice(0, after.index) + right.slice(after.index + after[0].length)).trim();
    const [team1, team2] = /\sv\s/.test(left) ? left.split(/\s+v\s+/) : [left, right];
    if (/\sv\s/.test(left) && right) throw new Error("Unrecognized Euro match");
    if (!NAME.test(team1 || "") || !NAME.test(team2 || "")) throw new Error("Unrecognized Euro team");
    const pair = [team1.trim(), team2.trim()].sort().join("|");
    const fixed = misdated[pair] || (!day && undated[pair]);
    const date = fixed ? `${year}-${fixed}` : day;
    if (!date) throw new Error("Euro match before any date");
    const goals = [Number(score[3]), Number(score[4])];
    const extra = Boolean(score[5]) || Boolean(after?.[1]);
    const out = {};
    if (score[6] != null) out.ft = [Number(score[6]), Number(score[7])];
    else if (!extra) out.ft = goals;
    if (extra) out.et = goals;
    const pens = score[1] != null ? [score[1], score[2]] : score[8] != null ? [score[8], score[9]] : after?.[2] != null ? [after[2], after[3]] : after?.[4] != null ? [after[4], after[5]] : null;
    if (pens) out.p = pens.map(Number);
    const row = { round, date, team1: team1.trim(), team2: team2.trim(), score: out };
    if (/^Group\b/.test(round)) row.group = round;
    matches.push(row);
  }
  if (matches.length !== expected[year]) throw new Error("Incomplete Euro archive");
  return matches;
}

/**
 * What a player's market value curve shows of his career: the club he joins at the date of
 * each transfer. Pure, without imports: the player page and the server-side report read it.
 */
const DAY = 86_400_000;
/** A return from loan followed by another move within these days was a transit. */
const TRANSIT_DAYS = 92;
const time = (date) => Date.parse(`${date}T00:00:00Z`);
const dated = (date) =>
  typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(time(date)) && new Date(time(date)).toISOString().slice(0, 10) === date;
/** The provider's mark of a dissolved club, at the end of its name: « Tours FC (- 2025) ». */
const DISSOLVED = /\s*\((?:\d{4}\s*)?-\s*\d{4}\)\s*$/;
/**
 * A youth or reserve side as the provider names it (« FC Barcelona U19 », « AS Monaco Youth »,
 * « FC Porto B »): the reader's RESERVE names (backend/vega/transfermarkt.py), a lone letter or
 * numeral counted at the name's end only (« B 93 » is a club).
 */
const YOUTH_SIDE = /(?:\s(?:b|c|ii|iii)$|\bu\s?-?(?:1[5-9]|2[0-3])\b|reserv|youth|juvenil|primavera|\bjong\b|academy)/i;
/** A club as it is shown: its name without the provider's mark. */
function labelled(club) {
  if (typeof club?.name !== "string") return null;
  const name = club.name.replace(DISSOLVED, "").trim();
  return name ? (name === club.name ? club : { ...club, name }) : null;
}
/** A club a player joins: one of our teams, or a provider's club that is no youth or reserve side. */
function joined(club) {
  const shown = labelled(club);
  return shown && (shown.id || !YOUTH_SIDE.test(shown.name)) ? shown : null;
}

/**
 * What the value curve draws (`curve`) and what the card lists under it (`list`).
 * `values`: the valuations by date; `transfers`: the route's rows, or null when not read.
 * An item: { key, date (the fact's), at (where it is drawn), club, kind, from, feeEur };
 * kind « estimate » is a valuation's club, not a transfer.
 */
export function careerMoves(values, transfers) {
  if (!values?.length) return { curve: [], list: [] };
  const first = values[0].date;
  if (!Array.isArray(transfers)) {
    const seen = [];
    let previous;
    for (const value of values) {
      const club = joined(value.club);
      const identity = club && (club.id || club.name);
      if (!identity || identity === previous) continue;
      previous = identity;
      seen.push({ key: `estimate:${value.date}`, date: value.date, at: value.date, club, kind: "estimate", from: null, feeEur: null });
    }
    return { curve: seen, list: seen };
  }
  // A row without a date has no place. A move inside a club counts when it brings him to a
  // club he was not shown at: the promotion to the first team.
  const moves = [];
  let current = null;
  for (const { row, index } of transfers
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => dated(row?.date))
    .sort((a, b) => a.row.date.localeCompare(b.row.date) || a.index - b.index)) {
    const club = joined(row.to);
    const identity = club && (club.id || club.name);
    if (row.kind === "internal" && (!club || identity === current)) continue;
    current = identity;
    moves.push({ key: `${row.date}:${index}`, date: row.date, at: row.date, club, kind: row.kind ?? null, from: labelled(row.from), feeEur: row.feeEur > 0 ? row.feeEur : null });
  }
  const drawn = moves.filter((move, i) => {
    const next = moves[i + 1];
    if (!move.club || move.date <= first) return false;
    if (next?.date === move.date) return false;
    return !(move.kind === "loan_return" && next && time(next.date) - time(move.date) <= TRANSIT_DAYS * DAY);
  });
  const before = moves.filter((move) => move.date <= first).at(-1);
  const own = joined(values[0].club);
  // The curve's first club: where his last move before it brought him, else the club the first
  // valuation itself names.
  const start = before?.club
    ? { ...before, at: first }
    : own && { key: "start", date: first, at: first, club: own, kind: "estimate", from: null, feeEur: null };
  return { curve: start ? [start, ...drawn] : drawn, list: moves.filter((move) => move.club) };
}

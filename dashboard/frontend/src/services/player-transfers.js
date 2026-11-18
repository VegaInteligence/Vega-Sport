/**
 * A player's transfers (/api/players/{id}/transfers) and what his market value curve shows
 * of them: the club he joins at the date of each transfer. A player whose transfers were
 * not read (HTTP 404) has none known (null); the clubs of his valuations then stand in.
 */
import { json } from "./resources.js";
import { marketDate, marketValue } from "./player-market-values.js";

export const playerTransfersKey = (id) => `player-transfers:${id}`;

const missing = (error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error));

export function loadPlayerTransfers(id, { signal } = {}) {
  return json(`/api/players/${encodeURIComponent(id)}/transfers`, { signal })
    .then((body) =>
      Array.isArray(body?.data?.transfers) ? body.data.transfers : Promise.reject(new Error("Transferts indisponibles.")),
    )
    .catch(missing);
}

const DAY = 86_400_000;
/** A return from loan followed by another move within these days was a transit. */
const TRANSIT_DAYS = 92;
const time = (date) => Date.parse(`${date}T00:00:00Z`);
const dated = (date) =>
  typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(time(date)) && new Date(time(date)).toISOString().slice(0, 10) === date;
const named = (club) => (typeof club?.name === "string" && club.name.trim() ? club : null);

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
      const club = named(value.club);
      const identity = club && (club.id || club.name);
      if (!identity || identity === previous) continue;
      previous = identity;
      seen.push({ key: `estimate:${value.date}`, date: value.date, at: value.date, club, kind: "estimate", from: null, feeEur: null });
    }
    return { curve: seen, list: seen };
  }
  // A move inside a club (youth, reserve side) is no arrival; a row without a date has no place.
  const moves = transfers
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => dated(row?.date) && row.kind !== "internal")
    .sort((a, b) => a.row.date.localeCompare(b.row.date) || a.index - b.index)
    .map(({ row, index }) => ({
      key: `${row.date}:${index}`, date: row.date, at: row.date, club: named(row.to), kind: row.kind ?? null,
      from: named(row.from), feeEur: row.feeEur > 0 ? row.feeEur : null,
    }));
  const drawn = moves.filter((move, i) => {
    const next = moves[i + 1];
    if (!move.club || move.date <= first) return false;
    if (next?.date === move.date) return false;
    return !(move.kind === "loan_return" && next && time(next.date) - time(move.date) <= TRANSIT_DAYS * DAY);
  });
  const list = moves.filter((move) => move.club);
  const before = list.filter((move) => move.date <= first).at(-1);
  const own = named(values[0].club);
  const start = before
    ? { ...before, at: first }
    : own && { key: "start", date: first, at: first, club: own, kind: "estimate", from: null, feeEur: null };
  return { curve: start ? [start, ...drawn] : drawn, list };
}

const KINDS = { transfer: "Transfert", free: "Transfert libre", loan: "Prêt", loan_return: "Retour de prêt", estimate: "Estimation" };
const NOTES = { free: "Libre", loan: "Prêt", loan_return: "Retour de prêt" };
const monthYear = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" });

/** The tip of an item: where he came from and went, the kind of move and its date, its fee. */
export function moveTip(move) {
  return {
    title: move.from ? `${move.from.name} → ${move.club.name}` : move.club.name,
    rows: [[KINDS[move.kind] || "Arrivée", marketDate(move.date)], ...(move.feeEur ? [["Montant", marketValue(move.feeEur)]] : [])],
  };
}

/** The line under a listed club's name: the month, then the fee or the kind of move. */
export function moveNote(move) {
  const detail = move.feeEur ? marketValue(move.feeEur) : NOTES[move.kind];
  return [monthYear.format(time(move.date)), detail].filter(Boolean).join(" · ");
}

/**
 * A player's transfers (/api/players/{id}/transfers), read for his market value curve, and
 * the words of each move drawn or listed there (the rules: career-moves.js). A player whose
 * transfers were not read (HTTP 404) has none known (null); the clubs of his valuations then
 * stand in.
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

const time = (date) => Date.parse(`${date}T00:00:00Z`);
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

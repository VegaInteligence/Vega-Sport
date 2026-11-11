import { json } from './resources.js';

export const playerMarketValuesKey = (id) => `player-market-values:${id}`;

/**
 * Whether the API serves a player's market values. The current one does not: every
 * player page asked for them and was answered 404, a read that held one of the page's
 * places while the comparison group waited for it (0.4 s on 11 November 2026).
 */
export const servesMarketValues = (manifest) =>
  manifest?.capabilities?.marketValues === true;
/** What the page holds without the read: what its 404 gave, an unavailable history. */
export const MARKET_VALUES_UNSERVED = Object.freeze({
  error: 'Historique de valeur indisponible.',
});

export async function loadPlayerMarketValues(id, { signal } = {}) {
  const body = await json(`/api/player-market-values?id=${encodeURIComponent(id)}`, { signal });
  const data = body?.data;
  if (data?.currency !== 'EUR' || data?.source !== 'Transfermarkt' || !Array.isArray(data.history))
    throw new Error('Historique de valeur indisponible.');
  const history = data.history.filter((row) =>
    /^\d{4}-\d{2}-\d{2}$/.test(row?.date || '') &&
    !Number.isNaN(Date.parse(`${row.date}T00:00:00Z`)) &&
    new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) === row.date &&
    typeof row.valueEur === 'number' && Number.isFinite(row.valueEur) && row.valueEur >= 0,
  ).sort((a, b) => a.date.localeCompare(b.date));
  return { ...data, history };
}

const euro = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
const millions = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });

export const marketValue = (value) =>
  value < 1_000_000 ? euro.format(value) : `${millions.format(value / 1_000_000)} M€`;

export const marketDate = (value) => {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
};

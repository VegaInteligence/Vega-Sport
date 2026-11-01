/** Pure, null-aware helpers shared by the views and regression tests. */
export const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const normalizeText = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
// Calendar-year competitions are grouped by their starting year in the UI;
// the original season remains unchanged on every source record.
export const seasonLabel = (value) => /^\d{4}$/.test(String(value ?? '')) ? `${value}/${Number(value)+1}` : String(value ?? '');
export const formatNumber = (value, digits = 0) => isNumber(value) ? new Intl.NumberFormat('fr-FR', {minimumFractionDigits:digits, maximumFractionDigits:digits}).format(value) : '—';
export const sumKnown = (values) => { const known = values.filter(isNumber); return known.length ? known.reduce((sum, value) => sum + value, 0) : null; };
export const meanKnown = (values) => { const known = values.filter(isNumber); return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null; };
export const per90 = (value, minutes) => isNumber(value) && isNumber(minutes) && minutes > 0 ? value * 90 / minutes : null;

export function filterAppearances(appearances, filters) {
  const search = normalizeText(filters.query).trim();
  const minutes = Number(filters.minutes) || 0;
  return appearances.filter((row) =>
    (!filters.match || filters.match === 'all' || row.matchId === filters.match) &&
    (filters.league === 'all' || row.leagueId === filters.league) &&
    (filters.season === 'all' || seasonLabel(row.season) === filters.season) &&
    (minutes === 0 || (isNumber(row.minutes) && row.minutes >= minutes)) &&
    (!search || normalizeText(`${row.name} ${row.team} ${row.league}`).includes(search))
  );
}

export function filterMatches(matches, appearances, filters) {
  const search = normalizeText(filters.query).trim();
  const playerMatches = new Set(search ? appearances.filter((row) => normalizeText(`${row.name} ${row.team} ${row.league}`).includes(search)).map((row) => row.matchId) : []);
  return matches.filter((match) =>
    (!filters.match || filters.match === 'all' || match.id === filters.match) &&
    (filters.league === 'all' || match.leagueId === filters.league) &&
    (filters.season === 'all' || seasonLabel(match.season) === filters.season) &&
    (!search || normalizeText(`${match.home.name} ${match.away.name} ${match.league}`).includes(search) || playerMatches.has(match.id))
  );
}

export function sortRows(rows, key, direction = 'desc', mode = 'total') {
  const value = (row) => mode === 'per90' && !['rating', 'minutes', 'name', 'team'].includes(key) ? per90(row[key], row.minutes) : row[key];
  return [...rows].sort((a, b) => {
    const av = value(a), bv = value(b);
    const aMissing = av === null || av === undefined || (typeof av === 'number' && !isNumber(av));
    const bMissing = bv === null || bv === undefined || (typeof bv === 'number' && !isNumber(bv));
    if (aMissing || bMissing) return aMissing === bMissing ? a.name.localeCompare(b.name, 'fr') : aMissing ? 1 : -1;
    const result = typeof av === 'string' ? av.localeCompare(bv, 'fr') : av - bv;
    return (direction === 'asc' ? result : -result) || a.name.localeCompare(b.name, 'fr');
  });
}

/** Export plain values. Text that spreadsheet programs may execute is escaped. */
export function csvString(headers, rows) {
  const cell = (value) => {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (typeof value === 'string' && /^[\s]*[=+@\-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return '\ufeff' + [headers, ...rows].map((row) => row.map(cell).join(';')).join('\r\n');
}

/** Pure, null-aware helpers shared by the views and regression tests. */
export const isNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);
export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export const normalizeText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr");
const collator = new Intl.Collator("fr");
/** Same order as `a.localeCompare(b, "fr")`, without building a collator per call. */
export const compareText = (a, b) => collator.compare(a, b);
// Search text is normalised once per distinct string and once per record:
// typing in the search box must not re-normalise ~170k rows per keystroke.
const normalizedParts = new Map();
function normalizedPart(value) {
  const text = String(value);
  let result = normalizedParts.get(text);
  if (result === undefined) {
    if (normalizedParts.size > 250000) normalizedParts.clear();
    result = normalizeText(text);
    normalizedParts.set(text, result);
  }
  return result;
}
const searchTexts = new WeakMap();
function searchText(record, parts) {
  let text = searchTexts.get(record);
  if (text === undefined) {
    text = parts(record).map(normalizedPart).join(" ");
    searchTexts.set(record, text);
  }
  return text;
}
const appearanceParts = (row) => [row.name, row.team, row.league];
const matchParts = (match) => [match.home.name, match.away.name, match.league];
// Calendar-year competitions are grouped by their starting year in the UI;
// the original season remains unchanged on every source record.
export const seasonLabel = (value) =>
  /^\d{4}$/.test(String(value ?? ""))
    ? `${value}/${Number(value) + 1}`
    : String(value ?? "");
const seasonLabels = new Map();
function cachedSeasonLabel(value) {
  let label = seasonLabels.get(value);
  if (label === undefined) {
    label = seasonLabel(value);
    seasonLabels.set(value, label);
  }
  return label;
}
// One formatter per precision: constructing Intl formatters is costly and
// tables and charts format thousands of values per render.
const numberFormats = new Map();
export const formatNumber = (value, digits = 0) => {
  if (!isNumber(value)) return "—";
  let format = numberFormats.get(digits);
  if (!format) {
    format = new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    numberFormats.set(digits, format);
  }
  return format.format(value);
};
export const sumKnown = (values) => {
  const known = values.filter(isNumber);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
};
export const meanKnown = (values) => {
  const known = values.filter(isNumber);
  return known.length
    ? known.reduce((sum, value) => sum + value, 0) / known.length
    : null;
};
export const per90 = (value, minutes) =>
  isNumber(value) && isNumber(minutes) && minutes > 0
    ? (value * 90) / minutes
    : null;

export function filterAppearances(appearances, filters) {
  const search = normalizeText(filters.query).trim();
  const minutes = Number(filters.minutes) || 0;
  return appearances.filter(
    (row) =>
      (!filters.match ||
        filters.match === "all" ||
        row.matchId === filters.match) &&
      (filters.league === "all" || row.leagueId === filters.league) &&
      (filters.season === "all" ||
        cachedSeasonLabel(row.season) === filters.season) &&
      (minutes === 0 || (isNumber(row.minutes) && row.minutes >= minutes)) &&
      (!search || searchText(row, appearanceParts).includes(search)),
  );
}

export function filterMatches(matches, appearances, filters) {
  const search = normalizeText(filters.query).trim();
  const playerMatches = new Set();
  if (search)
    for (const row of appearances)
      if (searchText(row, appearanceParts).includes(search))
        playerMatches.add(row.matchId);
  return matches.filter(
    (match) =>
      (!filters.match ||
        filters.match === "all" ||
        match.id === filters.match) &&
      (filters.league === "all" || match.leagueId === filters.league) &&
      (filters.season === "all" ||
        cachedSeasonLabel(match.season) === filters.season) &&
      (!search ||
        searchText(match, matchParts).includes(search) ||
        playerMatches.has(match.id)),
  );
}

// Distinct strings ranked once with the French collator, so sorting compares
// integers instead of calling the collator millions of times.
function rankStrings(values) {
  const sorted = [...values].sort(compareText),
    ranks = new Map();
  let rank = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i && compareText(sorted[i - 1], sorted[i]) !== 0) rank = i;
    ranks.set(sorted[i], rank);
  }
  return ranks;
}
let nameRanks = new Map();
function rankedNames(rows) {
  if (rows.some((row) => !nameRanks.has(row.name))) {
    const names = new Set(nameRanks.keys());
    for (const row of rows) names.add(row.name);
    nameRanks = rankStrings(names);
  }
  return nameRanks;
}
const isMissing = (value) =>
  value === null ||
  value === undefined ||
  (typeof value === "number" && !isNumber(value));

// Order of `rows` as an index list: by value (direction), missing values
// last, then by name, then by position. Every criterion is turned into an
// integer rank so the work is done by two native numeric sorts instead of a
// comparator called millions of times.
function sortedOrder(rows, key, direction, mode) {
  const per =
      mode === "per90" && !["rating", "minutes", "name", "team"].includes(key),
    n = rows.length,
    names = rankedNames(rows),
    values = new Float64Array(n),
    missing = new Uint8Array(n),
    texts = [];
  for (let i = 0; i < n; i++) {
    const row = rows[i],
      value = per ? per90(row[key], row.minutes) : row[key];
    if (isMissing(value)) missing[i] = 1;
    else if (typeof value === "string") texts.push(i);
    else values[i] = Number(value) + 0; // -0 sorts like 0
  }
  if (texts.length) {
    const ranks = rankStrings(new Set(texts.map((i) => rows[i][key])));
    for (const i of texts) values[i] = ranks.get(rows[i][key]);
  }
  // 1. Name, then position: rank × n + index is exact below 2^53.
  const byName = new Float64Array(n);
  for (let i = 0; i < n; i++) byName[i] = names.get(rows[i].name) * n + i;
  byName.sort();
  const tieRank = new Float64Array(n);
  for (let p = 0; p < n; p++) tieRank[byName[p] % n] = p;
  // 2. Dense rank of each value in the requested direction; missing last.
  const known = [];
  for (let i = 0; i < n; i++) if (!missing[i]) known.push(values[i]);
  const distinct = Float64Array.from(new Set(known)).sort(),
    last = distinct.length;
  const valueRank = (v) => {
    let lo = 0,
      hi = last - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (distinct[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return direction === "asc" ? lo : last - 1 - lo;
  };
  const keys = new Float64Array(n);
  for (let i = 0; i < n; i++)
    keys[i] = (missing[i] ? last : valueRank(values[i])) * n + tieRank[i];
  keys.sort();
  const order = new Array(n);
  for (let p = 0; p < n; p++) order[p] = byName[keys[p] % n] % n;
  return order;
}
// Sorting a filtered list reuses the order of the whole season, computed once
// per column: each filter or search then costs a lookup and a numeric sort.
const sourceOrders = new WeakMap();
function sourceRanks(source, signature, key, direction, mode) {
  let entry = sourceOrders.get(source);
  if (!entry) {
    entry = { position: new Map(source.map((row, i) => [row, i])), ranks: {} };
    sourceOrders.set(source, entry);
  }
  if (!entry.ranks[signature]) {
    const order = sortedOrder(source, key, direction, mode),
      ranks = new Uint32Array(source.length);
    for (let i = 0; i < order.length; i++) ranks[order[i]] = i;
    entry.ranks[signature] = { ranks, order };
  }
  return { position: entry.position, ...entry.ranks[signature] };
}
const sortedResults = new WeakMap();
/** Rows by `key`, missing values last, ties by name then original order.
 *  When `source` is given, `rows` must keep the order of `source` (a filter
 *  of it); the result is identical and much cheaper to recompute. */
export function sortRows(
  rows,
  key,
  direction = "desc",
  mode = "total",
  source = null,
) {
  const signature = `${key}|${direction}|${mode}`;
  const cached = sortedResults.get(rows)?.get(signature);
  if (cached) return cached;
  let result;
  if (source && rows.length > 500) {
    const { position, ranks, order } = sourceRanks(
        source,
        signature,
        key,
        direction,
        mode,
      ),
      picked = new Uint32Array(rows.length);
    let complete = true;
    for (let i = 0; i < rows.length; i++) {
      const at = position.get(rows[i]);
      if (at === undefined) {
        complete = false;
        break;
      }
      picked[i] = ranks[at];
    }
    if (complete) {
      picked.sort();
      result = Array.from(picked, (rank) => source[order[rank]]);
    }
  }
  if (!result)
    result = sortedOrder(rows, key, direction, mode).map((i) => rows[i]);
  if (!sortedResults.has(rows)) sortedResults.set(rows, new Map());
  sortedResults.get(rows).set(signature, result);
  return result;
}

/** First `count` rows of `sortRows(rows, key)` (descending), in linear time. */
export function topRows(rows, key, count) {
  const best = [];
  const better = (a, b) =>
    a[key] !== b[key] ? a[key] > b[key] : compareText(a.name, b.name) < 0;
  for (const row of rows) {
    if (isMissing(row[key])) continue;
    if (best.length === count && !better(row, best[count - 1])) continue;
    let at = best.length;
    while (at > 0 && better(row, best[at - 1])) at--;
    best.splice(at, 0, row);
    if (best.length > count) best.pop();
  }
  return best;
}

/** Export plain values. Text that spreadsheet programs may execute is escaped. */
export function csvString(headers, rows) {
  const cell = (value) => {
    if (value === null || value === undefined) return "";
    let text = String(value);
    if (typeof value === "string" && /^[\s]*[=+@\-]/.test(text))
      text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return (
    "\ufeff" +
    [headers, ...rows].map((row) => row.map(cell).join(";")).join("\r\n")
  );
}

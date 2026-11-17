/**
 * What the club page shows side by side stands on the same matches, and a season total on the
 * matches that support it (VI-22, from the VI-23 calculation audit).
 *
 * The service's own fields win when it gives them: VI-23's `pairedFields` (pairedMatches,
 * pairedActualPoints, …, pairedXgDeltaPerMatch) and `coverage` (matches behind each indicator).
 * Without them the same definitions are read on the club's match rows; once those fields reach
 * every club, the row fallbacks can go.
 */
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const add = (rows, get) => rows.reduce((total, row) => total + get(row), 0);

/** Points and xPts of the matches whose xPts is known; null without any. */
export function pairedPoints(club) {
  if (Number.isInteger(club?.pairedMatches))
    return {
      matches: club.pairedMatches,
      actual: club.pairedActualPoints ?? null,
      expected: club.pairedExpectedPoints ?? null,
      delta: club.pairedPointsDelta ?? null,
    };
  const rows = (club?.rows || []).filter((row) => finite(row.xpts));
  if (!rows.length)
    return { matches: 0, actual: null, expected: null, delta: null };
  const actual = add(rows, (row) => row.points),
    expected = add(rows, (row) => row.xpts);
  return { matches: rows.length, actual, expected, delta: actual - expected };
}

/** xG for and against on the matches that know both, their difference, per match. */
export function pairedXg(club) {
  if (Number.isInteger(club?.pairedXgMatches))
    return {
      matches: club.pairedXgMatches,
      xgFor: club.pairedXgFor ?? null,
      xgAgainst: club.pairedXgAgainst ?? null,
      delta: club.pairedXgDelta ?? null,
      perMatch: club.pairedXgDeltaPerMatch ?? null,
    };
  const rows = (club?.rows || []).filter(
    (row) => finite(row.own?.xg) && finite(row.opp?.xg),
  );
  if (!rows.length)
    return {
      matches: 0,
      xgFor: null,
      xgAgainst: null,
      delta: null,
      perMatch: null,
    };
  const xgFor = add(rows, (row) => row.own.xg),
    xgAgainst = add(rows, (row) => row.opp.xg);
  return {
    matches: rows.length,
    xgFor,
    xgAgainst,
    delta: xgFor - xgAgainst,
    perMatch: (xgFor - xgAgainst) / rows.length,
  };
}

/**
 * Goals beside xG: goals for and xG for on the matches whose xG for is known, conceded and xG
 * against on those whose xG against is known. Read on the rows: the paired xG fields hold no
 * goals.
 */
export function goalsBesideXg(club) {
  const side = (xg, goals) => {
    const rows = (club?.rows || []).filter((row) => finite(xg(row)));
    if (!rows.length) return { matches: 0, goals: null, xg: null, delta: null };
    const scored = add(rows, goals),
      expected = add(rows, xg);
    return {
      matches: rows.length,
      goals: scored,
      xg: expected,
      delta: scored - expected,
    };
  };
  return {
    for: side(
      (row) => row.own?.xg,
      (row) => row.gf,
    ),
    against: side(
      (row) => row.opp?.xg,
      (row) => row.ga,
    ),
  };
}

/**
 * A per-match indicator over the season: its mean times the matches that support it, as the
 * service counts them (`coverage`, club-scout.js METRICS). Without that count the support is
 * unknown, and so is the total: the rows alone cannot say which matches the mean stands on.
 */
export function seasonTotal(club, key) {
  const served = club?.coverage?.[key];
  const matches = finite(served) ? served : null;
  const mean = club?.values?.[key];
  return {
    value: finite(mean) && matches > 0 ? mean * matches : null,
    matches,
  };
}

/** A sum whose terms are all known; unknown as soon as one is not. */
export function sumKnown(values) {
  let total = 0;
  for (const value of values) {
    if (!finite(value)) return null;
    total += value;
  }
  return total;
}

/** « sur 9 des 10 matchs » when a value stands on fewer matches than the season's record. */
export const partOf = (matches, total) =>
  matches < total ? `${matches} des ${total} matchs` : null;

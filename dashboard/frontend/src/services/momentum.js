/**
 * The strongest spells of a match's momentum: the SPELL-minute stretches where one team
 * pressed the most (the provider's pressure, positive for the home side), the strongest
 * first, never two overlapping. A match needs at least MIN_POINTS measured minutes.
 */
export const SPELL = 5;
export const MIN_POINTS = 30;

export function momentumSpells(points, { count = 3, spell = SPELL } = {}) {
  const byMinute = new Map();
  for (const point of points || []) {
    if (!Number.isFinite(point?.minute) || !Number.isFinite(point?.value)) continue;
    const minute = Math.floor(point.minute);
    byMinute.set(minute, (byMinute.get(minute) || 0) + point.value);
  }
  if (byMinute.size < MIN_POINTS) return [];
  const minutes = [...byMinute.keys()].sort((a, b) => a - b);
  const windows = [];
  for (const from of minutes) {
    let pressure = 0,
      measured = 0;
    for (let minute = from; minute < from + spell; minute++)
      if (byMinute.has(minute)) {
        pressure += byMinute.get(minute);
        measured++;
      }
    // A stretch cut by half-time or by missing minutes is not a full spell.
    if (measured === spell) windows.push({ from, to: from + spell - 1, pressure });
  }
  windows.sort((a, b) => Math.abs(b.pressure) - Math.abs(a.pressure) || a.from - b.from);
  const kept = [];
  for (const window of windows) {
    if (kept.length === count) break;
    if (window.pressure === 0) continue;
    if (kept.some((other) => window.from <= other.to && other.from <= window.to)) continue;
    kept.push({ from: window.from, to: window.to, side: window.pressure > 0 ? "home" : "away", pressure: window.pressure });
  }
  return kept;
}

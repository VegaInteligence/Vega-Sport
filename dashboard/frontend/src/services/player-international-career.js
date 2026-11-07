/** Facts from played, observed international appearances only. */
export function internationalCareerDetails(rows = []) {
  const dates = [];
  const numbers = new Set();
  let numberedMatches = 0;
  for (const row of rows) {
    if (!row || !Number.isFinite(row.minutes) || row.minutes <= 0) continue;
    if (typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      const parsed = new Date(`${row.date}T00:00:00Z`);
      if (
        !Number.isNaN(parsed.valueOf()) &&
        parsed.toISOString().slice(0, 10) === row.date
      )
        dates.push(row.date);
    }
    const raw = row.shirtNumber;
    if (!(
      typeof raw === "number" ||
      (typeof raw === "string" && /^\d+$/.test(raw))
    ))
      continue;
    const number = Number(raw);
    if (!Number.isSafeInteger(number) || number < 1 || number > 99) continue;
    numbers.add(number);
    numberedMatches++;
  }
  return {
    firstMatchDate: dates.sort()[0] || null,
    shirtNumbers: [...numbers].sort((a, b) => a - b),
    numberedMatches,
  };
}

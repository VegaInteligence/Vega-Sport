/** Parse a source season without changing its original value. */
export function validSourceSeason(value) {
  const match = String(value ?? "").match(/^(\d{4})(?:\/(\d{4}))?$/);
  return Boolean(
    match && (!match[2] || Number(match[2]) === Number(match[1]) + 1),
  );
}
export function historyYears(args) {
  const option = args.find((value) => value.startsWith("--years="));
  if (!option) return null;
  const years = option.slice("--years=".length).split(",");
  if (!years.length || years.some((year) => !/^\d{4}$/.test(year)))
    throw new Error(
      "Historical years must be four-digit start years, such as 2023.",
    );
  return new Set(years);
}
export const inHistoryScope = (competition, years) =>
  validSourceSeason(competition.season) &&
  (!years || years.has(String(competition.season).slice(0, 4)));

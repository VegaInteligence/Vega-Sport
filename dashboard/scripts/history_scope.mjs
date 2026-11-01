/** Parse optional start-year scope without changing the provider's season values. */
export function historyYears(args) {
  const option = args.find((value) => value.startsWith("--years="));
  if (!option) return null;
  const years = option.slice("--years=".length).split(",");
  if (!years.length || years.some((year) => !/^202[4-5]$/.test(year)))
    throw new Error(
      "Historical years must be selected from 2024 through 2025.",
    );
  return new Set(years);
}
export const inHistoryScope = (competition, years) =>
  Number(String(competition.season).slice(0, 4)) >= 2024 &&
  (!years || years.has(String(competition.season).slice(0, 4)));

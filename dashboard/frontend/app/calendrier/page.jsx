import { redirect } from "next/navigation";

export default async function LegacyCalendar({ searchParams }) {
  const source = await searchParams;
  const query = new URLSearchParams({ tab: "upcoming" });
  for (const key of ["season", "focus", "league", "q", "minutes", "week"]) {
    if (typeof source[key] === "string" && source[key])
      query.set(key, source[key]);
  }
  redirect(`/matchs?${query}`);
}

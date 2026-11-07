/** One row per observed appearance, newest first; never manufacture a match. */
export function competitionMatchRows(rows, matches) {
  const byId = new Map(matches.map((match) => [match.id, match]));
  const unique = new Map();
  for (const row of rows || [])
    if (row.matchId && !unique.has(row.matchId)) unique.set(row.matchId, row);
  return [...unique.values()]
    .map((row) => ({ row, match: byId.get(row.matchId) || null }))
    .sort(
      (a, b) =>
        String(b.match?.date || b.row.date || "").localeCompare(
          String(a.match?.date || a.row.date || ""),
        ) || String(a.row.matchId).localeCompare(String(b.row.matchId)),
    );
}
export function matchExternalUrl(match) {
  if (!String(match?.id || "").startsWith("uefa:")) return null;
  try {
    const u = new URL(match.sourceUrl);
    return u.protocol === "https:" && u.hostname === "www.uefa.com"
      ? u.href
      : null;
  } catch {
    return null;
  }
}

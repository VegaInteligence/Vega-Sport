/**
 * A team's absent players today (/api/teams/{id}/absences): the injured, the ill and the
 * suspended, with when they went out and when they are expected back. A club or a national
 * side never read answers 404: no absences known (null), never « nobody is out ».
 *
 * Answer: { id, asOf, squad: { players, read }, absences: [{ player: { id, name, imageUrl,
 * role }, kind: "injury"|"illness"|"suspension"|null, label, start, expectedReturn,
 * matchesMissed, matchesRemaining, competition: { code, id, name }|null, readAt }] }.
 */
import { useResource, json } from "./resources.js";
import { injuryLabel } from "./injury-labels.js";

const DAY = 86400000;
const parse = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
const missing = (error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error));

export function useTeamAbsences(id) {
  return useResource(
    `team-absences:${id || "none"}`,
    () => json(`/api/teams/${encodeURIComponent(id)}/absences`).catch(missing),
    Boolean(id),
  );
}

/** « injury », « illness », « suspension » or « unknown » (an absence the source did not class). */
export const absenceKind = (absence) =>
  ["injury", "illness", "suspension"].includes(absence?.kind) ? absence.kind : "unknown";

/** The reason in French; an absence the source did not class is not called an injury. */
export function absenceReason(absence) {
  const kind = absenceKind(absence);
  if (kind === "unknown") return absence?.label ? injuryLabel(absence.label, "unknown").replace(/^Blessure$/, "Absent") : "Absent";
  return injuryLabel(absence.label, absence.kind);
}

const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const dayMonthYear = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** « 21 oct. », with its year when it is not the year of `asOf`. */
export function absenceDate(iso, asOf) {
  if (!iso) return null;
  const value = new Date(parse(iso));
  return (asOf && String(asOf).slice(0, 4) === String(iso).slice(0, 4) ? dayMonth : dayMonthYear).format(value);
}

/** « dans 9 j », « dans 27 sem. »; null when the day has passed or is unknown. */
export function returnDistance(iso, asOf) {
  if (!iso || !asOf) return null;
  const days = Math.round((parse(iso) - parse(asOf)) / DAY);
  if (days < 0) return null;
  if (days === 0) return "aujourd’hui";
  return days < 14 ? `dans ${days} j` : `dans ${Math.round(days / 7)} sem.`;
}

/** Whether a suspension keeps the player out of a match of this competition (an injury always does). */
export function absenceApplies(absence, competition) {
  if (absenceKind(absence) !== "suspension" || !absence.competition || !competition) return true;
  const { id, name } = absence.competition;
  if (id && competition.id) return id === competition.id;
  const norm = (value) => String(value || "").trim().toLowerCase();
  return !name || !competition.name || norm(name) === norm(competition.name);
}

const order = (absence) => {
  const kind = absenceKind(absence);
  if (kind === "suspension") return [0, absence.matchesRemaining ?? 99];
  if (absence.expectedReturn) return [1, parse(absence.expectedReturn)];
  return [2, -parse(absence.start || "1970-01-01")];
};

/**
 * What the pages draw: the absences sorted by return (suspensions, then dated returns,
 * then the unknown ones, the latest out first), each player's own by id, and how much of the
 * squad was read. Null when nothing was read.
 */
export function absenceView(answer, competition = null) {
  if (!answer || !Array.isArray(answer.absences)) return null;
  const rows = answer.absences
    .filter((a) => a?.player?.id && absenceApplies(a, competition))
    .sort((a, b) => {
      const [x, y] = [order(a), order(b)];
      return x[0] - y[0] || x[1] - y[1];
    });
  const players = Number.isFinite(answer.squad?.players) ? answer.squad.players : null;
  const read = Number.isFinite(answer.squad?.read) ? answer.squad.read : null;
  return {
    asOf: answer.asOf,
    rows,
    byPlayer: new Map(rows.map((a) => [a.player.id, a])),
    squad: players != null && read != null ? { players, read: Math.min(read, players) } : null,
  };
}

/**
 * The common time scale of the dated returns: from `asOf` to the start of the month after
 * the latest return, at least six weeks and at most nine months; its month starts as ticks.
 */
export function absenceScale(rows, asOf) {
  const start = parse(asOf);
  const latest = Math.max(start + 42 * DAY, ...rows.filter((a) => a.expectedReturn).map((a) => parse(a.expectedReturn)));
  const last = new Date(latest);
  let end = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1);
  const cap = new Date(start);
  end = Math.min(end, Date.UTC(cap.getUTCFullYear(), cap.getUTCMonth() + 9, 1));
  const span = end - start;
  const ticks = [];
  for (let d = new Date(start); ; ) {
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    if (next >= end) break;
    ticks.push({ at: (next - start) / span, label: new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" }).format(new Date(next)) });
    d = new Date(next);
  }
  return {
    ticks,
    /** A day's place on the scale, 0 to 1 (clamped); beyond the scale: 1. */
    at: (iso) => Math.max(0, Math.min(1, (parse(iso) - start) / span)),
    beyond: (iso) => parse(iso) > end,
  };
}

/** The title of an absent player's mark: why, and until when. */
export function absenceTitle(absence, asOf) {
  const reason = absenceReason(absence);
  if (absenceKind(absence) === "suspension") {
    const n = absence.matchesRemaining;
    const where = absence.competition?.name ? ` en ${absence.competition.name}` : "";
    return n ? `${reason} · ${n} match${n > 1 ? "s" : ""} à purger${where}` : `${reason}${where}`;
  }
  return absence.expectedReturn
    ? `${reason} · retour prévu le ${absenceDate(absence.expectedReturn, asOf)}`
    : `${reason} · retour inconnu`;
}

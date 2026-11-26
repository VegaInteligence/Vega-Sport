/**
 * A team's absent players today (/api/teams/{id}/absences, backend/api/src/routes/profiles.mjs): the injured, the ill
 * and the suspended, with when they went out and when they are expected back. A club or a national side the base
 * does not know answers 404: no absences known (null), never « nobody is out ». A national side is asked with its
 * own id (its injuries and illnesses only).
 *
 * Answer (`data`): { id, asOf, squad: { players, read }, absences: [{ player: { id, name, imageUrl, role },
 * kind: "injury"|"illness"|"suspension"|null, label, start, expectedReturn, matchesMissed, matchesRemaining,
 * competition: { code, id, name }|null, readAt }] }. `role` is a role key (agg.player_power.role) or null; a
 * suspension's competition has `id` and `name` null while it is not linked; kind, return and match counts may be
 * null and stay unknown here (never « injury », a date or 0). A player may be out twice (suspended and injured).
 */
import { useResource, primeResource, json } from "./resources.js";
import { absenceLabel } from "./injury-labels.js";
import { ROLE_LABEL } from "./power-ranking.js";

const DAY = 86400000;
const parse = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
const known = (iso) => Boolean(iso) && Number.isFinite(parse(iso));
const today = () => new Date().toISOString().slice(0, 10);
const missing = (error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error));
const key = (id) => `team-absences:${id || "none"}`;
const load = (id) => () =>
  json(`/api/teams/${encodeURIComponent(id)}/absences`)
    .then((body) => body?.data ?? null)
    .catch(missing);

export function useTeamAbsences(id) {
  return useResource(key(id), load(id), Boolean(id));
}

/**
 * A match's absent players on its day, once it has kicked off (/api/matches/{id}/absences, FAILURE_MODES.md § 77):
 * { id, on, home, away }, each side { team, asOf, squad, absences } in the shape above, read as of the match day
 * (`matchesRemaining` null). 404 (an unknown match, or one not started): null.
 */
export function useMatchAbsences(id, enabled = true) {
  return useResource(
    `match-absences:${id || "none"}`,
    () => json(`/api/matches/${encodeURIComponent(id)}/absences`).then((body) => body?.data ?? null).catch(missing),
    Boolean(id) && enabled,
  );
}

/** Starts the read before its tab is open, so that the squad tab's card is there when the tab is. */
export function primeTeamAbsences(id) {
  if (id) Promise.resolve(primeResource(key(id), load(id))).catch(() => {});
}

/** « injury », « illness », « suspension » or « unknown » (an absence the source did not class). */
export const absenceKind = (absence) =>
  ["injury", "illness", "suspension"].includes(absence?.kind) ? absence.kind : "unknown";

/** The reason in French; an absence the source did not class is not called an injury. */
export const absenceReason = (absence) => absenceLabel(absence?.label, absence?.kind);

/** The player's role as the site names it; a key it does not know, or none, is « Poste non renseigné ». */
export const absenceRole = (absence) => ROLE_LABEL[absence?.player?.role] || "Poste non renseigné";

/** A suspension's competition: its name, else its code while it is not linked; null without one. */
export const absenceCompetition = (absence) => absence?.competition?.name || absence?.competition?.code || null;

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
  if (!known(iso) || !known(asOf)) return null;
  const days = Math.round((parse(iso) - parse(asOf)) / DAY);
  if (days < 0) return null;
  if (days === 0) return "aujourd’hui";
  return days < 14 ? `dans ${days} j` : `dans ${Math.round(days / 7)} sem.`;
}

/**
 * Whether an absence keeps the player out of a match: a suspension only in its own competition (the same id: one
 * not linked yet, or without a competition, is not placed) with matches still to serve; any other absence when its
 * return is unknown or comes after the kick-off.
 */
export function absenceApplies(absence, match) {
  if (absenceKind(absence) === "suspension")
    return Boolean(absence.competition?.id && match?.competitionId && absence.competition.id === match.competitionId)
      && absence.matchesRemaining !== 0;
  if (!absence.expectedReturn) return true;
  const kickoff = Date.parse(match?.kickoff || "");
  return !Number.isFinite(kickoff) || parse(absence.expectedReturn) > kickoff;
}

const order = (absence) => {
  const kind = absenceKind(absence);
  if (kind === "suspension") return [0, absence.matchesRemaining ?? 99];
  if (absence.expectedReturn) return [1, parse(absence.expectedReturn)];
  return [2, -parse(absence.start || "1970-01-01")];
};

/**
 * What the pages draw: the absences sorted by return (suspensions, then dated returns, then the unknown ones, the
 * latest out first), each with a `key` of its own, each player's first one by id, and how much of the squad was read.
 * Null when nothing was read. Options: `match` ({ competitionId, kickoff }) keeps the absences that count for that
 * match; `suspensions: false` leaves the suspensions out (a national side: a club's suspension does not count there).
 */
export function absenceView(answer, { match = null, suspensions = true } = {}) {
  if (!answer || !Array.isArray(answer.absences)) return null;
  const rows = answer.absences
    .filter((a) => a?.player?.id && (suspensions || absenceKind(a) !== "suspension") && (!match || absenceApplies(a, match)))
    .sort((a, b) => {
      const [x, y] = [order(a), order(b)];
      return x[0] - y[0] || x[1] - y[1];
    })
    .map((a, i) => ({ ...a, key: `${a.player.id}:${a.kind ?? "unknown"}:${a.start ?? ""}:${a.label ?? ""}:${i}` }));
  const byPlayer = new Map();
  for (const a of rows) if (!byPlayer.has(a.player.id)) byPlayer.set(a.player.id, a);
  const players = Number.isFinite(answer.squad?.players) ? answer.squad.players : null;
  const read = Number.isFinite(answer.squad?.read) ? answer.squad.read : null;
  // No read date (no player's suspensions read yet): the latest read of the absences shown, else today (UTC).
  const reads = rows.map((a) => a.readAt).filter(known).sort();
  return {
    asOf: known(answer.asOf) ? answer.asOf : reads.at(-1)?.slice(0, 10) ?? today(),
    rows,
    byPlayer,
    squad: players != null && read != null ? { players, read: Math.min(read, players) } : null,
  };
}

/**
 * The common time scale of the dated returns: from `asOf` to the start of the month after
 * the latest return, at least six weeks and at most nine months; its month starts as ticks.
 */
export function absenceScale(rows, asOf) {
  const start = parse(known(asOf) ? asOf : today());
  const latest = Math.max(start + 42 * DAY, ...rows.filter((a) => known(a.expectedReturn)).map((a) => parse(a.expectedReturn)));
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
    const competition = absenceCompetition(absence);
    const where = competition ? ` en ${competition}` : "";
    return n ? `${reason} · ${n} match${n > 1 ? "s" : ""} à purger${where}` : `${reason}${where}`;
  }
  return absence.expectedReturn
    ? `${reason} · retour prévu le ${absenceDate(absence.expectedReturn, asOf)}`
    : `${reason} · retour inconnu`;
}

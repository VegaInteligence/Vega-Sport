/**
 * An archived World Cup match's details (GET /api/worldcup/matches…, the Fjelstul World Cup Database; mock-up
 * validated 18 Nov 2026): the reads, a tie's link to its page, and what the page derives from the events.
 */
import { useResource, json } from "./resources.js";
import { attachNativeMatches } from "./knockout-bracket.js";
import { sameNationalTeam } from "./national-flags.js";

export const WORLD_CUP_MATCH_KEY = /^M-\d{4}-\d{2,3}$/;

export function useWorldCupMatch(key) {
  return useResource(
    `worldcup-match:${key}`,
    () => json(`/api/worldcup/matches/${encodeURIComponent(key)}`).then((body) => body?.data ?? null),
    WORLD_CUP_MATCH_KEY.test(key || ""),
  );
}

/** The edition's matches with a page; none when the edition has none or the read fails (the bracket stays as it is). */
export function useWorldCupIndex(edition, enabled = true) {
  return useResource(
    `worldcup-index:${edition}`,
    () => json(`/api/worldcup/matches?${new URLSearchParams({ edition })}`).then((body) => body?.data?.matches ?? []).catch(() => []),
    enabled && /^\d{4}$/.test(String(edition || "")),
  );
}

/** An archived edition's matches, each with its page's key when the index holds the match of that day and teams. */
export function withWorldCupKeys(matches, index) {
  const pages = (index || []).map((m) => ({ id: m.key, date: m.date, home: { name: m.home }, away: { name: m.away } }));
  return attachNativeMatches(matches, pages, sameNationalTeam);
}

export const minuteLabel = (event) => `${event.minute}${event.stoppage ? "+" + event.stoppage : ""}’`;

const SWAP = new Set(["off", "on"]);

/**
 * The match's thread: one line per event, a team's single change of one minute (one off, one on) as one line
 * « change » (`name` came on, `off` went off), and the half-time line before the first event after the 45th minute.
 */
export function matchThread(events) {
  const lines = [], used = new Set();
  (events || []).forEach((event, index) => {
    if (used.has(index)) return;
    if (SWAP.has(event.kind)) {
      const same = (events || []).map((e, i) => [e, i]).filter(([e]) => SWAP.has(e.kind) && e.side === event.side && e.minute === event.minute && e.stoppage === event.stoppage);
      const off = same.filter(([e]) => e.kind === "off"), on = same.filter(([e]) => e.kind === "on");
      if (off.length === 1 && on.length === 1) {
        same.forEach(([, i]) => used.add(i));
        lines.push({ minute: minuteLabel(event), side: event.side, kind: "change", name: on[0][0].name, person: on[0][0].person, off: off[0][0].name, at: event });
        return;
      }
    }
    lines.push({ minute: minuteLabel(event), side: event.side, kind: event.kind, name: event.name, person: event.person, at: event });
  });
  const out = [];
  let half = false;
  for (const line of lines) {
    if (!half && line.at.minute > 45) {
      half = true;
      out.push({ half: true });
    }
    const { at, ...rest } = line;
    out.push(rest);
  }
  return out;
}

/** A player's marks in the line-up: his goals, cards and minute off or on, in time. */
export function playerMarks(events, person) {
  return (events || []).filter((e) => e.person === person).map((e) => ({ kind: e.kind, minute: minuteLabel(e) }));
}

const STAGES = {
  final: "Finale", "third-place match": "Match pour la 3e place", "semi-finals": "Demi-finale", "semi-final": "Demi-finale",
  "quarter-finals": "Quart de finale", "quarter-final": "Quart de finale", "round of 16": "Huitième de finale",
  "group stage": "Phase de groupes", "second group stage": "Second tour", "final round": "Poule finale",
};

/** The stage in French, with its group when it has one. */
export function stageLabel(stage, group) {
  const name = STAGES[stage] || stage;
  return group && STAGES[stage] && stage !== "final round" ? `${name} · ${String(group).replace(/^Group\s+/i, "Groupe ")}` : name;
}

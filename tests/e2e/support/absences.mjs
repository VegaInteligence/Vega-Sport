// Test double of GET /api/teams/{id}/absences for the absents' E2E checks (club, nation and match pages): the
// answers are built here in the route's exact shape (backend/api/src/routes/profiles.mjs, view api.team_absences of
// backend/sql/174_absences_suspensions.sql): { data: { id, asOf, squad: { players, read }, absences: [{ player: { id,
// name, imageUrl, role }, kind, label, start, expectedReturn, matchesMissed, matchesRemaining, competition: { code, id,
// name } | null, readAt }] } }. `role` is a role key (agg.player_power.role) or null; a suspension's competition has
// `id` and `name` null when it is not linked yet; `kind`, `expectedReturn`, `matchesMissed` and `matchesRemaining`
// may be null. 404 is a team the base does not know.
//
// serveAbsences(context, plan): every request to …/api/teams/<id>/absences is answered from plan[<id>]:
//   an answer object → 200 with { data: answer };  404 / 500 → that status;  "abort" → a network failure;
//   { hold: Promise, answer } → the answer once the promise resolves;  undefined → 404.
// Each request is logged in plan.requests ([{ id, at }]).

export const ABSENCES_PATH = /\/api\/teams\/([^/?#]+)\/absences(?:[?#]|$)/;

export async function serveAbsences(context, plan) {
  plan.requests ||= [];
  await context.route(ABSENCES_PATH, async (route) => {
    const id = decodeURIComponent(route.request().url().match(ABSENCES_PATH)[1]);
    plan.requests.push({ id, at: Date.now() });
    let entry = plan[id];
    if (entry && typeof entry === "object" && entry.hold) {
      await entry.hold;
      entry = entry.answer;
    }
    const headers = { "access-control-allow-origin": "*", "cache-control": "no-store" };
    if (entry === "abort") return route.abort("connectionfailed").catch(() => {});
    if (entry === undefined || entry === 404 || entry === 500)
      return route.fulfill({ status: entry || 404, contentType: "application/json", headers, body: JSON.stringify({ error: "Donnée indisponible." }) }).catch(() => {});
    return route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify({ data: entry }) }).catch(() => {});
  });
}

const player = (id, name, role, imageUrl = null) => ({ id, name, imageUrl, role });
const absence = (who, fields) => ({
  player: who, kind: "injury", label: null, start: "2026-11-01", expectedReturn: null, matchesMissed: null, matchesRemaining: null,
  competition: null, readAt: "2026-11-23", ...fields,
});

// Paris Saint-Germain (t_41iFW3), 24 Nov 2026: 25 members, 23 read. Five rows, four players:
// - Kvaratskhelia (winger): an injury back on 31 May 2027, 5 matches missed;
// - Doué (role unknown): an episode the source did not class (kind, label, return and matches missed all null);
// - Pacho (centre_back): a Ligue 1 suspension (linked: l_3FJFUl), 1 match to serve, and an injury back on
//   26 Nov 2026 (before the 28 Nov match), matches missed unknown: the same player twice;
// - Zaïre-Emery (central_midfielder): a suspension in a competition not linked yet ({ code: "FRC", id: null,
//   name: null }), matches missed and to serve unknown; and a Champions League suspension (linked, another
//   competition: l_0bfbkO) for Hakimi (full_back).
export const PSG = "t_41iFW3";
export const LORIENT = "t_2lHmy6";
export const LIGUE1 = "l_3FJFUl";
export const psgAnswer = () => ({
  id: PSG, asOf: "2026-11-24", squad: { players: 25, read: 23 },
  absences: [
    absence(player("p_4bGFWS", "Désiré Doué", null), { kind: null, label: null, start: "2026-11-22" }),
    absence(player("p_2lkyxD", "Willian Pacho", "centre_back"), { kind: "suspension", label: "Yellow card suspension", start: "2026-11-22",
      matchesMissed: 0, matchesRemaining: 1, competition: { code: "FR1", id: LIGUE1, name: "Ligue 1" } }),
    absence(player("p_2lkyxD", "Willian Pacho", "centre_back"), { kind: "injury", label: "Knee injury", start: "2026-11-20", expectedReturn: "2026-11-26" }),
    absence(player("p_v0000901", "Warren Zaïre-Emery", "central_midfielder"), { kind: "suspension", label: "Red card suspension", start: "2026-11-19",
      competition: { code: "FRC", id: null, name: null } }),
    absence(player("p_v0000902", "Achraf Hakimi", "full_back"), { kind: "suspension", label: "Yellow card suspension", start: "2026-11-18",
      matchesMissed: 1, matchesRemaining: 1, competition: { code: "CL", id: "l_0bfbkO", name: "Ligue des champions" } }),
    absence(player("p_2ZwqC5", "Khvicha Kvaratskhelia", "winger"), { kind: "injury", label: "Cruciate ligament tear", start: "2026-10-21",
      expectedReturn: "2027-05-31", matchesMissed: 5 }),
  ],
});
// Lorient (t_2lHmy6): two injuries, one back after the match (14 Dec), one without a return.
export const lorientAnswer = () => ({
  id: LORIENT, asOf: "2026-11-24", squad: { players: 26, read: 26 },
  absences: [
    absence(player("p_142BTs", "Montassar Talbi", "centre_back"), { label: "Knee injury", start: "2026-11-22" }),
    absence(player("p_0HYXz5", "Jean-Victor Makengo", "central_midfielder"), { label: "Hamstring injury", start: "2026-11-08",
      expectedReturn: "2026-12-14", matchesMissed: 2 }),
  ],
});
// Two dated injuries only (the loading check: the card's height for two rows).
export const twoAnswer = (id = PSG) => ({
  id, asOf: "2026-11-24", squad: { players: 25, read: 25 },
  absences: psgAnswer().absences.filter((a) => a.kind === "injury" && a.expectedReturn).map((a) => ({ ...a, expectedReturn: "2027-01-10" })),
});
// Twelve absents with long names, every kind and return (the board stays readable; the phone does not scroll sideways).
export const manyAnswer = (id = PSG) => {
  const kinds = ["injury", "illness", "suspension", null];
  const roles = ["goalkeeper", "centre_back", "full_back", "defensive_midfielder", "central_midfielder", "winger", "centre_forward", null];
  return {
    id, asOf: "2026-11-24", squad: { players: 30, read: 27 },
    absences: Array.from({ length: 12 }, (_, i) => {
      const kind = kinds[i % 4];
      return absence(player(`p_v09${String(i).padStart(5, "0")}`, i % 3 === 0 ? `Jean-Philippe Alexandre Mbemba-Kouassi de la Fontaine ${i + 1}` : `Joueur Numéro ${i + 1}`, roles[i % 8]), {
        kind, label: kind === "suspension" ? "Yellow card suspension" : kind === "illness" ? "Flu" : kind ? "Hamstring injury" : null,
        start: `2026-11-${String(10 + i).padStart(2, "0")}`,
        expectedReturn: kind === "suspension" ? null : i % 5 === 0 ? null : `2027-0${1 + (i % 8)}-15`,
        matchesMissed: i % 2 ? i : null, matchesRemaining: kind === "suspension" ? (i % 3) + 1 : null,
        competition: kind === "suspension" ? { code: "FR1", id: LIGUE1, name: "Ligue 1" } : null,
      });
    }),
  };
};
// A known team without anything read yet, or nobody out.
export const emptyAnswer = (id, players = 0, read = 0) => ({ id, asOf: read ? "2026-11-24" : null, squad: { players, read }, absences: [] });

// France (t_2ysHaw), the route extended to national sides (injuries and illnesses): Olise and Mbappé injured;
// a suspension, should one be served, does not keep a player out of his national side.
export const FRANCE = "t_2ysHaw";
export const franceAnswer = () => ({
  id: FRANCE, asOf: "2026-11-24", squad: { players: 23, read: 23 },
  absences: [
    absence(player("p_2HDCEW", "Michael Olise", "winger"), { label: "Foot contusion", start: "2026-11-21" }),
    absence(player("p_217YMB", "Kylian Mbappé", "centre_forward"), { kind: "illness", label: "Flu", start: "2026-11-23", expectedReturn: "2026-11-30", matchesMissed: 0 }),
    absence(player("p_1NIzYq", "Dayot Upamecano", "centre_back"), { kind: "suspension", label: "Yellow card suspension", start: "2026-11-22",
      matchesRemaining: 1, competition: { code: "L1", id: "l_v0000777", name: "Bundesliga" } }),
  ],
});

// Test double of GET /api/matches/{id}/absences (FAILURE_MODES.md § 77, backend/api/test/match-absences.test.mjs checks
// the real route against the same shape): { data: { id, on, home: { team, asOf, squad, absences }, away: { … } } }, each
// side's absences in the shape above, read as of the match day (`matchesRemaining` null). serveMatchAbsences(context,
// plan): plan.answer → 200, 404 / 500 / "abort" as serveAbsences; each request logged in plan.requests.
export const MATCH_ABSENCES_PATH = /\/api\/matches\/([^/?#]+)\/absences(?:[?#]|$)/;
export async function serveMatchAbsences(context, plan) {
  plan.requests ||= [];
  await context.route(MATCH_ABSENCES_PATH, async (route) => {
    plan.requests.push({ id: decodeURIComponent(route.request().url().match(MATCH_ABSENCES_PATH)[1]), at: Date.now() });
    const entry = plan.answer;
    const headers = { "access-control-allow-origin": "*", "cache-control": "no-store" };
    if (entry === "abort") return route.abort("connectionfailed").catch(() => {});
    if (entry === undefined || entry === 404 || entry === 500)
      return route.fulfill({ status: entry || 404, contentType: "application/json", headers, body: JSON.stringify({ error: "Donnée indisponible." }) }).catch(() => {});
    return route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify({ data: entry }) }).catch(() => {});
  });
}
// The same PSG – Lorient once played (28 Nov 2026): PSG had Kvaratskhelia injured and Pacho suspended that day, Lorient
// Makengo injured; Talbi was back and on the sheet, so the route does not name him.
export const matchDayAnswer = (id) => ({
  id, on: "2026-11-28",
  home: { team: PSG, asOf: "2026-11-24", squad: { players: 25, read: 23 }, absences: [
    absence(player("p_2lkyxD", "Willian Pacho", "centre_back"), { kind: "suspension", label: "Yellow card suspension", start: "2026-11-22",
      expectedReturn: "2026-11-29", matchesMissed: 0, matchesRemaining: null, competition: { code: "FR1", id: LIGUE1, name: "Ligue 1" } }),
    absence(player("p_2ZwqC5", "Khvicha Kvaratskhelia", "winger"), { kind: "injury", label: "Cruciate ligament tear", start: "2026-10-21",
      expectedReturn: "2027-05-31", matchesMissed: 5 }),
  ] },
  away: { team: LORIENT, asOf: "2026-11-24", squad: { players: 26, read: 26 }, absences: [
    absence(player("p_0HYXz5", "Jean-Victor Makengo", "central_midfielder"), { label: "Hamstring injury", start: "2026-11-08",
      expectedReturn: "2026-12-14", matchesMissed: 2 }),
  ] },
});

/** WCAG contrast of two CSS colours (rgb()/rgba() strings as getComputedStyle gives them). */
export function contrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Test doubles of GET /api/matches/{id}/lineups and GET /api/matches/{id}/lineups/probable for the « Composition
// probable » E2E checks (FAILURE_MODES.md §61, section C of match-page.e2e.mjs), in the routes' exact shapes:
// - probable-psg-lorient.json: our eleven of both sides of Paris Saint-Germain – Lorient (m_1LWSAq, Ligue 1, 28 Nov
//   2026 19:45 UTC) as backend/api/src/match-families.mjs probableLineupsBody builds it (the validated mock-up's answer:
//   PSG's names, numbers and portraits are real, Lorient's eleven is invented; Marquinhos replaces the suspended
//   Willian Pacho, Senny Mayulu the injured Désiré Doué);
// - lineups-psg-confirmed.json: the provider's line-ups with PSG's eleven confirmed and no Lorient side (lineupsBody).
//
// serveLineups(context, plan): plan.lineups is 404, "abort", "home" (PSG confirmed) or "both" (Lorient's probable eleven
// confirmed by the provider too); plan.probable is "both", "home" (Lorient null), 404 or "abort". Either may change
// during a run. Each read is logged in plan.reads ([{ family, at, lineups }]).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(path.join(HERE, name), "utf8"));
export const PROBABLE_MATCH_ID = "m_1LWSAq";
export const PROBABLE_KICKOFF = Date.parse("2026-11-28T19:45:00Z");
export const probableAnswer = () => load("probable-psg-lorient.json");
export const homeConfirmed = () => load("lineups-psg-confirmed.json");

/** Both sides confirmed: Lorient's line-up as its probable eleven, confirmed by the provider. */
export function bothConfirmed() {
  const both = homeConfirmed();
  const lorient = probableAnswer().data.away;
  both.data.away = {
    starters: lorient.starters.map(({ player_id, name, shirt_number, position_id, pitch_x, pitch_y }) =>
      ({ player_id, name, shirt_number, position_id, pitch_x, pitch_y, is_captain: name === "Laurent Abergel" })),
    subs: [], confirmed: true, formation: lorient.formation, lineup_type: "official", coach: { name: "Olivier Pantaloni" },
  };
  return both;
}

export async function serveLineups(context, plan, match = PROBABLE_MATCH_ID) {
  plan.reads ||= [];
  const headers = { "access-control-allow-origin": "*", "cache-control": "no-store" };
  const answer = (route, entry, body) => {
    if (entry === "abort") return route.abort("connectionfailed").catch(() => {});
    if (!body) return route.fulfill({ status: 404, contentType: "application/json", headers, body: '{"error":"Donnée indisponible."}' }).catch(() => {});
    return route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(body) }).catch(() => {});
  };
  await context.route(new RegExp(`/api/matches/${match}/lineups/probable(\\?|$)`), (route) => {
    plan.reads.push({ family: "probable", at: Date.now(), lineups: plan.lineups });
    const entry = plan.probable;
    let body = null;
    if (entry === "both") body = probableAnswer();
    if (entry === "home") body = probableAnswer(), (body.data.away = null);
    return answer(route, entry, body);
  });
  await context.route(new RegExp(`/api/matches/${match}/lineups(\\?|$)`), (route) => {
    plan.reads.push({ family: "lineups", at: Date.now(), lineups: plan.lineups });
    const entry = plan.lineups;
    return answer(route, entry, entry === "home" ? homeConfirmed() : entry === "both" ? bothConfirmed() : null);
  });
}

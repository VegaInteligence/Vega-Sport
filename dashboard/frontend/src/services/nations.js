/**
 * The nation pages (/api/nations, /api/nations/{id}; VI-18): the national teams and one nation,
 * and the words the pages give their competitions and rounds. The base names a national team in
 * English (« Spain ») or, for some Nations League teams, in French (« Italie »): the page shows
 * the French name (nationalTeamName).
 */
import { useResource, json } from "./resources.js";
import { nationalTeamLabel } from "./national-flags.js";

const missing = (error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error));

export function useNations(season) {
  return useResource(
    `nations:${season}`,
    () => json(`/api/nations?${new URLSearchParams({ season })}`).then((body) => body?.data ?? null),
    Boolean(season),
  );
}

export function useNation(id, season) {
  return useResource(
    `nation:${id}:${season}`,
    () => json(`/api/nations/${encodeURIComponent(id)}?${new URLSearchParams({ season })}`).then((body) => body?.data ?? null).catch(missing),
    Boolean(id && season),
  );
}

/** A national team's name in French (the home nations and the teams of the past included). */
export const nationName = (name) => nationalTeamLabel(name) || name;

/** A competition's name on the page, from its edition key or its name. */
export function competitionLabel(match) {
  const key = match.edition || "", name = match.competition || "";
  if (/nations-league/.test(key) || /nations-league|Nations League/i.test(name)) return "Ligue des nations";
  if (/world-cup/.test(key) || /^World Cup/.test(name)) return "Coupe du monde";
  if (/:euro:/.test(key) || /^Euro/.test(name)) return "Euro";
  if (/afcon/.test(key) || /Afrique|Africa Cup/i.test(name)) return "CAN";
  if (/copa-america/.test(key) || /Copa Am/i.test(name)) return "Copa América";
  if (/qualif/i.test(key + name)) return "Qualifications";
  if (/friendl/i.test(key + name)) return "Match amical";
  return name;
}

/** A round in French: a stage of a knockout, or the group phase. */
export function roundLabel(round) {
  const r = String(round || "").trim();
  const low = r.toLowerCase();
  if (!r) return "";
  if (/third|3rd|bronze|troisi[eè]me/.test(low)) return "Match pour la 3e place";
  if (/^(?:the )?finale?s?$/.test(low)) return "Finale";
  if (/semi|^1\/2$|demi/.test(low)) return "Demi-finale";
  if (/quarter|^1\/4$|quart/.test(low)) return "Quart de finale";
  if (/round of 16|^1\/8$|huiti[eè]me/.test(low)) return "8e de finale";
  if (/round of 32|^1\/16$|seizi[eè]me/.test(low)) return "16e de finale";
  if (/preliminary|pr[ée]liminaire/.test(low)) return "Tour préliminaire";
  if (/^groupe?\s/i.test(r)) return r.replace(/^group\s/i, "Groupe ");
  return "Phase de groupes";
}

/** The match from the nation's side: its goals, the other's, and "V", "N", "D" or null. */
export function sideOf(match, id) {
  const home = match.home.id === id;
  const own = home ? match.homeScore : match.awayScore, other = home ? match.awayScore : match.homeScore;
  if (own == null || other == null) return { own, other, result: null, opponent: home ? match.away : match.home, home };
  let result = own > other ? "V" : own < other ? "D" : "N";
  const ownPens = home ? match.homePenalties : match.awayPenalties, otherPens = home ? match.awayPenalties : match.homePenalties;
  if (result === "N" && ownPens != null && otherPens != null && ownPens !== otherPens) result = ownPens > otherPens ? "V" : "D";
  return { own, other, result, opponent: home ? match.away : match.home, home, pens: ownPens != null && otherPens != null ? [ownPens, otherPens] : null };
}

/** The last major tournament edition the nation played, with its matches oldest first. */
export const lastTournament = (nation) => (nation?.tournaments || []).at(-1) || null;

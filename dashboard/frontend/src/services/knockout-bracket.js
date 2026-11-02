import { normalizeText } from "../model.js";

const STAGES = [
  { key: "round64", label: "Trente-deuxièmes de finale" },
  { key: "round32", label: "Seizièmes de finale" },
  { key: "round16", label: "Huitièmes de finale" },
  { key: "quarter", label: "Quarts de finale" },
  { key: "semi", label: "Demi-finales" },
  { key: "final", label: "Finale" },
];

export function knockoutStage(value) {
  const name = normalizeText(value).replace(/[-–—]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:1\/32|round of 64|trente deuxiemes de finale)$/.test(name)) return "round64";
  if (/^(?:1\/16|round of 32|seiziemes de finale)$/.test(name)) return "round32";
  if (/^(?:1\/8|round of 16|huitiemes de finale)$/.test(name)) return "round16";
  if (/^(?:1\/4|quarter ?finals?|quarts? de finale)$/.test(name)) return "quarter";
  if (/^(?:1\/2|semi ?finals?|demi finales?)$/.test(name)) return "semi";
  if (/^(?:third place|match for third place|match pour la troisieme place|bronze)$/.test(name)) return "third";
  if (/^(?:final|finale)$/.test(name)) return "final";
  return null;
}

const teamName = (value) => normalizeText(value).trim().replace(/\s+/g, " ");
const teamKey = (team) => team?.id ? "id:" + team.id : "name:" + teamName(team?.name);
const scorePair = (a, b) => Number.isInteger(a) && a >= 0 && Number.isInteger(b) && b >= 0 ? [a, b] : null;
const dateOrder = (a, b) => (a.date || "9999").localeCompare(b.date || "9999") || (a.number || 0) - (b.number || 0) || String(a.key).localeCompare(String(b.key));

/** Add match links and crests only for a unique exact date/team match. */
export function attachNativeMatches(matches, nativeMatches) {
  const byFixture = new Map();
  for (const match of nativeMatches || []) {
    const home = match.home_team || match.home, away = match.away_team || match.away;
    if (!match.id || !match.date || !home?.name || !away?.name) continue;
    const key = [match.date, teamName(home.name), teamName(away.name)].join("|");
    const values = byFixture.get(key) || [];
    values.push(match);
    byFixture.set(key, values);
  }
  return (matches || []).map((match) => {
    const key = [match.date, teamName(match.home), teamName(match.away)].join("|");
    const found = byFixture.get(key);
    if (!match.date || found?.length !== 1) return match;
    const native = found[0], home = native.home_team || native.home, away = native.away_team || native.away;
    return { ...match, id: native.id, homeImage: home.image_url || home.imageUrl, awayImage: away.image_url || away.imageUrl };
  });
}

/** Combine both legs of a European tie, always scoring in the displayed team order. */
export function nativeKnockoutMatches(matches, rounds) {
  const ties = new Map();
  for (const match of matches || []) {
    const roundName = rounds?.[match.id]?.name;
    const stage = knockoutStage(roundName);
    const home = match.home_team || match.home, away = match.away_team || match.away;
    if (!stage || !home?.name || !away?.name) continue;
    const a = teamKey(home), b = teamKey(away);
    if (!a || !b || a === b) continue;
    const key = stage + ":" + [a, b].sort().join("|");
    if (!ties.has(key)) ties.set(key, { key, stage, roundName, games: [] });
    ties.get(key).games.push({ match, home, away, a, b });
  }
  return [...ties.values()].flatMap((tie) => {
    const games = tie.games.sort((a, b) => dateOrder({ date: a.match.date, key: a.match.id }, { date: b.match.date, key: b.match.id }));
    if (games.length > 2) return [];
    const first = games[0], firstHome = first.a;
    const legs = games.map(({ match, home, away, a }) => {
      const finished = match.status === "finished" || match.finished === true;
      const raw = finished ? scorePair(match.score_home ?? home.score, match.score_away ?? away.score) : null;
      const score = raw && a !== firstHome ? [raw[1], raw[0]] : raw;
      return { id: match.id, date: match.date || "", home: home.name, away: away.name, score, status: finished ? "finished" : "scheduled" };
    });
    const complete = legs.every((leg) => leg.status === "finished" && leg.score) && (tie.stage === "final" ? legs.length === 1 : legs.length === 2);
    const score = complete ? legs.reduce((sum, leg) => [sum[0] + leg.score[0], sum[1] + leg.score[1]], [0, 0]) : null;
    return [{ key: tie.key, id: tie.stage === "final" && legs.length === 1 ? legs[0].id : null, date: first.match.date || "", home: first.home.name, away: first.away.name, homeImage: first.home.image_url || first.home.imageUrl, awayImage: first.away.image_url || first.away.imageUrl, roundName: tie.roundName, score, penalties: null, status: complete ? "finished" : "scheduled", legs: tie.stage === "final" ? [] : legs }];
  });
}

function winner(match) {
  const pair = match.penalties && match.penalties[0] !== match.penalties[1] ? match.penalties : match.score;
  if (!pair || pair[0] === pair[1]) return null;
  return teamName(pair[0] > pair[1] ? match.home : match.away);
}
function predecessor(name, previous, used) {
  const reference = /^(?:winner|vainqueur)\s+(?:of\s+)?match\s*(\d+)$/i.exec(String(name).trim());
  const target = teamName(name);
  const candidates = previous.filter((match) => {
    if (used.has(match.key)) return false;
    if (reference) return match.number === Number(reference[1]);
    if (match.status !== "finished" || !target) return false;
    const won = winner(match);
    return won ? won === target : [teamName(match.home), teamName(match.away)].includes(target);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

/** Connect rounds only when the source makes every displayed crossing unambiguous. */
export function buildKnockoutBracket(matches) {
  const groups = new Map(), thirdPlace = [];
  for (const match of matches || []) {
    const stage = knockoutStage(match.roundName || match.round);
    if (!stage) continue;
    if (stage === "third") { thirdPlace.push(match); continue; }
    const rows = groups.get(stage) || [];
    rows.push(match);
    groups.set(stage, rows);
  }
  let rounds = STAGES.filter((stage) => groups.has(stage.key)).map((stage) => ({ ...stage, matches: [...groups.get(stage.key)].sort(dateOrder) }));
  let preliminary = null;
  if (rounds.length > 1 && rounds[0].key === "round32" && rounds[1].key === "round16" && rounds[0].matches.length === rounds[1].matches.length && rounds[0].matches.some((match) => match.legs?.length)) {
    preliminary = { ...rounds[0], label: "Barrages" };
    rounds = rounds.slice(1);
  }
  const ordered = rounds.map((round) => ({ ...round, matches: [...round.matches] }));
  let connected = ordered.length > 1;
  for (let index = ordered.length - 1; connected && index > 0; index--) {
    const current = ordered[index].matches, previous = ordered[index - 1].matches;
    if (previous.length !== current.length * 2) { connected = false; break; }
    const used = new Set(), reordered = [];
    for (const match of current) {
      for (const name of [match.home, match.away]) {
        const found = predecessor(name, previous, used);
        if (!found) { connected = false; break; }
        used.add(found.key);
        reordered.push(found);
      }
      if (!connected) break;
    }
    if (connected) ordered[index - 1].matches = reordered;
  }
  return { rounds: connected ? ordered : rounds, connected, preliminary, thirdPlace: thirdPlace.sort(dateOrder) };
}

export function bracketWinner(match) { return winner(match); }
export function bracketTeamLabel(name) {
  return String(name || "À déterminer")
    .replace(/^Winner Match (\d+)$/i, "Vainqueur match $1")
    .replace(/^Winner Group ([A-Z])$/i, "1er groupe $1")
    .replace(/^3rd Group /i, "3e groupe ");
}

/** Combine only explicitly identified, reversed home-and-away cup ties. */
export function combineCupLegs(matches) {
  const groups = new Map();
  for (const match of matches || []) {
    const stage = knockoutStage(match.roundName || match.round);
    if (!stage || stage === "final" || stage === "third") continue;
    const names = [teamName(match.home), teamName(match.away)];
    if (!names[0] || !names[1] || names[0] === names[1]) continue;
    const key = stage + ":" + [...names].sort().join("|");
    const rows = groups.get(key) || [];
    rows.push(match);
    groups.set(key, rows);
  }
  const replacements = new Map(), omitted = new Set();
  for (const rows of groups.values()) {
    if (rows.length !== 2) continue;
    const [first, second] = [...rows].sort(dateOrder);
    if (!first.date || !second.date || first.date === second.date || teamName(first.home) !== teamName(second.away) || teamName(first.away) !== teamName(second.home)) continue;
    const legs = [first, second].map((match, index) => ({
      date: match.date, home: match.home, away: match.away, status: match.status,
      score: match.score ? (index === 1 ? [match.score[1], match.score[0]] : match.score) : null,
    }));
    const complete = legs.every((leg) => leg.status === "finished" && leg.score);
    const score = complete ? legs.reduce((sum, leg) => [sum[0] + leg.score[0], sum[1] + leg.score[1]], [0, 0]) : null;
    const penalties = second.penalties ? [second.penalties[1], second.penalties[0]] : null;
    replacements.set(first.key, { ...first, score, penalties, legs, status: complete ? "finished" : "scheduled" });
    omitted.add(second.key);
  }
  return (matches || []).flatMap((match) => omitted.has(match.key) ? [] : [replacements.get(match.key) || match]);
}

/** Preserve individual games when a newly discovered cup has no leg format. */
export function nativeSingleKnockoutMatches(matches, rounds) {
  return (matches || []).flatMap((match) => {
    const roundName = rounds?.[match.id]?.name;
    const home = match.home_team || match.home, away = match.away_team || match.away;
    if (!knockoutStage(roundName) || !home?.name || !away?.name) return [];
    const finished = match.status === "finished" || match.finished === true;
    return [{ key: "native:" + match.id, id: match.id, date: match.date || "", home: home.name, away: away.name, homeImage: home.image_url || home.imageUrl, awayImage: away.image_url || away.imageUrl, roundName, score: finished ? scorePair(match.score_home ?? home.score, match.score_away ?? away.score) : null, status: finished ? "finished" : "scheduled" }];
  });
}

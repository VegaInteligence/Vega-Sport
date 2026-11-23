/**
 * The archived seasons of the five big leagues, 2010/11 to 2020/21 (before PitchAPI's first, 2021/22), as the
 * competition page shows them: the table computed from the archived results, its colours as facts (Europe and
 * relegation the next season), the matchdays and the season in four lines. Pure: routes/league-history.mjs reads.
 * Tests: test/league-history-logic.test.mjs.
 */

export const FIRST_SEASON = 2010;
export const LAST_SEASON = 2020;

// PitchAPI key → the archive's spelling of the league: openfootball's code, engsoccerdata's folder where it holds
// some of these seasons (LaLiga 2010–2011, Serie A 2010–2012, Ligue 1 2010–2013); the tie rule; relegation by rule.
export const HISTORY_LEAGUES = {
  l_4WFCIZ: { name: "Premier League", code: "en.1", tie: "gd", down: () => ({ down: 3 }) },
  l_0ErfuF: { name: "LaLiga", code: "es.1", folder: "spain", tie: "h2h", down: () => ({ down: 3 }) },
  l_1Isor4: { name: "Bundesliga", code: "de.1", tie: "gd", down: () => ({ down: 2, playoff: 16 }) },
  l_0ALvwF: { name: "Serie A", code: "it.1", folder: "italy", tie: "h2h", down: () => ({ down: 3 }) },
  // Ligue 1: the 18th's play-off from 2017/18; 2019/20, stopped, relegated two and played none.
  l_3FJFUl: {
    name: "Ligue 1", code: "fr.1", folder: "france", tie: "gd",
    down: (start) => (start === 2019 ? { down: 2 } : start >= 2017 ? { down: 2, playoff: 18 } : { down: 3 }),
  },
};

// Points the leagues took away, by club as the archive names it (Wikipedia's season pages, read 23 Nov 2026, and
// the press for Serie A 2018/19). None in the other leagues and seasons.
export const DEDUCTIONS = {
  "l_0ALvwF:2010": { Bologna: 3 },
  "l_0ALvwF:2011": { Atalanta: 6 },
  "l_0ALvwF:2012": { Atalanta: 2, Siena: 6, Sampdoria: 1, Torino: 1 },
  "l_0ALvwF:2014": { Parma: 7 },
  "l_0ALvwF:2018": { Chievo: 3 },
};

/** The season's start year when `season` ("2015/2016") is an archived season of `league`, else null. */
export function historySeason(league, season) {
  if (!Object.hasOwn(HISTORY_LEAGUES, league)) return null;
  const m = /^(\d{4})\/(\d{4})$/.exec(season || "");
  if (!m || Number(m[2]) !== Number(m[1]) + 1) return null;
  const start = Number(m[1]);
  return start >= FIRST_SEASON && start <= LAST_SEASON ? start : null;
}

/** The archive keys that may hold the league's season, openfootball's first. */
export function editionKeys(league, start) {
  const l = HISTORY_LEAGUES[league];
  const keys = [`${start}-${String(start + 1).slice(2)}/${l.code}`];
  if (l.folder) keys.push(`engsoccerdata/${l.folder}/all/${start}`);
  return keys;
}

const fold = (name) => String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const scored = (m) => Number.isInteger(m.homeScore) && Number.isInteger(m.awayScore);

/** A deduction applies to the club whose archived name holds the deduction's name as a word ("Atalanta BC"). */
function deductionOf(deductions, name) {
  const words = ` ${fold(name)} `;
  for (const [club, points] of Object.entries(deductions || {})) if (words.includes(` ${fold(club)} `)) return points;
  return 0;
}

function tally(matches) {
  const rows = new Map();
  const row = (team) => {
    if (!rows.has(team.key)) rows.set(team.key, { team, played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 });
    return rows.get(team.key);
  };
  for (const m of matches) {
    const home = row(m.home), away = row(m.away);
    if (!scored(m)) continue;
    for (const [r, gf, ga] of [[home, m.homeScore, m.awayScore], [away, m.awayScore, m.homeScore]]) {
      r.played += 1; r.goalsFor += gf; r.goalsAgainst += ga;
      if (gf > ga) { r.wins += 1; r.points += 3; } else if (gf === ga) { r.draws += 1; r.points += 1; } else r.losses += 1;
    }
  }
  return rows;
}

const byGoals = (a, b) => (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor;

/** The final table: [{rank, team, played, wins, draws, losses, goalsFor, goalsAgainst, points, deduction?}]. */
export function standings(matches, { league, start }) {
  const rows = [...tally(matches).values()];
  const deductions = DEDUCTIONS[`${league}:${start}`];
  for (const r of rows) {
    const d = deductionOf(deductions, r.team.name);
    if (d) { r.points -= d; r.deduction = d; }
  }
  const perMatch = league === "l_3FJFUl" && start === 2019;
  const value = (r) => (perMatch ? (r.played ? r.points / r.played : 0) : r.points);
  rows.sort((a, b) => value(b) - value(a) || byGoals(a, b) || a.team.name.localeCompare(b.team.name));
  if (HISTORY_LEAGUES[league]?.tie === "h2h") {
    // The clubs level on points: their matches among themselves first (points, then goal difference, then goals).
    for (let i = 0; i < rows.length;) {
      let j = i + 1;
      while (j < rows.length && value(rows[j]) === value(rows[i])) j++;
      if (j - i > 1) {
        const level = rows.slice(i, j), keys = new Set(level.map((r) => r.team.key));
        const mini = tally(matches.filter((m) => keys.has(m.home.key) && keys.has(m.away.key)));
        const h = (r) => mini.get(r.team.key) || { points: 0, goalsFor: 0, goalsAgainst: 0 };
        level.sort((a, b) => h(b).points - h(a).points || byGoals(h(a), h(b)) || byGoals(a, b) || a.team.name.localeCompare(b.team.name));
        rows.splice(i, level.length, ...level);
      }
      i = j;
    }
  }
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

const ident = (team) => team.id || team.key;

// Legal-form and filler words the editions add or drop around a club's name.
const FORMS = new Set(["fc", "cf", "sc", "ac", "as", "ssc", "afc", "sl", "sv", "vfl", "bv", "rc", "rcd", "ogc", "losc", "osc", "cd", "ud",
  "sd", "us", "ss", "fk", "kv", "pfc", "club", "de", "the"]);

/** A club's name as the editions agree on it: the country tag (« (FRA) ») and legal-form words dropped, folded. */
export function clubName(name) {
  const words = fold(String(name || "").replace(/\s*\([A-Z]{3}\)\s*$/, "")).split(" ").filter((w) => w && !FORMS.has(w) && !/^\d+$/.test(w));
  return words.join(" ");
}

/**
 * Each row with its colour: the European competition the club played the next season, else its relegation. `next`:
 * the next season's {league, cl, el, ecl}, sets of club ids (a club without one: its name, folded).
 */
export function zones(table, { league, start, next }) {
  const names = (team) => [team.name, ...(team.names || [])].map(clubName).filter(Boolean);
  const has = (set, team) => Boolean(set) && (set.has(ident(team)) || set.has(team.key) || names(team).some((n) => set.has(n)));
  const rule = HISTORY_LEAGUES[league].down(start);
  const n = table.length;
  const absent = table.filter((r) => !has(next.league, r.team));
  const plausible = next.league && next.league.size > 0 && absent.length >= rule.down && absent.length <= rule.down + 1
    && absent.every((r) => r.rank > n / 2);
  const down = new Set((plausible ? absent : table.slice(n - rule.down)).map((r) => r.team.key));
  return table.map((r) => {
    let zone = null;
    if (down.has(r.team.key)) zone = "relegation";
    else if (has(next.cl, r.team)) zone = "cl";
    else if (has(next.el, r.team)) zone = "el";
    else if (has(next.ecl, r.team)) zone = "ecl";
    else if (rule.playoff && r.rank === rule.playoff) zone = "relegation-po";
    return { ...r, zone };
  });
}

const roundNumber = (round) => {
  const m = /^(?:matchday|journ[ée]e|round|spieltag|giornata|jornada)?\s*(\d{1,2})$/i.exec(String(round || "").trim());
  return m ? Number(m[1]) : null;
};

/** The season's matches by matchday ([{key, number, matches}]), or by month ([{key, month, matches}]) when most carry
 * no round number; each group by day. */
export function matchdays(matches) {
  const numbered = matches.filter((m) => roundNumber(m.round) != null).length;
  const byRound = matches.length > 0 && numbered >= matches.length * 0.9;
  const groups = new Map();
  for (const m of matches) {
    const key = byRound ? String(roundNumber(m.round) ?? 0) : String(m.date || "").slice(0, 7);
    if (!groups.has(key)) groups.set(key, byRound ? { key, number: Number(key), matches: [] } : { key, month: key, matches: [] });
    groups.get(key).matches.push(m);
  }
  const out = [...groups.values()].sort((a, b) => (byRound ? a.number - b.number : a.key.localeCompare(b.key)));
  for (const g of out) g.matches.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return out;
}

/** The season in four lines: champion, top scorer (`scorers` best first), goals per played match, relegated. */
export function summary(table, matches, scorers) {
  const played = matches.filter(scored);
  const goals = played.reduce((n, m) => n + m.homeScore + m.awayScore, 0);
  return {
    champion: table[0] ? { team: table[0].team, points: table[0].points } : null,
    topScorer: scorers[0] ? { name: scorers[0].name, goals: scorers[0].goals } : null,
    goalsPerMatch: played.length ? Math.round((goals / played.length) * 100) / 100 : null,
    relegated: table.filter((r) => r.zone === "relegation").map((r) => r.team),
  };
}

/** The players' file misses part of the season: its goals fall short of the scores by more than own goals explain
 * (2–3.5 % of goals in these leagues; Transfermarkt datasets' 2014/15 lists fewer than eleven players for some sides). */
export const playersIncomplete = (playerGoals, matchGoals) => matchGoals > 0 && playerGoals < matchGoals * 0.955;

export { fold };

/**
 * The nation pages (119, VI-18):
 *
 * GET /api/nations?season= — every national team that played a match the base holds: its
 * matches, its last match, its latest Elo, and its place in the season's nations power
 * ranking when it has one (`ranked`: how many nations that ranking holds).
 *
 * GET /api/nations/{id}?season= — one nation: its place in the season's ranking, its record
 * of the season, its Elo after each match, its matches (a match held twice, collected and
 * archived, once), its runs in the major tournaments (World Cup, Euro, Africa Cup of Nations…)
 * and the players of its latest edition with player statistics, with the club they last
 * played for; a match International Results gives the scorers of carries them (`scorers`, §57). A team that is no
 * national team is not served.
 */
import { stageKind, UNKNOWN_STAGE_LABEL } from "../../../../dashboard/shared/tournament-stages.js";
import { finalPoolPosition1950, WORLD_CUP_1950_EDITION } from "../../../../dashboard/shared/world-cup-1950.js";
import { reject, validateParams } from "../http.mjs";
import { createDataVersions } from "../data-versions.mjs";
import { scorersBy, withScorers } from "../international-goals.mjs";

const NATION = /^\/api\/nations\/(t_(?:[A-Za-z0-9]{6}|v\d{7}))$/;
// A fixture's team still to qualify, which a source files as a national team (the Euro 2028
// fixtures: « A1 », « Winner Group A », « 3rd Group A/B/C », « Winner Match 37 »).
const PLACEHOLDER = /^(?:[A-L][1-4]|(?:Winner|Runner-up|Loser|3rd|Third) (?:Group|Match)\b.*)$/;
export const placeholderTeam = (name) => PLACEHOLDER.test(String(name || "").trim());
const SEASON_KEY = "(SELECT season_id FROM api.season_keys WHERE season=$1)";

// The major tournaments: the key of their editions (cup or archive key) or the name of their
// collected competition, and the name the site gives them.
const TOURNAMENTS = [
  { key: "world-cup", label: "Coupe du monde", edition: /:world-cup(?:-history)?:(\d{4})$/, name: /^World Cup/ },
  { key: "euro", label: "Euro", edition: /:euro:(\d{4})$/, name: /^(?:Euro|European Championship)/ },
  { key: "afcon", label: "CAN", edition: /:afcon:(\d{4})$/, name: /^(?:Coupe d’Afrique des nations|Africa Cup of Nations)/ },
  { key: "copa-america", label: "Copa América", edition: /:copa-america:(\d{4})$/, name: /^Copa Am[ée]rica/ },
  { key: "asian-cup", label: "Coupe d’Asie", edition: /:asian-cup:(\d{4})$/, name: /^(?:AFC )?Asian Cup/ },
  { key: "gold-cup", label: "Gold Cup", edition: /:gold-cup:(\d{4})$/, name: /^(?:CONCACAF )?Gold Cup/ },
];

/** The tournament and year of a match, or null for a competition that is no major tournament. */
function tournamentOf(match) {
  for (const t of TOURNAMENTS) {
    const fromKey = match.edition && match.edition.match(t.edition);
    if (fromKey) return { tournament: t, year: Number(fromKey[1]) };
    // A collected edition carries no key: its year is the year it was played.
    if (!match.edition && t.name.test(match.competition || "") && match.date)
      return { tournament: t, year: Number(match.date.slice(0, 4)) };
  }
  return null;
}

/** The match from `teamId`'s side: "won", "lost" or null when the base cannot tell. */
function outcome(match, teamId) {
  if (match.status !== "finished") return null;
  const home = match.home?.id === teamId;
  const own = home ? match.homeScore : match.awayScore, other = home ? match.awayScore : match.homeScore;
  if (own == null || other == null) return null;
  if (own !== other) return own > other ? "won" : "lost";
  const ownPens = home ? match.homePenalties : match.awayPenalties, otherPens = home ? match.awayPenalties : match.homePenalties;
  if (ownPens == null || otherPens == null || ownPens === otherPens) return null;
  return ownPens > otherPens ? "won" : "lost";
}

const STAGES = {
  final: { won: ["Vainqueur", "gold"], lost: ["Finaliste", "silver"], null: ["Finale", null] },
  third: { won: ["3e", "bronze"], lost: ["4e", null], null: ["Match 3e place", null] },
  semi: "Demi", quarter: "Quarts", r16: "8es", r32: "16es", group: "1er tour", unknown: UNKNOWN_STAGE_LABEL,
};
const ORDER = ["unknown", "group", "r32", "r16", "quarter", "semi", "third", "final", "final-pool"];
const POOL_PLACES = [["Poule finale", null], ["Vainqueur", "gold"], ["2e", "silver"], ["3e", "bronze"], ["4e", null]];

function finalPoolStage(matches, teamId) {
  const pool = matches.filter((m) => m.edition === WORLD_CUP_1950_EDITION && stageKind(m.round) === "final-pool");
  const home = pool[0]?.home?.id === teamId;
  const team = (home ? pool[0]?.home : pool[0]?.away)?.name;
  if (!team || !pool.every((m) => m.status === "finished" && (m.home?.id === teamId && m.home.name === team ||
      m.away?.id === teamId && m.away.name === team))) return POOL_PLACES[0];
  const position = finalPoolPosition1950(pool.map((m) => ({
    date: m.date, home: m.home?.name, away: m.away?.name, score: [m.homeScore, m.awayScore],
  })), team);
  return POOL_PLACES[position ?? 0];
}

/**
 * A nation's runs in the major tournaments, oldest first: per edition, the stage its last match
 * reached and how it ended (a final or third-place match with no score claims nothing).
 * `matches`: the nation's matches ({date, competition, edition, round, home, away, scores}).
 */
export function tournamentRuns(matches, teamId) {
  const editions = new Map();
  for (const match of matches) {
    const of = tournamentOf(match);
    if (!of) continue;
    const key = `${of.tournament.key}:${of.year}`;
    if (!editions.has(key)) editions.set(key, { ...of, games: new Map() });
    // An edition held twice (collected and archived) counts each match once.
    const pair = [match.home?.id, match.away?.id].sort().join(":");
    const id = `${match.date || match.id}:${pair}`;
    const known = editions.get(key).games.get(id);
    if (!known || (known.homeScore == null && match.homeScore != null)) editions.get(key).games.set(id, match);
  }
  return [...editions.values()]
    .map(({ tournament, year, games }) => {
      const list = [...games.values()].sort(
        (a, b) => String(a.date || "").localeCompare(String(b.date || "")) || ORDER.indexOf(stageKind(a.round)) - ORDER.indexOf(stageKind(b.round)),
      );
      const last = list.findLast((match) => match.status !== "canceled");
      const kind = stageKind(last?.round);
      const stage = STAGES[kind];
      const [label, tone] = kind === "final-pool"
        ? tournament.key === "world-cup" && year === 1950 ? finalPoolStage(matches, teamId) : [UNKNOWN_STAGE_LABEL, null]
        : typeof stage === "string" ? [stage, null] : stage[outcome(last, teamId)];
      const out = { tournament: tournament.key, label: `${tournament.label} ${year}`, year, stage: label, matches: list.length, games: list };
      if (tone) out.tone = tone;
      return out;
    })
    .sort((a, b) => a.year - b.year || a.tournament.localeCompare(b.tournament));
}

/** The nation's played matches of `season` (finished, with a score): its record and goals. */
export function seasonRecord(matches, teamId, season) {
  const record = { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
  for (const match of matches) {
    if (match.season !== season || match.status !== "finished" || match.homeScore == null || match.awayScore == null) continue;
    const home = match.home?.id === teamId;
    const own = home ? match.homeScore : match.awayScore, other = home ? match.awayScore : match.homeScore;
    record.played++;
    record.goalsFor += own;
    record.goalsAgainst += other;
    if (own > other) record.wins++;
    else if (own < other) record.losses++;
    else record.draws++;
  }
  return record;
}

const num = (v) => (v == null ? null : Number(v));
const put = (o, k, v) => (v === null || v === undefined ? o : ((o[k] = v), o));

// Each path's statements' relations (FAILURE_MODES_OPTIMISATIONS.md GH137A); the bodies ({ data }) and former tags unchanged.
const NATIONS = ["api.nation_list", "api.season_keys", "api.power_clubs"];
const nations = (reads) => ({ family: "nations", data: true, ttl: 300, maxBytes: 2 * 1024 * 1024, reads });
export const NATIONS_SPEC = nations(NATIONS);
export const NATION_SPEC = nations([...NATIONS, "api.internal_id", "api.nation_matches", "api.nation_elo", "api.nation_players", "api.international_goals"]);

function seasonParam(params) {
  validateParams(params, ["season"]);
  const season = params.get("season");
  if (!/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
  return season;
}

export function nationOf(r) {
  const out = { id: r.team_id, name: r.name, imageUrl: r.image_url ?? null, matches: r.matches };
  put(out, "lastMatch", r.last_match ? String(r.last_match).slice(0, 10) : null);
  put(out, "elo", num(r.elo));
  if (r.rank != null)
    out.ranking = {
      rank: r.rank, elo: num(r.season_elo), eloChange: num(r.elo_change), matches: r.season_matches,
      wins: r.wins, draws: r.draws, losses: r.losses, results: num(r.result_sum), expected: num(r.expected_sum),
      provisional: r.provisional === true,
    };
  return out;
}

// « The season's other internationals » (nations-results:internationals:<season>): the file names each match's
// tournament (« Friendly », « FIFA World Cup qualification »…), stored as its round, and no stage (FAILURE_MODES §50).
const INTERNATIONALS = /^nations-results:internationals:/;

/** One match of the nation; a match of the season's other internationals under its tournament, with no round. */
export function matchOf(r) {
  const internationals = INTERNATIONALS.test(r.edition || "") && Boolean(r.round);
  const out = {
    date: r.match_date ? String(r.match_date).slice(0, 10) : null, season: r.season,
    competition: internationals ? r.round : r.competition,
    edition: r.edition ?? null, round: internationals ? null : r.round ?? null, status: r.status,
    home: { id: r.home_id, name: r.home_name, imageUrl: r.home_image ?? null },
    away: { id: r.away_id, name: r.away_name, imageUrl: r.away_image ?? null },
    homeScore: r.home_score, awayScore: r.away_score, homePenalties: r.home_penalties, awayPenalties: r.away_penalties,
  };
  // Only a collected match has its page on the site.
  if (r.collected) out.id = r.match_id;
  return out;
}

// The nations whose place in the season's world ranking is provisional (§51: fewer than 8 counted matches in four years).
async function provisionalOf(read, season) {
  const rows = await read(`SELECT team_key FROM api.power_clubs WHERE season_id=${SEASON_KEY} AND scope='nations' AND provisional`, [season]);
  return new Set(rows.map((r) => r.team_key));
}

export function createNationRoute(read, { versioned = createDataVersions(read) } = {}) {
  return async (req, path, params) => {
    if (path === "/api/nations") return versioned(req, params, NATIONS_SPEC, (guarded) => nationAnswer(guarded, path, params));
    return NATION.test(path) ? versioned(req, params, NATION_SPEC, (guarded) => nationAnswer(guarded, path, params)) : null;
  };
}

/** The answer of a path of this route, read with `read`. */
async function nationAnswer(read, path, params) {
  {
    if (path === "/api/nations") {
      const season = seasonParam(params);
      const [listed, flags] = await Promise.all([read(`SELECT * FROM api.nation_list(${SEASON_KEY})`, [season]), provisionalOf(read, season)]);
      const rows = listed.filter((r) => !placeholderTeam(r.name)).map((r) => ({ ...r, provisional: flags.has(r.team_key) }));
      const nations = rows.map(nationOf).sort((a, b) => (a.ranking?.rank ?? Infinity) - (b.ranking?.rank ?? Infinity) || (b.elo ?? -Infinity) - (a.elo ?? -Infinity) || a.name.localeCompare(b.name));
      return { season, ranked: nations.filter((n) => n.ranking).length, nations };
    }
    const nation = path.match(NATION);
    if (!nation) return null;
    const season = seasonParam(params);
    const [list, [key], flags] = await Promise.all([
      read(`SELECT * FROM api.nation_list(${SEASON_KEY})`, [season]),
      read("SELECT api.internal_id('team',$1) AS key", [nation[1]]),
      provisionalOf(read, season),
    ]);
    const found = key?.key == null ? null : list.find((r) => r.team_key === key.key && !placeholderTeam(r.name));
    const own = found && { ...found, provisional: flags.has(found.team_key) };
    if (!own) reject(404, "Ressource introuvable.");
    const [matchRows, eloRows, playerRows, goalRows] = await Promise.all([
      read("SELECT * FROM api.nation_matches($1::integer) ORDER BY match_date DESC NULLS LAST", [own.team_key]),
      read("SELECT * FROM api.nation_elo($1::integer)", [own.team_key]),
      read("SELECT * FROM api.nation_players($1::integer)", [own.team_key]),
      // The scorers of its International Results matches (§57), by the match's public id.
      read("SELECT * FROM api.international_goals WHERE home_key = $1::integer OR away_key = $1::integer", [own.team_key]),
    ]);
    const scorers = scorersBy(goalRows, (r) => r.match_id);
    const matches = matchRows.map((r) => withScorers(matchOf(r), scorers.get(r.match_id)));
    const data = {
      ...nationOf(own),
      season,
      ranked: list.filter((r) => r.rank != null && !placeholderTeam(r.name)).length,
      record: seasonRecord(matches, own.team_id, season),
      elo: eloRows.map((r) => ({ date: r.match_date ? String(r.match_date).slice(0, 10) : null, elo: num(r.elo), result: num(r.result) })),
      matches,
      tournaments: tournamentRuns(matches, own.team_id),
    };
    if (playerRows.length) {
      const first = playerRows[0];
      const of = tournamentOf({ competition: first.competition, edition: first.edition, date: first.last_date ? String(first.last_date).slice(0, 10) : null });
      data.players = {
        competition: of ? `${TOURNAMENTS.find((t) => t === of.tournament).label} ${of.year}` : first.competition,
        rows: playerRows.map((r) => {
          const p = { id: r.player_id, name: r.name, imageUrl: r.image_url ?? null, matches: r.matches, minutes: r.minutes, goals: r.goals, assists: r.assists };
          put(p, "xg", r.xg == null ? null : Math.round(Number(r.xg) * 100) / 100);
          if (r.club_id) p.club = { id: r.club_id, name: r.club_name, imageUrl: r.club_image ?? null };
          return p;
        }),
      };
    }
    return data;
  }
}

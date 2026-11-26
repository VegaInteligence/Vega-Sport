// After a Deploy (infra/aws/deploy.sh, its last step): the home's personal read, GET /api/read/home-favourites, as the
// site asks it, for a followed club, a followed player and both, through the distribution (FAILURE_MODES_OPTIMISATIONS.md,
// GH220.3; GH #220: with a followed player it answered 503 after 8 s). It says whom it follows (the source, never a name
// or an id), then one line per read; never a body.
//
//   node infra/aws/smoke-favourites.mjs https://<the read API's distribution> [--team t_… --player p_…]
//
// - The manifest and the home answer 200 with JSON of their form; another status, a body that is not JSON, another form,
//   the network after one more try: exit 1, the read and the reason named.
// - The only skip (exit 0): a manifest naming no season, confirmed by /api/health (never kept by the edge), which answers
//   503 "pending" while the base holds no edition: a base created and not yet filled.
// - Whom it follows: the pair given; else the home's player of the week and the team of his match; else the top of the
//   home's leaders (goals, then assists) and his club; else the same in the season the manifest lists after the default.
//   A base holding seasons and no player to follow: exit 1 (the three reads not covered).
// - What each answer must show: 200 (a statement finished within the read API's 8 s), private, its three lists and the
//   publication's generation; the club among the favourites with strength 1; the player of the week named by a favourite
//   (his club or his national team) and, when the base knows a club of his, his match of the week in « Vos joueurs »
//   (known by his national team only, or the answer's week another: said); another player named by the answer (a
//   favourite or « Vos joueurs »).
// - A visitor's list (GH220.4; GH #220 reopened: one club and one player passed while visitors' reads failed): a fourth
//   read follows the player and club above, then the home's leaders (goals, then assists) and their clubs, at most five
//   players and three clubs; each club a favourite with strength 1, each player named. The home naming no other player:
//   said, not asked. Every read whose Server-Timing gives the base's time fails past 3 000 ms.
const USAGE = "usage: node infra/aws/smoke-favourites.mjs https://<the read API's distribution> [--team t_… --player p_…]";
const TEAM = /^t_(?:[A-Za-z0-9]{6}|v\d{7})$/;
const PLAYER = /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/;
const SEASON = /^\d{4}(?:\/\d{4})?$/;
// The base's time a read may take (Server-Timing db;dur), and the size of a visitor's list the fourth read follows
// (FAILURE_MODES_OPTIMISATIONS.md GH220.4: production's old code took 29 s for three clubs and five players).
const DB_BUDGET_MS = 3000;
const MANY = { players: 5, clubs: 3 };

class Stop {
  constructor(code) {
    this.code = code;
  }
}
const say = (line) => console.log(line);
const fail = (what) => {
  say(`favourites: FAILED ${what}`);
  throw new Stop(1);
};
const skipped = (why) => {
  say(`favourites: skipped (${why})`);
  throw new Stop(0);
};
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function parseArguments([origin, ...rest]) {
  const given = {};
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    const name = flag?.slice(2);
    if (!["--team", "--player"].includes(flag) || value === undefined || Object.hasOwn(given, name)) return null;
    given[name] = value;
  }
  if (!/^https?:\/\/[^/?#\s]+\/?$/.test(origin || "")) return null;
  if (Object.hasOwn(given, "team") !== Object.hasOwn(given, "player")) return null;
  if (given.team !== undefined && !(TEAM.test(given.team) && PLAYER.test(given.player))) return null;
  return { base: origin.replace(/\/$/, ""), pair: given.team ? given : null };
}

// One GET, the network (no answer, a reset, 20 s without an answer) tried once more: its status, time, headers and JSON
// (undefined when the body is not JSON), or the network's error code.
async function get(base, path) {
  for (let attempt = 1; ; attempt++) {
    const started = performance.now();
    try {
      const response = await fetch(base + path, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { status: response.status, ms: Math.round(performance.now() - started), headers: response.headers, json };
    } catch (error) {
      if (attempt >= 2) return { network: String(error?.cause?.code || error?.name || "error").slice(0, 40) };
    }
  }
}
// Why an answer is not a JSON 200, or null. The API's error code is said (DATA_UNAVAILABLE…), never its body.
function unusable(r) {
  if (r.network) return `network (${r.network})`;
  const code = r.json?.error?.code;
  if (r.status !== 200) return `status ${r.status}${typeof code === "string" && /^[A-Z][A-Z_]{0,39}$/.test(code) ? ` ${code}` : ""}`;
  return r.json === undefined ? "not JSON" : null;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) {
    console.error(USAGE);
    throw new Stop(2);
  }
  const read = (path) => get(options.base, path);
  const bootstrap = async (what, path, form, shape) => {
    const r = await read(path);
    const why = unusable(r) ?? (form(r.json) ? null : `not its form (${shape})`);
    if (why) fail(`${what}: ${why}`);
    return r.json;
  };

  const manifest = await bootstrap(
    "the manifest",
    "/api/dashboard/manifest",
    (b) => isObject(b) && Array.isArray(b.seasons) && b.seasons.every((s) => isObject(s) && typeof s.id === "string")
      && (b.defaultSeason === null || typeof b.defaultSeason === "string"),
    "seasons, defaultSeason",
  );
  const ids = manifest.seasons.map((s) => s.id);
  if (!ids.length && manifest.defaultSeason === null) {
    const health = await read("/api/health");
    if (health.status === 503 && isObject(health.json) && health.json.status === "pending") skipped("the base holds no season");
    fail(`the manifest names no season, but /api/health does not say the base is empty (${health.network ? "network" : `status ${health.status}`})`);
  }
  const season = manifest.defaultSeason;
  if (!ids.includes(season)) fail("the manifest: its default season is not one of its seasons");
  if (!SEASON.test(season)) fail("the manifest: its default season is not a season's id");
  // The manifest lists its seasons latest first.
  const before = ids.slice(ids.indexOf(season) + 1).find((id) => SEASON.test(id)) ?? null;
  const home = async (s) =>
    (await bootstrap(`the home of ${s}`, `/api/read/home?season=${encodeURIComponent(s)}&leagues=all`, (b) => isObject(b) && isObject(b.data), "data")).data;

  const current = await home(season);
  let pick = null;
  // The home whose leaders the fourth read follows: the pick's season's.
  let picked = current;
  if (options.pair) pick = { season, source: `the club and the player given, in ${season}`, ...options.pair };
  else {
    const tried = [];
    for (const s of [season, before].filter(Boolean)) {
      const data = s === season ? current : await home(s);
      tried.push(s);
      picked = data;
      const star = data.potw;
      if (isObject(star) && PLAYER.test(star.playerId ?? "") && TEAM.test(star.teamId ?? "") && typeof star.matchId === "string") {
        pick = { season: s, source: `the player of the week of ${s} and the team of his match`, team: star.teamId, player: star.playerId,
          week: { match: star.matchId, date: typeof star.date === "string" ? star.date : null } };
        break;
      }
      const boards = isObject(data.leaders) ? data.leaders : {};
      const top = [boards.goals, boards.assists].flatMap((rows) => (Array.isArray(rows) ? rows : []))
        .find((row) => isObject(row) && PLAYER.test(row.playerId ?? "") && TEAM.test(row.teamId ?? ""));
      if (top) {
        pick = { season: s, source: `the top of the leaders of ${s} and his club`, team: top.teamId, player: top.playerId };
        break;
      }
    }
    if (!pick)
      fail(`no player to follow: ${tried.length > 1 ? `the homes of ${tried.join(" and ")} name` : `the home of ${tried[0]} names`} no player of the week and no leader${before ? "" : ", and the manifest no season before it"}`);
  }
  say(`favourites: following ${pick.source}`);

  const scope = `season=${encodeURIComponent(pick.season)}&leagues=all`;
  const cases = [
    ["club", { personalTeams: pick.team }],
    ["player", { personalPlayers: pick.player }],
    ["both", { personalTeams: pick.team, personalPlayers: pick.player }],
  ];
  let failed = 0;
  // Whether the base knows a club of the player of the week: the answer for him alone tells, the answer for both reuses it.
  const context = { clubKnown: false };
  for (const [name, followed] of cases) {
    const r = await read(`/api/read/home-favourites?${scope}&${new URLSearchParams(followed)}`);
    const { problems, checked, data, knows } = judge(r, followed, pick, context);
    if (name === "player") context.clubKnown = Boolean(knows);
    const db = budget(r, problems);
    const sizes = data ? ` favourites=${data.favourites.length} upcoming=${data.upcoming.length} yourPlayers=${data.yourPlayers.length}` : "";
    const outcome = problems.length ? ` FAILED: ${problems.join(", ")}` : ` checked: ${checked.join(", ")}`;
    say(`favourites ${name} ${r.network ? "network" : r.status} ${r.ms ?? "-"} ms db ${db ?? "?"} ms${sizes}${outcome}`);
    if (problems.length) failed++;
  }

  // A visitor's list (GH220.4): the pick, then the home's leaders (goals, then assists) and their clubs, each once.
  const boards = isObject(picked.leaders) ? picked.leaders : {};
  const rows = [{ playerId: pick.player, teamId: pick.team }, ...[boards.goals, boards.assists].flatMap((r) => (Array.isArray(r) ? r : []))]
    .filter((row) => isObject(row) && PLAYER.test(row.playerId ?? "") && TEAM.test(row.teamId ?? ""));
  const list = { players: [...new Set(rows.map((row) => row.playerId))].slice(0, MANY.players), clubs: [...new Set(rows.map((row) => row.teamId))].slice(0, MANY.clubs) };
  if (list.players.length < 2) say("favourites many not checked (the home names no other player)");
  else {
    const followed = { personalTeams: list.clubs.join(","), personalPlayers: list.players.join(",") };
    const r = await read(`/api/read/home-favourites?${scope}&${new URLSearchParams(followed)}`);
    const { problems, checked, data } = judgeMany(r, list);
    const db = budget(r, problems);
    const sizes = data ? ` favourites=${data.favourites.length} upcoming=${data.upcoming.length} yourPlayers=${data.yourPlayers.length}` : "";
    const outcome = problems.length ? ` FAILED: ${problems.join(", ")}` : ` checked: ${checked.join(", ")}`;
    say(`favourites many ${r.network ? "network" : r.status} ${r.ms ?? "-"} ms db ${db ?? "?"} ms${sizes}${outcome}`);
    if (problems.length) failed++;
  }
  return failed ? 1 : 0;
}

// The base's time the answer gives (Server-Timing db;dur), rounded, or null; past the budget, a problem.
function budget(r, problems) {
  const raw = /db;dur=([\d.]+)/.exec(r.headers?.get("server-timing") || "")?.[1];
  if (!raw) return null;
  const db = Math.round(Number(raw));
  if (db > DB_BUDGET_MS) problems.push(`db ${db} ms over ${DB_BUDGET_MS} ms`);
  return db;
}

// The answer's form (200 JSON, private, its three lists, the publication's generation): the problems and its data.
function form(r) {
  const why = unusable(r);
  if (why) return { problems: [why] };
  const body = r.json;
  const data = isObject(body) && isObject(body.data) ? body.data : null;
  const problems = [];
  if (!/^private\b/.test(r.headers.get("cache-control") || "")) problems.push("not private");
  if (!data) return { problems: [...problems, "no data"] };
  const missing = ["favourites", "upcoming", "yourPlayers"].filter((list) => !Array.isArray(data[list]));
  if (missing.length) return { problems: [...problems, missing.map((list) => `no ${list}`).join(", ")] };
  if (!(typeof body.meta?.generation === "string" && /^\d+$/.test(body.meta.generation))) problems.push("no generation");
  return { problems, data };
}

// The fourth read: each club a favourite with strength 1, each player named (a favourite or « Vos joueurs »).
function judgeMany(r, list) {
  const { problems, data } = form(r);
  if (problems.length) return { problems, checked: [], data };
  const favourites = data.favourites.filter(isObject);
  const mine = data.yourPlayers.filter(isObject);
  if (!list.clubs.every((team) => favourites.some((f) => f.teamId === team && f.strength === 1 && f.reason === "club")))
    problems.push("a club is not among the favourites with strength 1");
  const named = (player) => favourites.some((f) => Array.isArray(f.players) && f.players.includes(player)) || mine.some((p) => p.playerId === player);
  if (!list.players.every(named)) problems.push("a player is named nowhere");
  return { problems, checked: [`${list.clubs.length} clubs (strength 1)`, `${list.players.length} players named`], data };
}

// What one answer shows of what was followed: the problems (none: it passed), what was checked, its data when its form
// holds (for the sizes), and whether it knows a club of the player of the week.
function judge(r, followed, pick, context) {
  const { problems, data } = form(r);
  if (problems.length) return { problems, checked: [], data };

  const checked = [];
  const favourites = data.favourites.filter(isObject);
  const mine = data.yourPlayers.filter(isObject);
  const named = favourites.some((f) => Array.isArray(f.players) && f.players.includes(pick.player));
  if (followed.personalTeams) {
    if (favourites.some((f) => f.teamId === pick.team && f.strength === 1 && f.reason === "club")) checked.push("the club (strength 1)");
    else problems.push("the club is not among the favourites with strength 1");
  }
  let knows;
  if (followed.personalPlayers && pick.week) {
    if (named) checked.push("a favourite naming the player");
    else problems.push("no favourite names the player");
    // « Vos joueurs » starts from his non-national clubs (a player known by his national team only is not in it, as
    // GH220-g): it is asked for his match when the base knows a club of his, a favourite for his club or his entry there.
    knows = favourites.some((f) => f.reason === "player_club" && Array.isArray(f.players) && f.players.includes(pick.player))
      || mine.some((p) => p.playerId === pick.player);
    // It holds the matches of the answer's week. Another week (the week changed between the two reads, or the edge served
    // the home of the week before): said, not judged.
    const week = isObject(data.period) && typeof data.period.start === "string" && typeof data.period.end === "string" ? data.period : null;
    const elsewhere = Boolean(week && pick.week.date && (pick.week.date < week.start || pick.week.date > week.end));
    if (!(context.clubKnown || knows)) checked.push("his match of the week not checked (no club of his in the base)");
    else if (elsewhere) checked.push("his match of the week not checked (another week than the answer's)");
    else if (mine.some((p) => p.playerId === pick.player && Array.isArray(p.matches) && p.matches.some((m) => isObject(m) && m.matchId === pick.week.match)))
      checked.push("his match of the week");
    else problems.push("his match of the week is not in yourPlayers");
  } else if (followed.personalPlayers) {
    if (named || mine.some((p) => p.playerId === pick.player)) checked.push("the player named");
    else problems.push("the answer names the player nowhere");
  }
  return { problems, checked, data, knows };
}

let code;
try {
  code = await main();
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  code = error.code;
}
// Exit once what was said is written (a pipe is written asynchronously on macOS).
await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((done) => stream.write("", done))));
process.exit(code);

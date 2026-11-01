/** Scheduled Bun worker. Persistent publication is performed by GitHub Actions. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = process.argv.slice(2);
function argument(flag) {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}
const dataRoot = path.resolve(
  argument("--data-root") || path.join(appRoot, "../data"),
);
const now = new Date(argument("--now") || Date.now());
if (!Number.isFinite(now.getTime())) throw new Error("Invalid collection date");
const localDate = new Intl.DateTimeFormat("en", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "numeric",
}).formatToParts(now);
const year = Number(localDate.find((p) => p.type === "year").value),
  month = Number(localDate.find((p) => p.type === "month").value),
  start = month >= 7 ? year : year - 1;
const season = `${start}/${start + 1}`,
  archiveName = `europe_${start}_${start + 1}`;
const archive = path.join(dataRoot, "sources/pitchapi/archives", archiveName);
const base = new URL(
  process.env.PITCHAPI_BASE_URL || "https://api.pitchapi.dev/v1",
);
if (
  base.href !== "https://api.pitchapi.dev/v1" &&
  !(
    base.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(base.hostname)
  )
)
  throw new Error("Provider origin is not allowed");
const key = process.env.PITCHAPI_API_KEY;
if (!/^pk_(live|test)_[A-Za-z0-9_-]+$/.test(key || ""))
  throw new Error("Configure PITCHAPI_API_KEY in server secrets");
const countries = new Set(
  "ALB AND ARM AUT AZE BEL BIH BLR BUL CRO CYP CZE DEN ENG ESP EST FIN FRA FRO GEO GER DEU GIB GRE GRC HUN IRL ISL ISR ITA KAZ KOS XKX LIE LTU LUX LVA MDA MKD MLT MNE NED NLD NIR NOR POL POR ROU RUS SCO SMR SRB SUI CHE SVK SVN SWE TUR UKR WAL".split(
    " ",
  ),
);
const cups = new Set([
  "Champions League",
  "Europa League",
  "Conference League",
  "1. Lig",
  "World Cup",
]);
const endpoints = {
  match: "",
  events: "events",
  players: "players",
  shots: "shots",
  stats: "stats",
  lineups: "lineups",
  momentum: "momentum",
  h2h: "h2h",
  player_halves: "players/halves",
  advanced_teams: "advanced",
  advanced_players: "advanced/players",
  pass_networks: "advanced/network",
  heatmaps: "heatmaps",
};
let requests = 0,
  retries = 0,
  nextSlot = 0,
  pauseUntil = 0;
const interval =
  1000 /
  Math.max(
    1,
    Math.min(12, Number(process.env.PITCH_REQUESTS_PER_SECOND || 10)),
  );
async function request(endpoint) {
  for (let attempt = 0; attempt < 5; attempt++) {
    while (true) {
      const slot = Math.max(Date.now(), nextSlot, pauseUntil);
      nextSlot = slot + interval;
      if (slot > Date.now()) await Bun.sleep(slot - Date.now());
      if (Date.now() >= pauseUntil) break;
    }
    let response, body;
    try {
      requests++;
      response = await fetch(base.href + endpoint, {
        headers: {
          "X-API-KEY": key,
          Accept: "application/json",
          "User-Agent": "Orion-Football-Ranking/1.0",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      body = await response.json();
    } catch {
      if (attempt === 4) throw new Error("Provider request failed");
      retries++;
      await Bun.sleep(1000 * 2 ** attempt);
      continue;
    }
    if (
      response.status === 401 ||
      (response.status === 403 &&
        ["UNAUTHORIZED", "FORBIDDEN"].includes(body?.error?.code))
    )
      throw new Error("PitchAPI authentication failed");
    if (response.status === 429 || response.status >= 500) {
      if (attempt === 4)
        throw new Error(`Provider transient failure ${response.status}`);
      const header = response.headers.get("retry-after");
      const delay =
        header !== null && Number.isFinite(Number(header))
          ? Math.max(0, Number(header) * 1000)
          : Math.max(0, Date.parse(header) - Date.now()) || 1000 * 2 ** attempt;
      pauseUntil = Math.max(pauseUntil, Date.now() + delay);
      retries++;
      await Bun.sleep(delay);
      continue;
    }
    if (response.ok && !(body && Object.hasOwn(body, "data")))
      throw new Error("Provider response has no data envelope");
    const value = {
      status: response.status,
      data: body.data ?? null,
      error: body.error ?? null,
    };
    if (JSON.stringify(value).includes(key))
      throw new Error("Credential echoed by provider; refusing persistence");
    return value;
  }
}
async function read(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function write(file, value) {
  const body = JSON.stringify(value);
  if (/pk_(?:test|live)_[A-Za-z0-9_-]+/.test(body))
    throw new Error("Credential-like response rejected");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + ".tmp", body);
  await fs.rename(file + ".tmp", file);
}
async function python(action) {
  const child = Bun.spawn(
    [
      process.env.PITCH_PYTHON || "python3",
      path.join(appRoot, "scripts/publish_daily.py"),
      action,
      "--data-root",
      dataRoot,
      "--archive",
      archiveName,
    ],
    { cwd: appRoot, env: process.env, stdout: "inherit", stderr: "inherit" },
  );
  if ((await child.exited) !== 0) throw new Error(`Daily ${action} failed`);
}
async function pool(jobs, action, concurrency = 4) {
  let cursor = 0,
    failed;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (!failed) {
        const index = cursor++;
        if (index >= jobs.length) return;
        try {
          await action(jobs[index]);
        } catch (error) {
          failed = error;
        }
      }
    }),
  );
  if (failed) throw failed;
}
const catalog = await request("/leagues");
if (catalog.status !== 200 || !Array.isArray(catalog.data?.leagues))
  throw new Error("Invalid league catalogue");
const selected = catalog.data.leagues
  .filter(
    (l) =>
      countries.has(l.country_code) ||
      (["INT", "INT-2"].includes(l.country_code) && cups.has(l.name)),
  )
  .map((l) => ({
    ...l,
    season: l.seasons?.includes(season)
      ? season
      : l.seasons?.includes(String(year))
        ? String(year)
        : null,
  }))
  .filter((l) => l.season);
if (!selected.length)
  throw new Error("No ongoing European seasons in catalogue");
if (selected.some((l) => !/^l_[A-Za-z0-9]{6}$/.test(l.id)))
  throw new Error("Invalid competition ID");
if (args.includes("--plan")) {
  console.log(
    JSON.stringify(
      {
        season,
        competitions: selected.map((l) => ({
          id: l.id,
          name: l.name,
          season: l.season,
        })),
        schedule: "00:00 Europe/Paris",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
await python("restore");
const previous = await read(path.join(archive, "inventory.json"));
const competitions = [];
await pool(selected, async (league) => {
  const result = await request(
    `/leagues/${league.id}/matches?season=${encodeURIComponent(league.season)}&status=all`,
  );
  if (result.status !== 200 || !Array.isArray(result.data?.matches))
    throw new Error(`Invalid inventory ${league.id}`);
  if (
    !result.data.matches.length &&
    previous?.competitions.some((c) => c.id === league.id && c.matches.length)
  )
    throw new Error(`Inventory unexpectedly empty ${league.id}`);
  competitions.push({
    id: league.id,
    name: league.name,
    country_code: league.country_code,
    season: league.season,
    status: 200,
    response_valid: true,
    matches: result.data.matches,
  });
});
competitions.sort((a, b) => a.id.localeCompare(b.id));
const receipt = {
  startedAt: now.toISOString(),
  completedAt: null,
  season,
  schedule: "00:00 Europe/Paris",
  competitions: competitions.length,
  matchesUpdated: 0,
  fixturesUpdated: 0,
  profilesUpdated: 0,
  requests: 0,
  retries: 0,
};
const profileIds = {
  leagues: new Set(competitions.map((c) => c.id)),
  teams: new Set(),
  players: new Set(),
};
function gather(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) gather(item);
    return;
  }
  for (const [field, child] of Object.entries(value)) {
    if (
      (field === "id" || field === "player_id") &&
      /^p_[A-Za-z0-9]{6}$/.test(child || "")
    )
      profileIds.players.add(child);
    else if (child && typeof child === "object") gather(child);
  }
}
const jobs = competitions.flatMap((c) =>
  c.matches.map((fixture) => ({ c, fixture })),
);
await pool(jobs, async ({ c, fixture }) => {
  if (!/^m_[A-Za-z0-9]{6}$/.test(fixture.id))
    throw new Error("Invalid fixture ID");
  for (const team of [fixture.home_team, fixture.away_team])
    if (/^t_[A-Za-z0-9]{6}$/.test(team?.id || ""))
      profileIds.teams.add(team.id);
  const finished = fixture.status === "finished";
  const file = path.join(
    archive,
    finished ? "matches" : "fixtures",
    c.id,
    `${fixture.id}--${Buffer.from(fixture.id).toString("hex")}.json`,
  );
  const previous =
      (await read(file)) ||
      (await read(path.join(path.dirname(file), fixture.id + ".json"))),
    time = Date.parse(fixture.time_utc || fixture.date);
  const age = now.getTime() - time;
  const recent =
    Number.isFinite(age) && age >= -86400000 && age <= 3 * 86400000;
  const near = Number.isFinite(age) && age >= -2 * 86400000 && age <= 86400000;
  if (
    finished &&
    previous?.complete &&
    !recent &&
    JSON.stringify(previous.fixture) === JSON.stringify(fixture) &&
    Object.keys(endpoints).every((k) => previous.endpoints?.[k])
  )
    return;
  if (!finished && !near) return;
  const responses = { ...(previous?.endpoints || {}) };
  for (const [name, suffix] of Object.entries(
    finished ? endpoints : { match: "", lineups: "lineups", h2h: "h2h" },
  ))
    responses[name] = await request(
      `/matches/${fixture.id}${suffix ? "/" + suffix : ""}`,
    );
  gather(responses);
  await write(file, {
    competition_id: c.id,
    competition_name: c.name,
    country_code: c.country_code,
    season: c.season,
    fixture,
    retrieved_at_utc: now.toISOString(),
    complete: true,
    endpoints: responses,
  });
  if (finished) receipt.matchesUpdated++;
  else receipt.fixturesUpdated++;
});
const profileJobs = Object.entries(profileIds).flatMap(([kind, ids]) =>
  [...ids].map((id) => ({ kind, id })),
);
await pool(profileJobs, async ({ kind, id }) => {
  const file = path.join(
    archive,
    "profiles",
    kind,
    `${id}--${Buffer.from(id).toString("hex")}.json`,
  );
  const existing = await read(file);
  if (
    [200, 403, 404].includes(existing?.status) &&
    now.getTime() - Date.parse(existing.retrieved_at_utc || "") < 7 * 86400000
  )
    return;
  const result = await request(`/${kind}/${id}`);
  if (result.status === 200 && result.data?.id !== id)
    throw new Error("Profile identity mismatch");
  await write(file, {
    ...result,
    resource_id: id,
    retrieved_at_utc: now.toISOString(),
  });
  receipt.profilesUpdated++;
});
receipt.completedAt = new Date().toISOString();
receipt.requests = requests;
receipt.retries = retries;
await write(path.join(archive, "catalogue.json"), {
  ...catalog.data,
  leagues: catalog.data.leagues.map((league) => ({
    ...league,
    seasons: (league.seasons || []).filter(
      (value) => Number(String(value).slice(0, 4)) >= 2024,
    ),
  })),
});
await write(path.join(archive, "inventory.json"), {
  retrieved_at_utc: now.toISOString(),
  competitions,
});
await write(path.join(archive, "daily-receipt.json"), receipt);
await python("publish");
console.log(
  `Daily refresh complete: ${receipt.matchesUpdated} matches, ${receipt.fixturesUpdated} upcoming details, ${receipt.requests} requests.`,
);

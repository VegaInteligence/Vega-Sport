import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { historyYears, inHistoryScope } from "./history_scope.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const args = process.argv.slice(2);
const historical = args.includes("--history");
const scopedYears = historical ? historyYears(args) : null;
const dataRoot = path.join(
  root,
  "data",
  "sources",
  "pitchapi",
  "archives",
  historical ? "europe_2021_2026" : "europe_2026_2027",
);
const currentDataRoot = path.join(
  root,
  "data",
  "sources",
  "pitchapi",
  "archives",
  "europe_2026_2027",
);
// Include UEFA associations even if they are not yet in the provider catalogue.
const europeanCodes = new Set(
  "ALB AND ARM AUT AZE BEL BIH BLR BUL CRO CYP CZE DEN ENG ESP EST FIN FRA FRO GEO GER DEU GIB GRE GRC HUN IRL ISL ISR ITA KAZ KOS XKX LIE LTU LUX LVA MDA MKD MLT MNE NED NLD NIR NOR POL POR ROU RUS SCO SMR SRB SUI CHE SVK SVN SWE TUR UKR WAL".split(
    " ",
  ),
);
const extraLeagues = new Set([
  "Champions League",
  "Europa League",
  "Conference League",
  "1. Lig",
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
const inventoryOnly = args.includes("--inventory-only");
const matchesOnly = args.includes("--matches-only");
const refreshDetails = args.includes("--refresh-details");
const retryUnavailable = args.includes("--retry-unavailable");
const concurrency = Math.max(1, Number(process.env.PITCH_CONCURRENCY || 12));
const minInterval =
  1000 / Math.max(1, Number(process.env.PITCH_REQUESTS_PER_SECOND || 11.5));
const limit = Number(
  args.find((a) => a.startsWith("--limit="))?.split("=")[1] || 0,
);
let nextRequest = 0,
  pauseUntil = 0,
  pauseVersion = 0,
  throttled = 0,
  completed = 0,
  failed = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profileFilename = (id) =>
  `${id}--${Buffer.from(id, "utf8").toString("hex")}.json`;
const matchFilename = (id) =>
  historical
    ? `${id}--${Buffer.from(id, "utf8").toString("hex")}.json`
    : `${id}.json`;
async function waitForSlot() {
  while (true) {
    const version = pauseVersion,
      now = Date.now(),
      slot = Math.max(now, nextRequest, pauseUntil);
    nextRequest = slot + minInterval;
    if (slot > now) await sleep(slot - now);
    // A new rate-limit pause invalidates previously reserved slots.
    if (version === pauseVersion && Date.now() >= pauseUntil) return;
  }
}
function gatherPlayerIds(value, ids) {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    for (const [name, child] of Object.entries(item)) {
      if (
        (name === "id" || name === "player_id") &&
        typeof child === "string" &&
        /^p_[A-Za-z0-9]{6}$/.test(child)
      )
        ids.add(child);
      else if (child && typeof child === "object") pending.push(child);
    }
  }
}

async function atomicJson(file, value) {
  const body = JSON.stringify(value);
  if (body.includes(key))
    throw new Error("Credential found in response: refusing to save.");
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, file);
}

let key = process.env.PITCHAPI_API_KEY;
if (!key) {
  const envFile = await fs.readFile(path.join(root, "dashboard/.env"), "utf8");
  key = envFile.match(/^\s*PITCHAPI_API_KEY\s*=\s*["']?([^\s"']+)/m)?.[1];
}
if (!/^pk_(live|test)_[\w-]+$/.test(key || ""))
  throw new Error("Set PITCHAPI_API_KEY in .env or the environment.");

async function request(apiPath) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await waitForSlot();
    try {
      const response = await fetch("https://api.pitchapi.dev/v1" + apiPath, {
        headers: { "X-API-KEY": key },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (response.status === 401) throw new Error("AUTHENTICATION_FAILED");
      if (response.status === 403) {
        let body;
        try {
          body = await response.json();
        } catch {}
        if (body?.error?.code === "UNAUTHORIZED")
          throw new Error("AUTHENTICATION_FAILED");
        if (body?.error?.code === "PLAN_UPGRADE_REQUIRED") {
          const { data, error, ...extra } = body;
          return {
            status: 403,
            data: data ?? null,
            error,
            ...(Object.keys(extra).length ? { extra } : {}),
          };
        }
        const seconds =
          Number(response.headers.get("retry-after")) ||
          Math.min(30, 2 ** attempt);
        pauseUntil = Math.max(pauseUntil, Date.now() + seconds * 1000);
        pauseVersion++;
        await sleep(seconds * 1000);
        if (attempt === 4)
          return { status: null, data: null, error: { code: "ACCESS_DENIED" } };
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        if (response.status === 429) throttled++;
        const seconds =
          Number(response.headers.get("retry-after")) ||
          Math.min(30, 2 ** attempt);
        pauseUntil = Math.max(pauseUntil, Date.now() + seconds * 1000);
        pauseVersion++;
        await sleep(seconds * 1000);
        continue;
      }
      const body = await response.json();
      const { data, error, ...extra } = body;
      return {
        status: response.status,
        data: data ?? null,
        error: error ?? null,
        ...(Object.keys(extra).length ? { extra } : {}),
      };
    } catch (error) {
      if (error.message === "AUTHENTICATION_FAILED") throw error;
      if (attempt === 4)
        return { status: null, data: null, error: { code: "REQUEST_FAILED" } };
      await sleep(Math.min(30000, 1000 * 2 ** attempt));
    }
  }
  return { status: null, data: null, error: { code: "RETRIES_EXHAUSTED" } };
}

await fs.mkdir(dataRoot, { recursive: true });
const catalogResponse = await request("/leagues");
if (
  catalogResponse.status !== 200 ||
  !Array.isArray(catalogResponse.data?.leagues)
)
  throw new Error("Could not retrieve league catalogue.");
await atomicJson(path.join(dataRoot, "catalogue.json"), catalogResponse.data);
const european = catalogResponse.data.leagues.filter(
  (l) =>
    europeanCodes.has(l.country_code) ||
    (["INT", "INT-2"].includes(l.country_code) && extraLeagues.has(l.name)),
);
const allSelected = historical
  ? european
      .flatMap((l) =>
        (l.seasons || [])
          .filter(
            (s) =>
              /^(202[1-5])(?:\/(202[2-6]))?$/.test(s) &&
              (s.length === 4 ||
                Number(s.slice(5)) === Number(s.slice(0, 4)) + 1),
          )
          .map((s) => ({ ...l, requested_season: s })),
      )
      .sort(
        (a, b) =>
          b.requested_season.localeCompare(a.requested_season) ||
          a.name.localeCompare(b.name),
      )
  : european
      .filter(
        (l) => l.seasons?.includes("2026/2027") || l.seasons?.includes("2026"),
      )
      .map((l) => ({
        ...l,
        requested_season: l.seasons.includes("2026/2027")
          ? "2026/2027"
          : "2026",
      }));
const selected = scopedYears
  ? allSelected.filter((l) =>
      inHistoryScope({ season: l.requested_season }, scopedYears),
    )
  : allSelected;
if (scopedYears && !selected.length)
  throw new Error(
    "No requested historical seasons are available in the catalogue.",
  );
let cursor = 0;
const fetched = new Array(selected.length);
async function inventoryWorker() {
  while (true) {
    const i = cursor++;
    if (i >= selected.length) return;
    const league = selected[i];
    const result = await request(
      `/leagues/${encodeURIComponent(league.id)}/matches?season=${encodeURIComponent(league.requested_season)}&status=all`,
    );
    const responseValid = Array.isArray(result.data?.matches);
    const matches = responseValid ? result.data.matches : [];
    fetched[i] = {
      id: league.id,
      name: league.name,
      country_code: league.country_code,
      season: league.requested_season,
      status: result.status,
      response_valid: responseValid,
      error: result.error,
      matches,
    };
    console.log(
      `Inventory ${i + 1}/${selected.length}: ${league.country_code} ${league.name}, ${matches.length} fixtures`,
    );
  }
}
await Promise.all(Array.from({ length: concurrency }, inventoryWorker));
let carried = [];
if (scopedYears) {
  try {
    const previous = JSON.parse(
      await fs.readFile(path.join(dataRoot, "inventory.json"), "utf8"),
    );
    carried = previous.competitions.filter(
      (c) => !inHistoryScope(c, scopedYears),
    );
  } catch {}
}
const competitions = [...carried, ...fetched];
const inventory = { retrieved_at_utc: new Date().toISOString(), competitions };
if (fetched.some((c) => c.status !== 200 || !c.response_valid)) {
  await atomicJson(path.join(dataRoot, "inventory_failure.json"), inventory);
  throw new Error(
    "Some competition inventories failed or had an invalid response. Rerun to retry.",
  );
}
await atomicJson(path.join(dataRoot, "inventory.json"), inventory);
const scopedCompetitions = competitions.filter((c) =>
  inHistoryScope(c, scopedYears),
);
const seen = new Set();
const played = scopedCompetitions
  .flatMap((c) =>
    c.matches
      .filter((m) => m.status === "finished")
      .map((m) => ({
        competition_id: c.id,
        competition_name: c.name,
        country_code: c.country_code,
        season: c.season,
        fixture: m,
      })),
  )
  .filter((x) => {
    if (seen.has(x.fixture.id)) return false;
    seen.add(x.fixture.id);
    return true;
  });
console.log(
  `Inventory: ${competitions.length} competition-seasons; scope ${scopedYears ? [...scopedYears].join(",") : "all"}; ${played.length} finished matches; ${scopedCompetitions.reduce((n, c) => n + c.matches.length, 0)} scoped fixtures.`,
);
if (inventoryOnly) process.exit(0);

cursor = 0;
async function matchWorker() {
  while (true) {
    const i = cursor++;
    if (i >= (limit || played.length)) return;
    const item = played[i];
    if (!item) return;
    const file = path.join(
      dataRoot,
      "matches",
      item.competition_id,
      matchFilename(item.fixture.id),
    );
    let existing = null;
    try {
      existing = JSON.parse(await fs.readFile(file, "utf8"));
      if (
        !refreshDetails &&
        existing.complete === true &&
        Object.keys(endpoints).every((k) => existing.endpoints?.[k]) &&
        !(
          retryUnavailable &&
          Object.values(existing.endpoints).some(
            (r) => r.status === 404 || r.status === 403,
          )
        )
      ) {
        completed++;
        continue;
      }
    } catch {}
    const responses = existing?.endpoints || {};
    for (const [name, suffix] of Object.entries(endpoints)) {
      const previous = responses[name];
      if (
        refreshDetails ||
        (retryUnavailable &&
          (previous?.status === 404 || previous?.status === 403)) ||
        !previous ||
        previous.status === null ||
        previous.status === 429 ||
        previous.status >= 500
      ) {
        responses[name] = await request(
          `/matches/${encodeURIComponent(item.fixture.id)}${suffix ? "/" + suffix : ""}`,
        );
      }
    }
    const complete = Object.values(responses).every(
      (r) => r.status !== null && r.status < 500 && r.status !== 429,
    );
    await atomicJson(file, {
      ...item,
      retrieved_at_utc: new Date().toISOString(),
      complete,
      endpoints: responses,
    });
    if (!complete) failed++;
    completed++;
    if (completed % 50 === 0 || completed === played.length)
      console.log(
        `Matches ${completed}/${played.length}; incomplete ${failed}; rate-limit retries ${throttled}.`,
      );
  }
}
await Promise.all(Array.from({ length: concurrency }, matchWorker));
// Fixture detail, predicted lineups and head-to-head can exist before kickoff.
// Refresh older fixture records on later runs; predictions are time-sensitive.
const upcomingEndpoints = { match: "", lineups: "lineups", h2h: "h2h" };
const otherSeen = new Set();
const otherFixtures = scopedCompetitions
  .flatMap((c) =>
    c.matches
      .filter((m) => m.status !== "finished")
      .map((m) => ({
        competition_id: c.id,
        competition_name: c.name,
        country_code: c.country_code,
        season: c.season,
        fixture: m,
      })),
  )
  .filter((x) => {
    if (otherSeen.has(x.fixture.id)) return false;
    otherSeen.add(x.fixture.id);
    return true;
  });
let fixtureCompleted = 0,
  fixtureFailed = 0;
if (!limit && !failed) {
  cursor = 0;
  async function fixtureWorker() {
    while (true) {
      const i = cursor++;
      if (i >= otherFixtures.length) return;
      const item = otherFixtures[i],
        file = path.join(
          dataRoot,
          "fixtures",
          item.competition_id,
          matchFilename(item.fixture.id),
        );
      let previous;
      try {
        previous = JSON.parse(await fs.readFile(file, "utf8"));
      } catch {}
      const fresh =
        !refreshDetails &&
        previous?.complete &&
        Date.now() - Date.parse(previous.retrieved_at_utc) <
          6 * 60 * 60 * 1000 &&
        !(
          retryUnavailable &&
          Object.values(previous.endpoints || {}).some(
            (r) => r.status === 404 || r.status === 403,
          )
        );
      let record = previous;
      if (!fresh) {
        const responses = {};
        for (const [name, suffix] of Object.entries(upcomingEndpoints))
          responses[name] = await request(
            `/matches/${encodeURIComponent(item.fixture.id)}${suffix ? "/" + suffix : ""}`,
          );
        const complete = Object.values(responses).every(
          (r) => r.status !== null && r.status < 500 && r.status !== 429,
        );
        record = {
          ...item,
          retrieved_at_utc: new Date().toISOString(),
          complete,
          endpoints: responses,
        };
        await atomicJson(file, record);
      }
      fixtureCompleted++;
      if (!record.complete) fixtureFailed++;
      if (
        fixtureCompleted % 100 === 0 ||
        fixtureCompleted === otherFixtures.length
      )
        console.log(
          `Other fixtures ${fixtureCompleted}/${otherFixtures.length}; incomplete ${fixtureFailed}.`,
        );
    }
  }
  await Promise.all(Array.from({ length: concurrency }, fixtureWorker));
}
const profileCounts = {
  leagues: 0,
  teams: 0,
  players: 0,
  unavailable: 0,
  restricted: 0,
  failed: 0,
};
const profileIds = { leagues: [], teams: [], players: [] };
if (!matchesOnly && !limit && !failed) {
  const ids = {
    leagues: new Set(scopedCompetitions.map((c) => c.id)),
    teams: new Set(),
    players: new Set(),
  };
  for (const c of scopedCompetitions)
    for (const fixture of c.matches)
      for (const team of [fixture.home_team, fixture.away_team])
        if (/^t_[A-Za-z0-9]{6}$/.test(team?.id || "")) ids.teams.add(team.id);
  for (const item of played) {
    const file = path.join(
      dataRoot,
      "matches",
      item.competition_id,
      matchFilename(item.fixture.id),
    );
    const record = JSON.parse(await fs.readFile(file, "utf8"));
    for (const team of [item.fixture.home_team, item.fixture.away_team])
      if (/^t_[A-Za-z0-9]{6}$/.test(team?.id || "")) ids.teams.add(team.id);
    gatherPlayerIds(record.endpoints, ids.players);
  }
  for (const item of otherFixtures) {
    let record;
    try {
      record = JSON.parse(
        await fs.readFile(
          path.join(
            dataRoot,
            "fixtures",
            item.competition_id,
            matchFilename(item.fixture.id),
          ),
          "utf8",
        ),
      );
    } catch {
      continue;
    }
    gatherPlayerIds(record.endpoints, ids.players);
  }
  for (const kind of Object.keys(profileIds))
    profileIds[kind] = [...ids[kind]].sort();
  const legacyFiles = {},
    collisionKeys = {};
  for (const [kind, set] of Object.entries(ids)) {
    const seen = new Map(),
      collisions = new Set();
    for (const id of set) {
      const key = id.toLowerCase();
      if (seen.has(key) && seen.get(key) !== id) collisions.add(key);
      else seen.set(key, id);
    }
    collisionKeys[kind] = collisions;
    let names = [];
    try {
      names = await fs.readdir(path.join(dataRoot, "profiles", kind));
    } catch {}
    legacyFiles[kind] = new Map(
      names
        .filter((name) => /^[ltp]_[A-Za-z0-9]{6}\.json$/.test(name))
        .map((name) => [
          name.slice(0, -5),
          path.join(dataRoot, "profiles", kind, name),
        ]),
    );
  }
  const jobs = Object.entries(ids).flatMap(([kind, set]) =>
    [...set].map((id) => ({ kind, id })),
  );
  console.log(
    `Profiles: ${ids.leagues.size} competitions, ${ids.teams.size} teams, ${ids.players.size} players.`,
  );
  cursor = 0;
  let profileDone = 0;
  async function profileWorker() {
    while (true) {
      const i = cursor++;
      if (i >= jobs.length) return;
      const job = jobs[i],
        file = path.join(
          dataRoot,
          "profiles",
          job.kind,
          profileFilename(job.id),
        );
      let result;
      const legacy = legacyFiles[job.kind].get(job.id);
      try {
        result = JSON.parse(await fs.readFile(file, "utf8"));
        if (result.status === 200 && result.data?.id !== job.id) result = null;
      } catch {}
      if (!result && historical) {
        const shared = path.join(
          currentDataRoot,
          "profiles",
          job.kind,
          profileFilename(job.id),
        );
        let previous;
        try {
          previous = JSON.parse(await fs.readFile(shared, "utf8"));
        } catch {}
        if (
          previous &&
          (previous.status !== 200 || previous.data?.id === job.id)
        ) {
          await fs.mkdir(path.dirname(file), { recursive: true });
          try {
            await fs.link(shared, file);
          } catch (error) {
            if (error.code !== "EEXIST") await fs.copyFile(shared, file);
          }
          result = previous;
        }
      }
      if (!result && legacy) {
        let previous;
        try {
          previous = JSON.parse(await fs.readFile(legacy, "utf8"));
        } catch {}
        const verified =
          previous &&
          (previous.status === 200
            ? previous.data?.id === job.id
            : !collisionKeys[job.kind].has(job.id.toLowerCase()));
        if (verified) {
          await fs.rename(legacy, file);
          result = previous;
        }
      }
      if (
        !result ||
        (retryUnavailable &&
          (result.status === 404 || result.status === 403)) ||
        result.status === null ||
        result.status === 429 ||
        result.status >= 500
      ) {
        result = await request(`/${job.kind}/${encodeURIComponent(job.id)}`);
        await atomicJson(file, {
          ...result,
          resource_id: job.id,
          retrieved_at_utc: new Date().toISOString(),
        });
      }
      if (
        legacy &&
        result.status !== null &&
        result.status !== 429 &&
        result.status < 500
      ) {
        try {
          await fs.unlink(legacy);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      profileCounts[job.kind]++;
      if (result.status === 404) profileCounts.unavailable++;
      else if (
        result.status === 403 &&
        result.error?.code === "PLAN_UPGRADE_REQUIRED"
      )
        profileCounts.restricted++;
      else if (result.status !== 200) profileCounts.failed++;
      profileDone++;
      if (profileDone % 500 === 0 || profileDone === jobs.length)
        console.log(
          `Profiles ${profileDone}/${jobs.length}; unavailable ${profileCounts.unavailable}; restricted ${profileCounts.restricted}; failed ${profileCounts.failed}.`,
        );
    }
  }
  await Promise.all(Array.from({ length: concurrency }, profileWorker));
}
await atomicJson(path.join(dataRoot, "collection.json"), {
  retrieved_at_utc: new Date().toISOString(),
  competitions: scopedCompetitions.length,
  fixtures: scopedCompetitions.reduce((n, c) => n + c.matches.length, 0),
  finished: played.length,
  considered: limit || played.length,
  completed,
  incomplete: failed,
  scope_years: scopedYears ? [...scopedYears].sort() : null,
  endpoints: Object.keys(endpoints),
  other_fixtures: {
    total: otherFixtures.length,
    completed: fixtureCompleted,
    incomplete: fixtureFailed,
    endpoints: Object.keys(upcomingEndpoints),
  },
  profiles: profileCounts,
  profiles_collected: !matchesOnly && !limit && !failed,
  profile_ids: profileIds,
});
console.log(
  `Collection complete: ${completed}/${played.length}; incomplete ${failed}; other fixtures ${fixtureCompleted}/${otherFixtures.length}, incomplete ${fixtureFailed}; profile failures ${profileCounts.failed}.`,
);
if (failed || fixtureFailed || profileCounts.failed) process.exitCode = 1;

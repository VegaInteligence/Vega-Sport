import path from "node:path";
import { readFile, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { appRoot, databaseRoot } from "./config.js";
import { matchObservation, profileObservation } from "./services/database.js";
import { publicFile, response, contained } from "./services/files.js";
import { handlePitchApi } from "./services/pitchapi.js";
import { dataJson, remoteData } from "./services/data-store.js";

let credentials;
async function environment() {
  if (!credentials)
    credentials = (async () => {
      if (process.env.PITCHAPI_API_KEY)
        return { PITCHAPI_API_KEY: process.env.PITCHAPI_API_KEY };
      try {
        const text = await readFile(path.join(appRoot, ".env"), "utf8");
        const value = text.match(/^\s*PITCHAPI_API_KEY\s*=\s*(.*?)\s*$/m)?.[1];
        return value
          ? { PITCHAPI_API_KEY: value.replace(/^(['"])(.*)\1$/, "$2") }
          : {};
      } catch {
        return {};
      }
    })();
  return credentials;
}
export async function handleRequest(request) {
  const head = request.method === "HEAD";
  let pathname;
  try {
    pathname = decodeURIComponent(
      request.url.replace(/^https?:\/\/[^/]+/, "").split(/[?#]/, 1)[0] || "/",
    );
  } catch {
    return response("Invalid path", 400);
  }
  if (!pathname.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(pathname))
    return response("Invalid path", 400);
  if (pathname.split("/").some((x) => x.startsWith(".")))
    return response("Forbidden", 403);
  if (pathname === "/api/health")
    return Response.json({
      status: "ok",
      runtime: typeof Bun !== "undefined" ? "bun" : "node",
    });
  if (pathname === "/api/settings") {
    if (request.method !== "GET" && !head)
      return response("Method not allowed", 405, { Allow: "GET, HEAD" });
    let sync = null;
    try {
      sync = await dataJson("raw/sync.json");
    } catch {}
    const config = await environment();
    return response(
      head
        ? null
        : JSON.stringify({
            provider: "PitchAPI Soccer",
            configured: Boolean(config.PITCHAPI_API_KEY),
            schedule: {
              cron: "0 0 * * *",
              timezone: "Europe/Paris",
              runner: "GitHub Actions",
            },
            sync,
            revision:
              (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null,
            workflowUrl:
              "https://github.com/OrionQuantPlatform/Football_Ranking/actions/workflows/daily-data.yml",
          }),
      200,
      { "Content-Type": "application/json; charset=utf-8" },
    );
  }
  const profile = pathname.match(
    /^\/api\/archive\/profiles\/(leagues|teams|players)\/([ltp]_[A-Za-z0-9]{6})$/,
  );
  const match = pathname.match(/^\/api\/archive\/matches\/(m_[A-Za-z0-9]{6})$/);
  if ((profile || match) && (request.method === "GET" || head)) {
    if (
      profile &&
      profile[2][0] !== { leagues: "l", teams: "t", players: "p" }[profile[1]]
    )
      return response("Not found", 404);
    try {
      let record;
      if (remoteData || existsSync(path.join(databaseRoot, "raw/index.json")))
        record = profile
          ? await profileObservation(profile[1], profile[2])
          : await matchObservation(match[1]);
      else record = await legacyArchive(profile, match);
      return record
        ? response(head ? null : JSON.stringify(record), 200, {
            "Content-Type": "application/json; charset=utf-8",
          })
        : response("Not found", 404);
    } catch {
      return response("Observation unavailable", 500);
    }
  }
  if (pathname === "/api" || pathname.startsWith("/api/"))
    return handlePitchApi(request, await environment());
  if (request.method !== "GET" && !head)
    return response("Method not allowed", 405, { Allow: "GET, HEAD" });
  if (pathname === "/dashboard") pathname = "/";
  else if (pathname.startsWith("/dashboard/")) pathname = pathname.slice(10);
  if (pathname === "/data/football-manifest.json")
    return publicFile(
      databaseRoot,
      remoteData || existsSync(path.join(databaseRoot, "raw/index.json"))
        ? "raw/index.json"
        : "staging/dashboard/football-manifest.json",
      head,
    );
  if (
    pathname.startsWith("/data/raw/") ||
    pathname.startsWith("/data/computed/")
  )
    return publicFile(databaseRoot, pathname.slice(6), head);
  if (pathname.startsWith("/data/")) {
    if (remoteData || existsSync(path.join(databaseRoot, "raw/index.json")))
      return response("Not found", 404);
    const name = pathname.slice(6);
    const samples = [
      "pitchapi_championnats.json",
      "pitchapi_premiers_matchs.json",
    ];
    return publicFile(
      databaseRoot,
      (samples.includes(name)
        ? "sources/pitchapi/samples/"
        : "staging/dashboard/") + name,
      head,
    );
  }
  return response(
    pathname.includes(".") ||
      /^\/(backend|frontend|scripts|shared|node_modules)(?:\/|$)/.test(pathname)
      ? "Forbidden"
      : "Not found",
    pathname.includes(".") ||
      /^\/(backend|frontend|scripts|shared|node_modules)(?:\/|$)/.test(pathname)
      ? 403
      : 404,
  );
}

async function legacyArchive(profile, match) {
  for (const archive of ["europe_2026_2027", "europe_2021_2026"])
    try {
      const base = path.join(
        databaseRoot,
        "sources/pitchapi/archives",
        archive,
      );
      if (profile) {
        const [, kind, id] = profile;
        let record;
        for (const name of [
          `${id}--${Buffer.from(id).toString("hex")}.json`,
          `${id}.json`,
        ])
          try {
            record = await archiveJson(base, path.join("profiles", kind, name));
            break;
          } catch {}
        if (record?.status === 200 && record.data?.id === id) return record;
        continue;
      }
      const id = match[1];
      let entry,
        folder = "matches";
      try {
        entry = (await archiveJson(base, "index.json")).matches?.find(
          (x) => x.match?.id === id,
        );
      } catch {}
      if (!entry) {
        const inventory = await archiveJson(base, "inventory.json");
        const competition = inventory.competitions.find((x) =>
          x.matches.some((m) => m.id === id),
        );
        if (competition) {
          entry = { competition_id: competition.id };
          folder =
            competition.matches.find((m) => m.id === id).status === "finished"
              ? "matches"
              : "fixtures";
        }
      }
      if (!entry || !/^l_[A-Za-z0-9]{6}$/.test(entry.competition_id)) continue;
      const name =
        archive === "europe_2021_2026"
          ? `${id}--${Buffer.from(id).toString("hex")}.json`
          : `${id}.json`;
      const record = await archiveJson(
        base,
        path.join(/*turbopackIgnore: true*/ folder, entry.competition_id, name),
      );
      if (record.fixture?.id && record.fixture.id !== id) continue;
      const mapping = {
        match: "match",
        shots: "shots",
        momentum: "momentum",
        events: "events",
        players: "players",
        "players/halves": "player_halves",
        lineups: "lineups",
        h2h: "h2h",
        stats: "stats",
        advanced: "advanced_teams",
        "advanced/players": "advanced_players",
        "advanced/network": "pass_networks",
        heatmaps: "heatmaps",
      };
      const result = {
        meta: {
          retrievedAt: record.retrieved_at_utc,
          source: "Archive PitchAPI locale",
        },
        availability: {},
      };
      for (const [key, value] of Object.entries(mapping)) {
        const item = record.endpoints?.[value];
        result.availability[key] = {
          state: item?.status === 200 ? "collected" : "error",
          status: item?.status ?? null,
        };
        if (item?.status === 200)
          result[key] = { data: item.data, status: item.status };
      }
      return result;
    } catch {}
  return null;
}

async function archiveJson(base, relative) {
  const [root, file] = await Promise.all([
    realpath(base),
    realpath(path.join(base, relative)),
  ]);
  if (!contained(root, file)) throw new Error("Forbidden archive path");
  return JSON.parse(await readFile(file, "utf8"));
}

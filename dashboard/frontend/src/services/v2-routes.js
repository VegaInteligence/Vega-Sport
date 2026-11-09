/**
 * The site on the v2 API (vega-football-db-postgres): built with
 * NEXT_PUBLIC_API_SCHEMA=v2, every read goes to the v2 route that serves the same body.
 * v2 routes name what they serve, never a data source (v2/README.md lists them); without
 * the setting nothing changes. Path-only renames are made in apiUrl (data-url.js); the
 * reads that need an id the old route did not take (club facts, stadium, cups) or
 * several pages (a league's schedule, a day) use the helpers below.
 */
export const API_V2 = process.env.NEXT_PUBLIC_API_SCHEMA === "v2";

const PROXY = "/api/pitchapi/";

/** The v2 path of a current one, when only the path differs. */
export function v2Path(path) {
  const [route, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  const withQuery = (next, p = params) => next + (String(p) ? "?" + p : "");
  if (route.startsWith(PROXY)) {
    const resource = route.slice(PROXY.length);
    if (resource === "leagues") return withQuery("/api/competitions");
    if (/^(matches|players|teams)\/[mpt]_[A-Za-z0-9]{6,9}(\/.*)?$/.test(resource))
      return withQuery("/api/" + resource);
    return path; // schedules and days: fixturePath()
  }
  if (route === "/api/rankings/edition" && params.has("edition")) {
    params.set("edition", params.get("edition").replace(/\.(uefa|fifa|sportsapi)$/, ""));
    return withQuery(route);
  }
  return path;
}

/** The fixtures scope of a provider-proxy schedule or day, else null. */
export function fixtureScope(resource) {
  const day = resource.match(/^date\/(\d{4}-\d{2}-\d{2})(?:\?|$)/);
  if (day) return { day: day[1] };
  const schedule = resource.match(/^leagues\/(l_[A-Za-z0-9]{6,9})\/matches(?:\?(.*))?$/);
  if (schedule) {
    const season = new URLSearchParams(schedule[2] || "").get("season");
    return { league: schedule[1], ...(season && { season }) };
  }
  return null;
}

/** A club's facts and its stadium are read by the club's id in v2. */
export const clubFactsPath = (clubId) => "/api/club-facts?" + new URLSearchParams({ club: clubId });
export const stadiumPath = (clubId) => "/api/stadium?" + new URLSearchParams({ club: clubId });

// The body layout of each current cup kind, as the v2 cup index names it.
const CUP_FORMAT = { "open-cups": "matches-v1", openligadb: "rounds-v1", "nations-results": "results-v1" };
let cupIndex = null;

/** The Vega id of a cup of the current kinds (open-cups, openligadb, nations-results). */
export async function cupId(kind, competition, read) {
  if (!CUP_FORMAT[kind]) return null;
  cupIndex ??= read("/api/cups/index").catch((error) => {
    cupIndex = null;
    throw error;
  });
  const { cups } = await cupIndex;
  const key = kind === "nations-results" ? "nations-league" : competition;
  return cups.find((c) => c.key === key && c.format === CUP_FORMAT[kind])?.id ?? null;
}

/** The v2 reads of a cup edition: its snapshot and its edition body. */
export function cupPaths(id, season) {
  const params = new URLSearchParams({ competition: id, season });
  return {
    snapshot: "/api/cup-snapshot?" + new URLSearchParams({ kind: "edition", competition: id, season }),
    edition: "/api/cups/edition?" + params,
  };
}

/** Ranking editions are named by season or date in v2 ("2026", legacy "2026.uefa"). */
export const editionYear = (edition) => String(edition || "").replace(/\.(uefa|fifa|sportsapi)$/, "");

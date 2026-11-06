import { dataJson } from "./aws-data-store.js";
import { query, canonical, cache } from "./aws-staging.js";
const resources = cache(16 * 1024 * 1024, { name: "resource" });
export async function savedResource(endpoint, params = {}) {
  return resources(endpoint + "?" + canonical(params), async () => {
    const row = (
      await query(
        "SELECT status,ref,error,updated_at FROM statarena.resources WHERE endpoint=$1 AND params=$2",
        [endpoint, canonical(params)],
      )
    )[0];
    if (!row) return null;
    if (!row.ref) return { status: row.status, error: row.error };
    let value = await dataJson(row.ref.path);
    if (row.ref.ordinal !== undefined) value = value[row.ref.ordinal];
    if (row.ref.documentId)
      value = value.find((r) => r.documentId === row.ref.documentId);
    if (!value) throw new Error("Incomplete AWS resource reference");
    value = value.observation || value.response || value;
    return {
      status: row.status,
      data: value.data ?? null,
      error: row.error || value.error || null,
    };
  });
}
export async function matchObservation(id) {
  const row = (
    await query(
      "SELECT o.ordinal,s.ref FROM statarena.observations o JOIN statarena.shards s ON s.id=o.shard WHERE o.id=$1",
      [id],
    )
  )[0];
  const endpoints = {};
  let metadata = {};
  if (row) {
    const doc = (await dataJson(row.ref.document.path))[row.ordinal];
    metadata = doc.metadata;
    await Promise.all(
      doc.endpoints.map(async (name) => {
        const item = (await dataJson(row.ref.tables[name].path)).find(
          (r) => r.documentId === doc.id,
        );
        if (!item) throw new Error("Incomplete AWS observations");
        endpoints[name] = item.response;
      }),
    );
  }
  const mapping = {
    "": "match",
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
  await Promise.all(
    Object.entries(mapping).map(async ([suffix, name]) => {
      const saved = await savedResource(
        "/matches/" + id + (suffix ? "/" + suffix : ""),
      );
      if (saved) endpoints[name] = saved;
    }),
  );
  return Object.keys(endpoints).length ? { ...metadata, endpoints } : null;
}
export const profileObservation = (kind, id) =>
  savedResource("/" + kind + "/" + id);
export async function fixtureResource(resource, params) {
  const date = resource.match(/^\/date\/(\d{4}-\d{2}-\d{2})$/),
    league = resource.match(/^\/leagues\/(l_[A-Za-z0-9]{6})\/matches$/);
  if (!date && !league) return null;
  const values = date ? [date[1]] : [league[1], params.season || ""];
  let where = date ? "day=$1" : "league_id=$1 AND season=$2";
  if (params.status && params.status !== "all") {
    values.push(params.status === "played" ? "finished" : "finished");
    where +=
      params.status === "played"
        ? ` AND status=$${values.length}`
        : ` AND status IS DISTINCT FROM $${values.length}`;
  }
  const rows = await query(
    `SELECT body FROM statarena.fixtures WHERE ${where} ORDER BY day,id LIMIT 20000`,
    values,
  );
  return { status: 200, data: { matches: rows.map((r) => r.body) } };
}
export async function archivedResource(endpoint) {
  const match = endpoint.match(/^\/matches\/(m_[A-Za-z0-9]{6})(?:\/(.*))?$/);
  if (!match) return null;
  const mapping = {
    "": "match",
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
  const key = mapping[match[2] || ""];
  if (!key) return null;
  const row = (
    await query(
      "SELECT o.ordinal,s.ref FROM statarena.observations o JOIN statarena.shards s ON s.id=o.shard WHERE o.id=$1",
      [match[1]],
    )
  )[0];
  if (!row?.ref.tables[key]) return null;
  const [documents, rows] = await Promise.all([
    dataJson(row.ref.document.path),
    dataJson(row.ref.tables[key].path),
  ]);
  const doc = documents[row.ordinal];
  return rows.find((r) => r.documentId === doc.id)?.response || null;
}

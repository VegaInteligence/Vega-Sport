import { dataJson } from "./data-store.js";
let observationIndex;
let observationShards;
let profileIndex;
async function jsonTable(ref) {
  return dataJson(ref.path);
}
export async function matchObservation(id) {
  observationIndex ||= await dataJson("raw/match-observations.json");
  const entry = observationIndex[id]?.[0];
  if (!entry) return null;
  observationShards ||= await dataJson("raw/observation-shards.json");
  const ref = { ...observationShards[entry.shard], ordinal: entry.ordinal };
  const doc = (await jsonTable(ref.document))[ref.ordinal];
  const endpoints = {};
  await Promise.all(
    doc.endpoints.map(async (endpoint) => {
      const rows = await jsonTable(ref.tables[endpoint]);
      const row = rows.find((r) => r.documentId === doc.id);
      if (!row) throw new Error("Incomplete source observations");
      endpoints[endpoint] = row.response;
    }),
  );
  return { ...doc.metadata, endpoints };
}

export async function profileObservation(kind, id) {
  profileIndex ||= await dataJson("raw/profile-index.json");
  const ref = profileIndex.entities[kind + ":" + id]?.at(-1);
  return ref ? (await jsonTable(ref))[ref.ordinal].observation : null;
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { databaseRoot } from "../config.js";
let observationIndex;
let observationShards;
let profileIndex;
async function jsonTable(ref) {
  const body = await readFile(path.join(databaseRoot, ref.path));
  return JSON.parse(
    ref.path.endsWith(".gz")
      ? gunzipSync(body).toString("utf8")
      : body.toString("utf8"),
  );
}
export async function matchObservation(id) {
  observationIndex ||= JSON.parse(
    await readFile(
      path.join(databaseRoot, "raw/match-observations.json"),
      "utf8",
    ),
  );
  const entry = observationIndex[id]?.[0];
  if (!entry) return null;
  observationShards ||= JSON.parse(
    await readFile(
      path.join(databaseRoot, "raw/observation-shards.json"),
      "utf8",
    ),
  );
  const ref = { ...observationShards[entry.shard], ordinal: entry.ordinal };
  const doc = (await jsonTable(ref.document))[ref.ordinal];
  const endpoints = {};
  for (const endpoint of doc.endpoints) {
    const rows = await jsonTable(ref.tables[endpoint]);
    const row = rows.find((r) => r.documentId === doc.id);
    if (!row) throw new Error("Incomplete source observations");
    endpoints[endpoint] = row.response;
  }
  return { ...doc.metadata, endpoints };
}

export async function profileObservation(kind, id) {
  profileIndex ||= JSON.parse(
    await readFile(path.join(databaseRoot, "raw/profile-index.json"), "utf8"),
  );
  const ref = profileIndex.entities[kind + ":" + id]?.at(-1);
  return ref ? (await jsonTable(ref))[ref.ordinal].observation : null;
}

#!/usr/bin/env node
/**
 * Parity: the same reads against the current API and the v2 API, compared field by
 * field (doc "Parité"). Read-only GETs. Publication metadata (generation, times,
 * ETags) is expected to differ and is ignored; everything else is reported.
 *
 *   node parity.mjs --legacy https://<current> --v2 https://<v2> paths.txt
 *
 * paths.txt: one path per line, the current API's (e.g. /api/read/clubs?season=2025/2026&leagues=all);
 * the v2 side reads the same request under its v2 route, as the site does once switched
 * (dashboard/frontend/src/services/v2-routes.js).
 */
import { readFile } from "node:fs/promises";
import { v2Path } from "../../dashboard/frontend/src/services/v2-routes.js";

export const IGNORED = new Set(["generation", "publishedAt", "sourceRetrievedAt", "latestSourceRetrievedAt", "publicationVersion", "retrievedAt", "sourceDigest", "storage"]);

/** Differences between two JSON values: [{path, legacy, v2}], numbers within `tolerance`. */
export function compare(legacy, v2, { path = "$", tolerance = 1e-6, out = [] } = {}) {
  if (typeof legacy === "number" && typeof v2 === "number") {
    if (Math.abs(legacy - v2) > tolerance * Math.max(1, Math.abs(legacy))) out.push({ path, legacy, v2 });
    return out;
  }
  if (Array.isArray(legacy) && Array.isArray(v2)) {
    if (legacy.length !== v2.length) out.push({ path: path + ".length", legacy: legacy.length, v2: v2.length });
    for (let i = 0; i < Math.min(legacy.length, v2.length); i++) compare(legacy[i], v2[i], { path: `${path}[${i}]`, tolerance, out });
    return out;
  }
  if (legacy && v2 && typeof legacy === "object" && typeof v2 === "object") {
    for (const key of new Set([...Object.keys(legacy), ...Object.keys(v2)])) {
      if (IGNORED.has(key)) continue;
      if (!(key in v2)) out.push({ path: `${path}.${key}`, legacy: legacy[key], v2: "(missing)" });
      else if (!(key in legacy)) out.push({ path: `${path}.${key}`, legacy: "(missing)", v2: v2[key] });
      else compare(legacy[key], v2[key], { path: `${path}.${key}`, tolerance, out });
    }
    return out;
  }
  if (legacy !== v2) out.push({ path, legacy, v2 });
  return out;
}

async function main(argv) {
  const arg = (name) => argv[argv.indexOf(name) + 1];
  const legacy = arg("--legacy"),
    v2 = arg("--v2"),
    file = argv.at(-1);
  if (!legacy || !v2 || !file || file.startsWith("--")) {
    console.error("usage: node parity.mjs --legacy <url> --v2 <url> paths.txt");
    return 2;
  }
  const paths = (await readFile(file, "utf8")).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  let failing = 0;
  for (const path of paths) {
    const [a, b] = await Promise.all([fetch(legacy + path), fetch(v2 + v2Path(path))]);
    const [ja, jb] = await Promise.all([a.json().catch(() => null), b.json().catch(() => null)]);
    const diffs = a.status === b.status ? compare(ja, jb) : [{ path: "status", legacy: a.status, v2: b.status }];
    if (diffs.length) failing++;
    console.log(`${diffs.length ? "DIFF" : "SAME"} ${path} (${diffs.length})`);
    for (const d of diffs.slice(0, 20)) console.log(`  ${d.path}: ${JSON.stringify(d.legacy)} != ${JSON.stringify(d.v2)}`);
  }
  console.log(`${paths.length - failing}/${paths.length} identical`);
  return failing ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main(process.argv.slice(2)));

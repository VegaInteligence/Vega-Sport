import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { refreshCupWorker, verifyCupWorker, parseCupCsv } from "../dashboard/scripts/cup-worker.mjs";
import { cupSnapshotPath } from "../dashboard/shared/cup-worker.js";
import { normalizeSupplementalCup } from "../dashboard/frontend/src/services/cup-matches.js";
import { knockoutStage } from "../dashboard/frontend/src/services/knockout-bracket.js";

const commit = "a".repeat(40), base = "https://raw.githubusercontent.com/oladeeayo/open-matchday/" + commit + "/";
const read = async (root, rel) => JSON.parse(await readFile(path.join(root, ...rel.split("/")), "utf8"));

test("CSV preserves quoted names and explicit knockout rounds", () => {
  const rows = parseCupCsv('date,home,away,round\n2026-11-10,"Team, A","B ""City""",Quarter-finals\n');
  assert.deepEqual(rows, [{ date: "2026-11-10", home: "Team, A", away: 'B "City"', round: "Quarter-finals" }]);
  assert.equal(knockoutStage(normalizeSupplementalCup([], rows)[0].roundName), "quarter");
  assert.throws(() => parseCupCsv('date,home,away\n2026-11-10,"A,B\n'), /Unterminated/);
});

test("worker discovers new cups, saves future fixtures and retains last good data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "statarena-cup-worker-"));
  let fail = false, phase = 0, seasonCode = "2627";
  const feed = async (url) => {
    if (fail) return new Response("", { status: 503 });
    if (url.includes("api.github.com/repos/")) return Response.json({ sha: commit });
    if (url === base + "build_summary.json") return Response.json({ season: seasonCode, generated_utc: "2026-11-02T05:00:00Z", leagues: [
      { folder: "data/ENG_CUP_new-cup", league: "New Cup", results: phase ? 1 : 0, fixtures: phase ? 0 : 1, errors: [] },
    ] });
    if (url.endsWith("fixtures_" + seasonCode + ".csv")) return new Response("date,home,away,round\n" + (seasonCode === "2728" ? "2027-11-10" : "2026-11-10") + ",A,B,Quarter-finals\n");
    if (url.endsWith("results_" + seasonCode + ".csv")) return new Response("date,home,away,ft_home,ft_away,round\n2026-11-10,A,B,2,1,Quarter-finals\n");
    throw new Error("Unexpected URL " + url);
  };
  const plan = [{ kind: "open-cups", key: "euro", season: "2028", active: true }];
  const loader = async () => { if (fail) throw new Error("unavailable"); return { matches: [{ team1: "A", team2: "B" }] }; };
  try {
    const options = { dataRoot: root, now: new Date("2026-11-02T10:00:00Z"), fetcher: feed, sourcePlan: plan, sourceLoader: loader, native: false };
    const first = await refreshCupWorker(options); assert.equal(first.failures.length, 0);
    let index = await read(root, "raw/cup-worker/index.json");
    assert.equal(index.competitions[0].folder, "ENG_CUP_new-cup");
    let fixture = await read(root, index.competitions[0].tables.fixtures.path);
    assert.equal(fixture[0].date, "2026-11-10"); assert.equal(fixture[0].round, "Quarter-finals");
    assert.equal((await read(root, cupSnapshotPath("open-cups", "euro", "2028"))).matches.length, 1);
    const unchanged = await refreshCupWorker(options); assert.equal(unchanged.changed, 0);
    phase = 1; await refreshCupWorker(options);
    index = await read(root, "raw/cup-worker/index.json");
    assert.equal(index.competitions[0].tables.results.rows, 1);
    assert.equal(index.competitions[0].tables.fixtures.rows, 0);
    seasonCode = "2728"; phase = 0;
    await refreshCupWorker({ ...options, now: new Date("2027-08-02T10:00:00Z") });
    index = await read(root, "raw/cup-worker/index.json");
    assert.deepEqual(Object.keys(index.competitions[0].editions).sort(), ["2026/2027", "2027/2028"]);
    const before = JSON.stringify(index); fail = true;
    const failed = await refreshCupWorker(options); assert.ok(failed.failures.length >= 2);
    assert.equal(JSON.stringify(await read(root, "raw/cup-worker/index.json")), before);
    assert.equal((await read(root, cupSnapshotPath("open-cups", "euro", "2028"))).matches.length, 1);
    assert.equal((await verifyCupWorker(root)).competitions, 1);
    await writeFile(path.join(root, ...index.competitions[0].tables.fixtures.path.split("/")), "[]\n");
    await assert.rejects(verifyCupWorker(root), /Cup reference mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("worker records upcoming native fixtures and their round only once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "statarena-cup-native-")), calls = [], secret = "pk_test_fixture";
  let scheduled = "2026-11-20", stage = "1/8";
  const fetcher = async (url, options) => {
    calls.push(url); assert.equal(options.headers["X-API-KEY"], secret);
    if (url.endsWith("/leagues")) return Response.json({ data: { leagues: [{ id: "l_ABC123", name: "New National Cup", country_code: "FRA", seasons: ["2026/2027"] }] } });
    if (url.includes("/leagues/l_ABC123/matches")) return Response.json({ data: { matches: [{ id: "m_ABC123", date: scheduled, status: "not_started", home_team: { name: "A" }, away_team: { name: "B" } }] } });
    if (url.endsWith("/matches/m_ABC123")) return Response.json({ data: { id: "m_ABC123", league: { id: "l_ABC123" }, season: "2026/2027", round_name: stage, has_playoff: true } });
    throw new Error("Unexpected URL " + url);
  };
  try {
    const options = { dataRoot: root, now: new Date("2026-11-02T10:00:00Z"), fetcher, apiKey: secret, sourcePlan: [], supplemental: false, pitchIntervalMs: 0 };
    await refreshCupWorker(options);
    const index = await read(root, "raw/cup-worker/index.json"), snapshot = await read(root, cupSnapshotPath("native", "l_ABC123", "2026/2027"));
    assert.equal(index.native[0].cupWorker, true); assert.equal(snapshot.matches[0].status, "not_started"); assert.equal(snapshot.rounds.m_ABC123.name, "1/8");
    assert.doesNotMatch(JSON.stringify(snapshot), /pk_test_fixture/);
    calls.length = 0; const second = await refreshCupWorker(options);
    assert.equal(calls.filter((url) => url.endsWith("/matches/m_ABC123")).length, 0); assert.equal(second.changed, 0);
    scheduled = "2026-11-21"; stage = "1/4"; calls.length = 0; await refreshCupWorker(options);
    assert.equal(calls.filter((url) => url.endsWith("/matches/m_ABC123")).length, 1);
    assert.equal((await read(root, cupSnapshotPath("native", "l_ABC123", "2026/2027"))).rounds.m_ABC123.name, "1/4");
  } finally { await rm(root, { recursive: true, force: true }); }
});

import { cupWorkerSnapshot } from "../dashboard/frontend/src/services/cup-worker-client.js";
import { FootballDataClient } from "../dashboard/frontend/src/services/football-client.js";
import { mergeCupCatalog } from "../dashboard/frontend/src/services/cup-catalog.js";

test("page reads saved cup data without calling the external route", async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return Response.json({ matches: [{ id: "one" }] }); };
  try {
    const result = await cupWorkerSnapshot("open-cups", "euro", "2028", "/api/open-cups?fallback=1");
    assert.equal(result.matches[0].id, "one"); assert.equal(calls.length, 1); assert.match(calls[0], /raw\/cup-worker\/open-cups\/euro\/2028\.json$/);
  } finally { globalThis.fetch = original; }
});

test("native cup fixtures use a worker snapshot before the provider", async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return Response.json({ matches: [{ id: "m_ABC123", status: "not_started" }], rounds: { m_ABC123: { name: "1/8" } } }); };
  try {
    const client = new FootballDataClient({ data: { competitions: [], matches: [], meta: { endDate: "2026-11-02" } } });
    client.browseMode = "catalog"; client.competitionId = "l_ABC123"; client.season = "2026/2027"; client.useCupSnapshot = true;
    await client.loadFixtures();
    const value = client.fixtures.get("l_ABC123:2026/2027");
    assert.equal(value.source, "snapshot"); assert.equal(value.rounds.m_ABC123.name, "1/8"); assert.equal(calls.length, 1);
  } finally { globalThis.fetch = original; }
});

test("worker catalogue retains editions and exposes newly discovered cups", () => {
  const ref = { path: "raw/cup-worker/supplemental/2026-2027/ENG_CUP_new/results.json", rows: 1, format: "json" };
  const index = { competitions: [{ folder: "ENG_CUP_new-cup", name: "New Cup", country_code: "ENG", season: "2026/2027", tables: { results: ref }, editions: { "2026/2027": { results: ref }, "2025/2026": { results: ref } } }] };
  const rows = mergeCupCatalog([], index, [{ id: "l_ABC123", name: "New National Cup", country: "FRA", seasons: ["2026/2027"] }]);
  assert.deepEqual(rows.find((row) => row.id === "open-matchday:ENG_CUP_new-cup").seasons, ["2026/2027", "2025/2026"]);
  assert.equal(rows.find((row) => row.id === "l_ABC123").cupWorker, true);
  const empty = { folder: "FRA_CUP_future", name: "Future Cup", country_code: "FRA", season: "2026/2027", discovered: true, tables: { results: { ...ref, rows: 0 }, fixtures: { ...ref, rows: 0 } } };
  assert.ok(mergeCupCatalog([], { competitions: [empty] }).some((row) => row.id === "open-matchday:FRA_CUP_future"));
});

test("an edition not yet collected falls back once to its existing route", async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return calls.length === 1 ? new Response("", { status: 404 }) : Response.json({ matches: [{ id: "fallback" }] }); };
  try {
    const result = await cupWorkerSnapshot("open-cups", "euro", "2028", "/api/open-cups?competition=euro&season=2028");
    assert.equal(result.matches[0].id, "fallback"); assert.equal(calls.length, 2);
  } finally { globalThis.fetch = original; }
});

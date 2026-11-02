import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../dashboard/frontend/app/api/open-cups/route.js";

test("open cup route allows known editions and rejects arbitrary upstream paths", async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(url); return Response.json({ name: "Euro 2024", matches: [{ num: 51, date: "2024-07-14", team1: "Spain", team2: "England", score: { ft: [2, 1] } }] }); };
  try {
    const valid = await GET(new Request("http://localhost/api/open-cups?competition=euro&season=2024"));
    assert.equal(valid.status, 200);
    const body = await valid.json();
    assert.equal(body.matches.length, 1);
    assert.equal(body.matches[0].num, 51);
    assert.equal(body.source.name, "OpenFootball");
    assert.match(urls[0], /^https:\/\/raw\.githubusercontent\.com\/openfootball\/euro\.json\/master\/2024\/euro\.json$/);
    const bad = await GET(new Request("http://localhost/api/open-cups?competition=euro&season=../../secret"));
    assert.equal(bad.status, 400);
    assert.equal(urls.length, 1);
    const world = await GET(new Request("http://localhost/api/open-cups?competition=world-cup-history&season=2022"));
    assert.equal(world.status, 200);
    assert.match(urls[1], /worldcup\.json\/master\/2022\/worldcup\.json$/);
  } finally { globalThis.fetch = original; }
});

test("French Cup text is parsed and an unavailable source is reported", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("# Matches 1\n▪ Final\nSat May 24 2025\n 21:00  Paris SG   v Reims   3-0 (3-0)\n");
  try {
    const valid = await GET(new Request("http://localhost/api/open-cups?competition=france-cup&season=2024%2F2025"));
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).matches[0].team1, "Paris SG");
    globalThis.fetch = async () => new Response("", { status: 503 });
    const error = await GET(new Request("http://localhost/api/open-cups?competition=euro&season=2024"));
    assert.equal(error.status, 502);
  } finally { globalThis.fetch = original; }
});

test("national archive route preserves the announced rounds and scores", async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(url); return new Response("# Matches 2\n▪ Round 4\nSat Jan 25 2025\n  15:00  A   v B   5-4 pen. 1-1 a.e.t. (1-1)\n▪ Final\nSat May 17\n  15:00  A   v C   2-0 (1-0)\n"); };
  try {
    const response = await GET(new Request("http://localhost/api/open-cups?competition=fa-cup-archive&season=2024%2F2025"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.matches[0].round, "Round of 32");
    assert.deepEqual(body.matches[0].score, { ft: [1, 1], p: [5, 4], et: [1, 1] });
    assert.match(urls[0], /openfootball\/england\/master\/2024-25\/facup\.txt$/);
    const bad = await GET(new Request("http://localhost/api/open-cups?competition=fa-cup-archive&season=2026%2F2027"));
    assert.equal(bad.status, 400);
  } finally { globalThis.fetch = original; }
});

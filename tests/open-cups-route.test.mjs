import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../dashboard/frontend/app/api/open-cups/route.js";

test("open cup route allows known editions and rejects arbitrary upstream paths", async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(url); return Response.json({ name: "Euro 2024", matches: [{ date: "2024-07-14", team1: "Spain", team2: "England", score: { ft: [2, 1] } }] }); };
  try {
    const valid = await GET(new Request("http://localhost/api/open-cups?competition=euro&season=2024"));
    assert.equal(valid.status, 200);
    const body = await valid.json();
    assert.equal(body.matches.length, 1);
    assert.equal(body.source.name, "OpenFootball");
    assert.match(urls[0], /^https:\/\/raw\.githubusercontent\.com\/openfootball\/euro\.json\/master\/2024\/euro\.json$/);
    const bad = await GET(new Request("http://localhost/api/open-cups?competition=euro&season=../../secret"));
    assert.equal(bad.status, 400);
    assert.equal(urls.length, 1);
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

// GET /api/matches/{id}/lineups/probable: our probable eleven of each side of a match not started (FAILURE_MODES.md §61,
// 61n–61o), read from api.match_probable_lineups and api.match_probable_lineup_players (176); the contract the
// « Compositions » tab is built on (the mock-up's answers, /mnt/project-files/composition-probable/maquette/scripts/).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";

let owner, ids;
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  const q = (sql, args) => owner.query(sql, args);
  ids = (await q(`SELECT api.public_id('match', 6) AS upcoming, api.public_id('match', 1) AS finished, api.public_id('match', 5) AS bare,
                         api.public_id('player', 101) AS p101, api.public_id('player', 102) AS p102, api.public_id('player', 103) AS p103,
                         api.public_id('player', 104) AS p104`)).rows[0];
  // Match 6 (Racing Club – Stade Nord, not started): the home side computed, the away side not (under 5 elevens).
  // Match 1 (finished) keeps rows of an earlier run: never served.
  for (const [match, team, side] of [[6, 2, "home"], [1, 1, "home"]]) {
    await q(`INSERT INTO agg.match_probable_lineups(match_id, season_id, team_id, side, method, computed_at, basis_lineups, basis_from, basis_to, formation)
             VALUES ($1, 2025, $2, $3, 'probable-v1', '2025-09-05T10:15:00Z', 10, '2025-08-02', '2025-09-04', '4-3-3')`, [match, team, side]);
  }
  await q(`INSERT INTO agg.match_probable_lineup_players(match_id, team_id, player_id, role, ord, shirt_number, position_id, pitch_x, pitch_y, share,
             replaces_player_id, absence_kind, absence_label, expected_return, matches_remaining) VALUES
           (6, 2, 104, 'starter', 1, 7, 105, 0.86, 0.5, 0.9, NULL, NULL, NULL, NULL, NULL),
           (6, 2, 101, 'starter', 0, 9, 34, 0.36, 0.63, 0.4, 103, NULL, NULL, NULL, NULL),
           (6, 2, 102, 'starter', 2, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL),
           (6, 2, 103, 'absent', 0, 4, NULL, NULL, NULL, NULL, NULL, 'suspension', 'Yellow card suspension', NULL, 1),
           (1, 1, 101, 'starter', 0, 9, 34, 0.36, 0.63, 1, NULL, NULL, NULL, NULL, NULL)`);
});
after(() => owner?.end());

test("61n: the contract of a side, the other null, public ids only", { skip }, async () => {
  const { response, body } = await get(`/api/matches/${ids.upcoming}/lineups/probable`);
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    data: {
      match_id: ids.upcoming, method: "probable-v1", computedAt: "2025-09-05T10:15:00.000Z",
      home: {
        formation: "4-3-3", basis: { lineups: 10, from: "2025-08-02", to: "2025-09-04" },
        starters: [
          { player_id: ids.p101, name: "Élie Durand", shirt_number: "9", position_id: 34, pitch_x: 0.36, pitch_y: 0.63, share: 0.4,
            image_url: "https://img.example/p1.png", replaces: { player_id: ids.p103, name: "Hugo Sud" } },
          { player_id: ids.p104, name: "Cristiano Test", shirt_number: "7", position_id: 105, pitch_x: 0.86, pitch_y: 0.5, share: 0.9,
            image_url: null, replaces: null },
          { player_id: ids.p102, name: "Marc Petit", shirt_number: null, position_id: null, pitch_x: null, pitch_y: null, share: 0,
            image_url: null, replaces: null },
        ],
        absent: [
          { player_id: ids.p103, name: "Hugo Sud", image_url: null, kind: "suspension", label: "Yellow card suspension", expectedReturn: null,
            matchesRemaining: 1 },
        ],
      },
      away: null,
    },
  });
  // No internal key anywhere in the answer.
  assert.doesNotMatch(JSON.stringify(body), /"(match_key|team_key|player_key|replaces_player_id)"/);
});

test("61n: 404 for an unknown, finished or bare match, 400 for a malformed request", { skip }, async () => {
  assert.equal((await get("/api/matches/m_zzzzz9/lineups/probable")).response.status, 404);
  assert.equal((await get(`/api/matches/${ids.finished}/lineups/probable`)).response.status, 404);
  assert.equal((await get(`/api/matches/${ids.bare}/lineups/probable`)).response.status, 404);
  assert.equal((await get(`/api/matches/${ids.upcoming}/lineups/probable?season=2025`)).response.status, 400);
  assert.equal((await get(`/api/matches/${ids.upcoming}/lineups/probables`)).response.status, 404);
  // The provider's line-ups are a route of their own (match 6 has none).
  assert.equal((await get(`/api/matches/${ids.upcoming}/lineups`)).response.status, 404);
});

test("61o: cached as a match not started, its ETag following each run", { skip }, async () => {
  const path = `/api/matches/${ids.upcoming}/lineups/probable`;
  const first = await get(path);
  const sibling = await get(`/api/matches/${ids.upcoming}`);
  assert.equal(first.response.headers.get("cache-control"), sibling.response.headers.get("cache-control"));
  const etag = first.response.headers.get("etag");
  assert.match(etag, /^W\/"match-v1-/);
  assert.equal((await get(path, { "if-none-match": etag })).response.status, 304);
  await owner.query("UPDATE agg.match_probable_lineups SET computed_at = computed_at + interval '15 minutes' WHERE match_id = 6");
  const again = await get(path);
  assert.notEqual(again.response.headers.get("etag"), etag);
  assert.equal(again.body.data.computedAt, "2025-09-05T10:30:00.000Z");
});

test("61t: sides and players are read in one statement, from one snapshot", async () => {
  // No database: a reader that records each statement. A refresh of the worker committed between two
  // statements would pair one run's sides with another run's players; one statement sees one snapshot.
  const { createMatchDetailRoute } = await import("../src/routes/match-details.mjs");
  const seen = [];
  const read = async (sql) => {
    seen.push(sql);
    if (/api\.fixtures/.test(sql)) return [{ match_id: 6, id: "m_aaaaaa", status: "not_started", revision: 1, home_internal_id: 2, away_internal_id: 3 }];
    return [];
  };
  const route = createMatchDetailRoute(read);
  const url = "http://x/api/matches/m_aaaaaa/lineups/probable";
  await assert.rejects(route(new Request(url), "/api/matches/m_aaaaaa/lineups/probable", new URLSearchParams()), (e) => e.status === 404);
  assert.equal(seen.filter((sql) => /match_probable_lineup/.test(sql)).length, 1);
});

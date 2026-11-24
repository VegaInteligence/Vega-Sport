// GET /api/teams/{id}/absences: a club's current injured and suspended players (FAILURE_MODES.md §59, 59w–59af), read
// from api.team_absence_players and api.team_absences; the contract the club screen is built on.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";

let owner, team, empty, player;
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  team = (await owner.query("SELECT api.public_id('team', 1) AS id")).rows[0].id;
  empty = (await owner.query("SELECT api.public_id('team', 2) AS id")).rows[0].id;
  player = (await owner.query("SELECT api.public_id('player', 101) AS id")).rows[0].id;
});
after(() => owner?.end());

test("an unknown team is a 404, a known one without a read squad an empty list", { skip }, async () => {
  assert.equal((await get("/api/teams/t_zzzzz9/absences")).response.status, 404);
  assert.equal((await get(`/api/teams/${team}/absences?season=2025/2026`)).response.status, 400);
  const bare = await get(`/api/teams/${empty}/absences`);
  assert.equal(bare.response.status, 200);
  assert.deepEqual(bare.body.data, { id: empty, asOf: null, squad: { players: 0, read: 0 }, absences: [] });
});

test("the current squad's absences, in the contract's shape, cached as /injuries", { skip }, async () => {
  const q = (sql) => owner.query(sql);
  await q(`INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
             ('team', 'transfermarkt', '583', 1), ('player', 'transfermarkt', '9101', 101), ('player', 'transfermarkt', '9102', 102)`);
  await q(`INSERT INTO core.provider_squads(provider, club_key, season_year, player_key, read_on) VALUES
             ('transfermarkt', '583', 2025, '9101', current_date), ('transfermarkt', '583', 2025, '9102', current_date),
             ('transfermarkt', '583', 2025, '9199', current_date)`);
  await q(`INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at, read_at) VALUES
             ('injuries', '9101', 1, now() + interval '1 day', now()), ('suspensions', '9101', 1, now() + interval '1 day', now()),
             ('injuries', '9102', 1, now() + interval '1 day', now())`);
  await q(`INSERT INTO core.player_injuries(player_id, kind, label, start_date, end_date, matches_missed, source, as_of, days, season_year)
           VALUES (101, 'injury', 'Cruciate ligament tear', current_date - 30, current_date + 30, 5, 'transfermarkt', current_date, 61, 2025),
                  (101, 'injury', 'Ankle sprain', current_date - 90, current_date - 80, 1, 'transfermarkt', current_date, 11, 2025)`);
  await q(`INSERT INTO core.player_suspensions(player_id, label, start_date, end_date, days, matches_missed, matches_possible,
             competition_code, competition_id, season_year, source, as_of)
           VALUES (101, 'Yellow card suspension', current_date - 2, current_date + 4, 7, 0, 1, 'FR1', 1, 2025, 'transfermarkt', current_date)`);
  const { response, body } = await get(`/api/teams/${team}/absences`);
  assert.equal(response.status, 200);
  const today = (await q("SELECT current_date::text AS d, (current_date - 30)::text AS a, (current_date + 30)::text AS b, (current_date - 2)::text AS c, (current_date + 4)::text AS e")).rows[0];
  const who = { id: player, name: "Élie Durand", imageUrl: "https://img.example/p1.png", role: "centre_forward" };
  assert.deepEqual(body.data, {
    id: team, asOf: today.d,
    // Read (59ao): his injuries read 45 days ago at most, whatever his suspensions: 101 and 102; 9199 not linked (unknown).
    squad: { players: 3, read: 2 },
    absences: [
      { player: who, kind: "suspension", label: "Yellow card suspension", start: today.c, expectedReturn: today.e, matchesMissed: 0,
        matchesRemaining: 1, competition: { code: "FR1", id: "l_3FJFUl", name: "Ligue 1" }, readAt: today.d },
      { player: who, kind: "injury", label: "Cruciate ligament tear", start: today.a, expectedReturn: today.b, matchesMissed: 5,
        matchesRemaining: null, competition: null, readAt: today.d },
    ],
  });
  // The family of /injuries: the same validators and the same cache.
  const injuries = await get(`/api/players/${player}/injuries`);
  assert.match(response.headers.get("etag"), /^W\/"profile-v1-/);
  assert.equal(response.headers.get("cache-control"), injuries.response.headers.get("cache-control"));
  assert.equal((await get(`/api/teams/${team}/absences`, { "if-none-match": response.headers.get("etag") })).response.status, 304);
  // /injuries carries the suspension with the injuries' keys.
  assert.deepEqual(injuries.body.data.injuries[0],
    { kind: "suspension", label: "Yellow card suspension", start: today.c, end: today.e, days: 7, matchesMissed: 0, season: 2025 });
});

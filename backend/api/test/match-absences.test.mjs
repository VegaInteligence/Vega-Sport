// GET /api/matches/{id}/absences: each side's injured and suspended players on the day of a match that has kicked off
// (FAILURE_MODES.md § 77, cases 77a–77h), read from api.match_absence_players and api.match_absences (181).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";

let owner;
const ids = {};
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  const q = (sql, args) => owner.query(sql, args);
  for (const [k, type, id] of [["m5", "match", 5], ["m1", "match", 1], ["m6", "match", 6], ["t1", "team", 1], ["t2", "team", 2], ["t4", "team", 4],
    ["p101", "player", 101], ["p105", "player", 105], ["p106", "player", 106], ["p107", "player", 107]])
    ids[k] = (await q(`SELECT api.public_id('${type}', ${id}) AS id`)).rows[0].id;
  // m5: Union Sud (4, no Transfermarkt link) – Olympique Été (1), 5 Sep 2025, finished; 101 and 102 on its sheet.
  await q(`INSERT INTO core.players(id, name) VALUES (105, 'Absent Cinq'), (106, 'Absent Six'), (107, 'Absent Sept'), (108, 'Joueur Huit'),
             (109, 'Parti Neuf'), (110, 'Recrue Dix'), (111, 'Ailleurs Onze')`);
  await q(`INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
             ('team', 'transfermarkt', '583', 1), ('team', 'transfermarkt', '584', 2),
             ('player', 'transfermarkt', '9101', 101), ('player', 'transfermarkt', '9102', 102), ('player', 'transfermarkt', '9104', 104),
             ('player', 'transfermarkt', '9105', 105), ('player', 'transfermarkt', '9106', 106), ('player', 'transfermarkt', '9107', 107),
             ('player', 'transfermarkt', '9108', 108), ('player', 'transfermarkt', '9109', 109), ('player', 'transfermarkt', '9110', 110),
             ('player', 'transfermarkt', '9111', 111)`);
  // Club 1's squad of the match's season (9199 not linked: unknown); 9109 gone on 2 Sep. Club 2: only the season before (77g).
  await q(`INSERT INTO core.provider_squads(provider, club_key, season_year, player_key, read_on, absent_since) VALUES
             ('transfermarkt', '583', 2025, '9101', current_date, NULL), ('transfermarkt', '583', 2025, '9102', current_date, NULL),
             ('transfermarkt', '583', 2025, '9105', current_date, NULL), ('transfermarkt', '583', 2025, '9106', current_date, NULL),
             ('transfermarkt', '583', 2025, '9107', current_date, NULL), ('transfermarkt', '583', 2025, '9108', current_date, NULL),
             ('transfermarkt', '583', 2025, '9199', current_date, NULL), ('transfermarkt', '583', 2025, '9109', current_date, '2025-09-02'),
             ('transfermarkt', '583', 2025, '9110', current_date, NULL), ('transfermarkt', '583', 2025, '9111', current_date, NULL),
             ('transfermarkt', '584', 2024, '9104', current_date, NULL)`);
  // Reads: 9102's injuries read more than 45 days before the match day (77h); 9108's ten days before it (the oldest read).
  await q(`INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at, read_at) VALUES
             ('injuries', '9101', 1, now() + interval '1 day', now()), ('injuries', '9102', 1, now() + interval '1 day', '2025-06-01'),
             ('injuries', '9105', 1, now() + interval '1 day', now()), ('injuries', '9106', 1, now() + interval '1 day', now()),
             ('injuries', '9107', 1, now() + interval '1 day', now()), ('injuries', '9108', 1, now() + interval '1 day', '2025-08-26'),
             ('injuries', '9109', 1, now() + interval '1 day', now()), ('injuries', '9110', 1, now() + interval '1 day', now()),
             ('injuries', '9111', 1, now() + interval '1 day', now()),
             ('suspensions', '9105', 1, now() + interval '1 day', now()), ('suspensions', '9106', 1, now() + interval '1 day', now())`);
  await q(`INSERT INTO core.player_injuries(player_id, kind, label, start_date, end_date, matches_missed, source, as_of, absent_since) VALUES
             (105, 'injury', 'Hamstring injury', '2025-08-20', '2025-09-10', 2, 'transfermarkt', current_date, NULL),
             (105, 'injury', 'Ankle sprain', '2025-08-01', '2025-09-04', 1, 'transfermarkt', current_date, NULL),
             (106, 'injury', 'Knee injury', '2025-09-06', '2025-10-01', 3, 'transfermarkt', current_date, NULL),
             (107, 'injury', 'Knee surgery', '2025-08-01', NULL, NULL, 'transfermarkt', current_date, NULL),
             (107, 'illness', 'Flu', '2025-09-04', '2025-09-06', 1, 'transfermarkt', current_date, '2025-09-10'),
             (108, 'injury', 'Calf problems', '2025-08-01', NULL, NULL, 'transfermarkt', current_date, NULL),
             (101, 'injury', 'Back injury', '2025-09-01', '2025-09-20', 0, 'transfermarkt', current_date, NULL),
             (109, 'injury', 'Groin strain', '2025-09-01', '2025-09-30', 1, 'transfermarkt', current_date, NULL),
             (110, 'injury', 'Thigh problems', '2025-09-01', '2025-09-30', 1, 'transfermarkt', current_date, NULL),
             (111, 'injury', 'Shoulder injury', '2025-09-01', '2025-09-30', 1, 'transfermarkt', current_date, NULL)`);
  // 77i: 110 joined club 1 on 20 Sep (after m5); 111's last move before m5 took him to club 2 (back to club 1 on 1 Oct).
  await q(`INSERT INTO core.player_transfers(player_id, transfer_date, from_team_id, to_team_id, kind, source, as_of, source_key, pending) VALUES
             (110, '2025-09-20', 3, 1, NULL, 'transfermarkt', current_date, '110-1', false),
             (111, '2024-07-01', NULL, 1, NULL, 'transfermarkt', current_date, '111-1', false),
             (111, '2025-08-15', 1, 2, 'loan', 'transfermarkt', current_date, '111-2', false),
             (111, '2025-10-01', 2, 1, 'loan_return', 'transfermarkt', current_date, '111-3', false)`);
  // 108 played 30 minutes of m3 (3 Sep), after his open injury's start and before m5 (77c).
  await q(`INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2025, 3, 1, 108, 30)`);
  await q(`INSERT INTO core.player_suspensions(player_id, label, start_date, end_date, matches_missed, matches_possible, competition_code,
             competition_id, season_year, source, as_of) VALUES
             (106, 'Red card suspension', '2025-09-01', '2025-09-08', 1, 2, 'FR1', 1, 2025, 'transfermarkt', current_date),
             (105, 'Yellow card suspension', '2025-09-01', '2025-09-08', 0, 1, 'CL', NULL, 2025, 'transfermarkt', current_date)`);
});
after(() => owner?.end());

test("77a: an unknown match and a match not started are 404, a parameter 400", { skip }, async () => {
  assert.equal((await get("/api/matches/m_zzzzz9/absences")).response.status, 404);
  // m6 is « not_started »: 404 while its kick-off is to come; once passed, the base still says « not_started » while it
  // is played, and the route answers (the page has switched at the kick-off).
  await owner.query("UPDATE core.matches SET kickoff_at = now() + interval '1 day', match_date = current_date + 1 WHERE id = 6");
  assert.equal((await get(`/api/matches/${ids.m6}/absences`)).response.status, 404);
  await owner.query("UPDATE core.matches SET kickoff_at = now() - interval '1 hour', match_date = (now() - interval '1 hour')::date WHERE id = 6");
  const live = await get(`/api/matches/${ids.m6}/absences`);
  assert.equal(live.response.status, 200);
  assert.equal(live.body.data.on, (await owner.query("SELECT (now() - interval '1 hour')::date::text AS d")).rows[0].d);
  assert.equal((await get(`/api/matches/${ids.m5}/absences?season=2025/2026`)).response.status, 400);
});

test("77b–77h: each side's absent players on the match day", { skip }, async () => {
  const { response, body } = await get(`/api/matches/${ids.m5}/absences`);
  assert.equal(response.status, 200);
  const today = (await owner.query("SELECT current_date::text AS d")).rows[0].d;
  const who = (id, name) => ({ id, name, imageUrl: null, role: null });
  assert.deepEqual(body.data, {
    id: ids.m5,
    on: "2025-09-05",
    // 77g: a side with no Transfermarkt link has no member, never « nobody was out ».
    home: { team: ids.t4, asOf: null, squad: { players: 0, read: 0 }, absences: [] },
    away: {
      team: ids.t1,
      // 77f, 77h, 77i: 9109 gone on 2 Sep, 9110 arrived after the match and 9111 at club 2 that day are not members; 9102 read
      // too early and 9199 not linked are not read; 9108's read the oldest.
      asOf: "2025-08-26",
      squad: { players: 7, read: 5 },
      absences: [
        // 77e: the suspension of the match's competition, its remaining count unknown on the match day.
        { player: who(ids.p106, "Absent Six"), kind: "suspension", label: "Red card suspension", start: "2025-09-01", expectedReturn: "2025-09-08",
          matchesMissed: 1, matchesRemaining: null, competition: { code: "FR1", id: "l_3FJFUl", name: "Ligue 1" }, readAt: today },
        // 77b: over the match day (not the one ended the day before, nor 106's started the day after).
        { player: who(ids.p105, "Absent Cinq"), kind: "injury", label: "Hamstring injury", start: "2025-08-20", expectedReturn: "2025-09-10",
          matchesMissed: 2, matchesRemaining: null, competition: null, readAt: today },
        // 77c: open and he has not played since (not 108's, who played on 3 Sep); 77f: not 107's flu marked absent_since.
        { player: who(ids.p107, "Absent Sept"), kind: "injury", label: "Knee surgery", start: "2025-08-01", expectedReturn: null,
          matchesMissed: null, matchesRemaining: null, competition: null, readAt: today },
      ],
    },
  });
  // 77d: 101 is on m5's sheet: his back injury over the day is not shown.
  assert.ok(!body.data.away.absences.some((a) => a.player.id === ids.p101));
  // 77i: neither 110 (arrived on 20 Sep) nor 111 (at club 2 on 5 Sep) is shown.
  assert.deepEqual(body.data.away.absences.filter((a) => ["Recrue Dix", "Ailleurs Onze"].includes(a.player.name)), []);
  assert.match(response.headers.get("etag"), /^W\/"profile-v1-/);
  assert.equal((await get(`/api/matches/${ids.m5}/absences`, { "if-none-match": response.headers.get("etag") })).response.status, 304);
});

test("77g: a club without its season's squad has the season before's", { skip }, async () => {
  const { body } = await get(`/api/matches/${ids.m1}/absences`);
  assert.equal(body.data.on, "2025-09-01");
  assert.deepEqual(body.data.away, { team: ids.t2, asOf: null, squad: { players: 1, read: 0 }, absences: [] });
  assert.equal(body.data.home.team, ids.t1);
});

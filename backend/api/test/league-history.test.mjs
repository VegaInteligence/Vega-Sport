// GET /api/league-history (164, src/routes/league-history.mjs): an archived season of the five big leagues for the
// competition page. Written before the route and the reads.
//
// Failure modes and expected outcomes:
//  1. A season outside 2010/11–2020/21, a league that is not one of the five, a season the base does not hold, an
//     unknown parameter: 404 (400 for the parameter).
//  2. A club the site holds comes with its public id and crest; an archived team merged into it (merged_into) reads as
//     that club; a club only the archive knows has its archived name, no id, no crest.
//  3. The table counts played matches only; each row's colour is what the club did the next season (Champions League
//     from the next season's archived edition; relegation from the next season's league).
//  4. From 2012/13 the players are the league season's rows (core.league_player_seasons, 163), best scorers first;
//     before, the scorers of the archived goals, own goals apart.
//  5. The summary: champion and points, top scorer, goals per played match, relegated clubs.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { get, skip } from "./context.mjs";

before(() => {
  if (skip) return;
  const backend = fileURLToPath(new URL("../..", import.meta.url));
  const script = `
import sys
sys.path[:0] = [sys.argv[1]]
from vega.store import connect_local, Store
db = connect_local(sys.argv[2])
x = db.execute
with db.transaction():
    for label in ("2011/2012", "2015/2016", "2016/2017"):
        Store(db).season(label)
    comp = x("SELECT entity_id FROM core.provider_ids WHERE entity_type='competition' AND provider='pitchapi' AND provider_key='l_1Isor4'").fetchone()
    if comp:
        bl = comp[0]
    else:
        bl = x("INSERT INTO core.competitions(name) VALUES ('Bundesliga') RETURNING id").fetchone()[0]
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition','pitchapi','l_1Isor4',%s)", (bl,))
    x("INSERT INTO core.competitions(id, name) VALUES (9790, 'Deutsche Bundesliga'), (9791, 'Champions League (archive)')")
    x("INSERT INTO core.assets(id, kind, source_url) VALUES (9799, 'crest', 'https://cdn.test/bayern.png') ON CONFLICT DO NOTHING")
    x("""INSERT INTO core.teams(id, name, crest_asset_id) VALUES (9701, 'Bayern Munich', 9799), (9702, 'Borussia Dortmund', NULL),
         (9703, 'SV Darmstadt 98', NULL), (9704, 'Hannover 96', NULL), (9705, 'RB Leipzig', NULL)""")
    x("INSERT INTO core.teams(id, name, merged_into) VALUES (9711, 'Borussia Dortmund (archive)', 9702)")
    x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
         ('team','pitchapi','t_bayern1',9701), ('team','pitchapi','t_bvb0001',9702)""")
    x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, archive_key, archive_name, archive_country) VALUES
         (9720, 9790, 2015, '2015/2016', '2015-16/de.1', 'Deutsche Bundesliga 2015/16', 'Allemagne'),
         (9721, 9790, 2016, '2016/2017', '2016-17/de.1', 'Deutsche Bundesliga 2016/17', 'Allemagne'),
         (9722, 9791, 2016, '2016/2017', 'g:champions-league', 'Ligue des champions', 'Europe'),
         (9723, 9790, 2011, '2011/2012', '2011-12/de.1', 'Deutsche Bundesliga 2011/12', 'Allemagne')""")
    rows = [
        (9720, 2015, '2015-08-14', 'Matchday 1', 9701, 9711, 5, 1, 0), (9720, 2015, '2015-08-15', 'Matchday 1', 9703, 9704, 2, 1, 1),
        (9720, 2015, '2015-08-22', 'Matchday 2', 9702, 9703, 2, 2, 2), (9720, 2015, '2015-08-23', 'Matchday 2', 9704, 9701, 0, 1, 3),
        (9720, 2015, '2016-05-14', 'Matchday 34', 9701, 9703, None, None, 4),
        (9721, 2016, '2016-08-26', 'Matchday 1', 9701, 9703, 3, 0, 0), (9721, 2016, '2016-08-27', 'Matchday 1', 9705, 9701, 1, 1, 1),
        (9722, 2016, '2016-09-13', None, 9701, 9702, 2, 0, 0),
        (9723, 2011, '2011-08-05', 'Matchday 1', 9702, 9701, 3, 1, 0),
    ]
    for edition, season, day, rnd, home, away, hs, aws, pos in rows:
        rid = None
        if rnd:
            rid = x("INSERT INTO core.rounds(competition_season_id, name) VALUES (%s,%s) ON CONFLICT DO NOTHING RETURNING id", (edition, rnd)).fetchone()
            rid = rid[0] if rid else x("SELECT id FROM core.rounds WHERE competition_season_id=%s AND name=%s", (edition, rnd)).fetchone()[0]
        x("""INSERT INTO core.matches(competition_season_id, season_id, match_date, round_id, status, home_team_id, away_team_id, home_score,
             away_score, source, archive_key, archive_position) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'openfootball',%s,%s)""",
          (edition, season, day, rid, 'finished' if hs is not None else 'not_started', home, away, hs, aws, f"t:{edition}:{pos}", pos))
    match = x("SELECT id FROM core.matches WHERE competition_season_id=9723").fetchone()[0]
    x("""INSERT INTO core.match_events(season_id, match_id, team_id, seq, event_type, player_name, is_own_goal) VALUES
         (2011, %s, 9702, 1, 'goal', 'Robert Lewandowski', false), (2011, %s, 9702, 2, 'goal', 'Robert Lewandowski', false),
         (2011, %s, 9702, 3, 'goal', 'Jérôme Boateng', true), (2011, %s, 9701, 4, 'goal', 'Mario Gómez', false)""", (match, match, match, match))
    x("""INSERT INTO core.league_player_seasons(competition_id, season_id, player_key, player_name, club_key, club_name, team_id,
           matches, minutes, goals, assists, yellow_cards, red_cards) VALUES
         (%s, 2015, '38253', 'Robert Lewandowski', '27', 'Bayern Munich', 9701, 32, 2747, 30, 3, 2, 0),
         (%s, 2015, '1', 'Sandro Wagner', '105', 'SV Darmstadt 98', NULL, 32, 2700, 14, 2, 4, 0)""", (bl, bl))
`;
  const done = spawnSync("python3", ["-c", script, backend, process.env.VEGA_V2_API_NODE_TEST_DSN], { encoding: "utf8" });
  assert.equal(done.status, 0, done.stderr);
});

const path = (league, season) => `/api/league-history?competition=${league}&season=${encodeURIComponent(season)}`;

test("an archived Bundesliga season: table, colours, matchdays, players, summary", { skip }, async () => {
  const { response, body } = await get(path("l_1Isor4", "2015/2016"));
  assert.equal(response.status, 200);
  const d = body.data;
  assert.deepEqual([d.competition, d.name, d.season, d.edition], ["l_1Isor4", "Bundesliga", "2015/2016", "2015-16/de.1"]);
  assert.deepEqual(d.standings.map((r) => [r.rank, r.team.name, r.team.id, r.points, r.played, r.zone]), [
    [1, "Bayern Munich", "t_bayern1", 6, 2, "cl"],
    [2, "SV Darmstadt 98", null, 4, 2, null],
    [3, "Borussia Dortmund", "t_bvb0001", 1, 2, "relegation"],
    [4, "Hannover 96", null, 0, 2, "relegation"],
  ]);
  assert.equal(d.standings[0].team.imageUrl, "https://cdn.test/bayern.png");
  assert.deepEqual(d.matchdays.map((g) => [g.number, g.matches.length]), [[1, 2], [2, 2], [34, 1]]);
  assert.deepEqual(d.matchdays[0].matches[0], {
    date: "2015-08-14", home: { id: "t_bayern1", name: "Bayern Munich", imageUrl: "https://cdn.test/bayern.png" },
    away: { id: "t_bvb0001", name: "Borussia Dortmund", imageUrl: null }, score: [5, 1],
  });
  assert.equal(d.matchdays[2].matches[0].score, null);
  assert.equal(d.players.kind, "appearances");
  assert.equal(d.players.source.license, "CC0-1.0");
  assert.equal(d.players.incomplete, false);
  assert.deepEqual(d.players.rows.map((p) => [p.name, p.club.name, p.club.id, p.goals, p.minutes]), [
    ["Robert Lewandowski", "Bayern Munich", "t_bayern1", 30, 2747], ["Sandro Wagner", "SV Darmstadt 98", null, 14, 2700],
  ]);
  assert.deepEqual(d.summary, {
    champion: { team: { id: "t_bayern1", name: "Bayern Munich", imageUrl: "https://cdn.test/bayern.png" }, points: 6 },
    topScorer: { name: "Robert Lewandowski", goals: 30 }, goalsPerMatch: 3.5,
    relegated: [{ id: "t_bvb0001", name: "Borussia Dortmund", imageUrl: null }, { id: null, name: "Hannover 96", imageUrl: null }],
  });
});

test("before 2012/13 the players are the archived scorers, own goals apart", { skip }, async () => {
  const d = (await get(path("l_1Isor4", "2011/2012"))).body.data;
  assert.equal(d.players.kind, "scorers");
  assert.deepEqual(d.players.rows.map((p) => [p.name, p.club.name, p.goals]), [["Robert Lewandowski", "Borussia Dortmund", 2], ["Mario Gómez", "Bayern Munich", 1]]);
});

test("outside the archived seasons: 404; an unknown parameter: 400", { skip }, async () => {
  assert.equal((await get(path("l_1Isor4", "2021/2022"))).response.status, 404);
  assert.equal((await get(path("l_1Isor4", "2009/2010"))).response.status, 404);
  assert.equal((await get(path("l_9xxxxx", "2015/2016"))).response.status, 404);
  assert.equal((await get(path("l_1Isor4", "2014/2015"))).response.status, 404); // not held
  assert.equal((await get(path("l_1Isor4", "2015/2016") + "&x=1")).response.status, 400);
  const first = await get(path("l_1Isor4", "2015/2016"));
  assert.equal((await get(path("l_1Isor4", "2015/2016"), { "if-none-match": first.response.headers.get("etag") })).response.status, 304);
});

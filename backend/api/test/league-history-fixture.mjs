// The archived seasons of the API seed's league-history tests (league-history.test.mjs, league-history-validator.test.mjs):
// written into the seeded test base, after test/seed.py (context.mjs).
// - Bundesliga 2015/16 (players), 2016/17 (its next season, with the Champions League 2016/17), 2011/12 (scorers);
// - Bundesliga 2020/21 (six clubs), whose next season is PitchAPI's 2021/22 edition (the last archived season);
// - Ligue 1 2016/17 in two archive keys (openfootball's, engsoccerdata's): the edition holding the most matches is read.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = `
import sys
sys.path[:0] = [sys.argv[1]]
from vega.store import connect_local, Store
db = connect_local(sys.argv[2])
x = db.execute
with db.transaction():
    for label in ("2011/2012", "2015/2016", "2016/2017", "2020/2021", "2021/2022"):
        Store(db).season(label)
    comp = x("SELECT entity_id FROM core.provider_ids WHERE entity_type='competition' AND provider='pitchapi' AND provider_key='l_1Isor4'").fetchone()
    if comp:
        bl = comp[0]
    else:
        bl = x("INSERT INTO core.competitions(name) VALUES ('Bundesliga') RETURNING id").fetchone()[0]
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition','pitchapi','l_1Isor4',%s)", (bl,))
    x("INSERT INTO core.competitions(id, name) VALUES (9790, 'Deutsche Bundesliga'), (9791, 'Champions League (archive)'), (9792, 'Ligue 1 (archive)'), (9793, 'Ligue 1 (engsoccerdata)')")
    x("INSERT INTO core.assets(id, kind, source_url) VALUES (9799, 'crest', 'https://cdn.test/bayern.png') ON CONFLICT DO NOTHING")
    x("""INSERT INTO core.teams(id, name, crest_asset_id) VALUES (9701, 'Bayern Munich', 9799), (9702, 'Borussia Dortmund', NULL),
         (9703, 'SV Darmstadt 98', NULL), (9704, 'Hannover 96', NULL), (9705, 'RB Leipzig', NULL)""")
    x("INSERT INTO core.teams(id, name, merged_into) VALUES (9711, 'Borussia Dortmund (archive)', 9702)")
    # The next season's Champions League names Bayern as openfootball's European files do, a row never merged.
    x("INSERT INTO core.teams(id, name) VALUES (9712, 'FC Bayern Munich (GER)')")
    x("INSERT INTO core.teams(id, name) VALUES (9706, 'Werder Bremen'), (9721, 'Olympique Lyonnais'), (9722, 'AS Monaco'), (9723, 'Paris SG')")
    x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
         ('team','pitchapi','t_bayern1',9701), ('team','pitchapi','t_bvb0001',9702)""")
    x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, archive_key, archive_name, archive_country) VALUES
         (9720, 9790, 2015, '2015/2016', '2015-16/de.1', 'Deutsche Bundesliga 2015/16', 'Allemagne'),
         (9721, 9790, 2016, '2016/2017', '2016-17/de.1', 'Deutsche Bundesliga 2016/17', 'Allemagne'),
         (9722, 9791, 2016, '2016/2017', 'g:champions-league', 'Ligue des champions', 'Europe'),
         (9723, 9790, 2011, '2011/2012', '2011-12/de.1', 'Deutsche Bundesliga 2011/12', 'Allemagne'),
         (9724, 9790, 2020, '2020/2021', '2020-21/de.1', 'Deutsche Bundesliga 2020/21', 'Allemagne'),
         (9725, 9792, 2016, '2016/2017', '2016-17/fr.1', 'Ligue 1 2016/17', 'France'),
         (9726, 9793, 2016, '2016/2017', 'engsoccerdata/france/all/2016', NULL, 'France')""")
    # PitchAPI's 2021/22 Bundesliga: the next season of 2020/21.
    x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, is_current) VALUES (9727, %s, 2021, '2021/2022', false)", (bl,))
    rows = [
        (9720, 2015, '2015-08-14', 'Matchday 1', 9701, 9711, 5, 1, 0), (9720, 2015, '2015-08-15', 'Matchday 1', 9703, 9704, 2, 1, 1),
        (9720, 2015, '2015-08-22', 'Matchday 2', 9702, 9703, 2, 2, 2), (9720, 2015, '2015-08-23', 'Matchday 2', 9704, 9701, 0, 1, 3),
        (9720, 2015, '2016-05-14', 'Matchday 34', 9701, 9703, None, None, 4),
        (9721, 2016, '2016-08-26', 'Matchday 1', 9701, 9703, 3, 0, 0), (9721, 2016, '2016-08-27', 'Matchday 1', 9705, 9701, 1, 1, 1),
        (9722, 2016, '2016-09-13', None, 9712, 9702, 2, 0, 0),
        (9723, 2011, '2011-08-05', 'Matchday 1', 9702, 9701, 3, 1, 0),
        # 2020/21: Bayern, Dortmund, Leipzig, Bremen, Hannover, Darmstadt (ranks 1 to 6).
        (9724, 2020, '2020-09-18', 'Matchday 1', 9701, 9703, 3, 0, 0), (9724, 2020, '2020-09-19', 'Matchday 1', 9711, 9704, 2, 1, 1),
        (9724, 2020, '2020-09-20', 'Matchday 1', 9705, 9706, 1, 1, 2),
        (9725, 2016, '2016-08-12', 'Journée 1', 9721, 9722, 1, 0, 0), (9725, 2016, '2016-08-13', 'Journée 1', 9723, 9721, 2, 2, 1),
        (9726, 2016, '2016-08-12', None, 9721, 9722, 1, 0, 0),
    ]
    for edition, season, day, rnd, home, away, hs, aws, pos in rows:
        rid = None
        if rnd:
            rid = x("INSERT INTO core.rounds(competition_season_id, name) VALUES (%s,%s) ON CONFLICT DO NOTHING RETURNING id", (edition, rnd)).fetchone()
            rid = rid[0] if rid else x("SELECT id FROM core.rounds WHERE competition_season_id=%s AND name=%s", (edition, rnd)).fetchone()[0]
        x("""INSERT INTO core.matches(competition_season_id, season_id, match_date, round_id, status, home_team_id, away_team_id, home_score,
             away_score, source, archive_key, archive_position) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'openfootball',%s,%s)""",
          (edition, season, day, rid, 'finished' if hs is not None else 'not_started', home, away, hs, aws, f"t:{edition}:{pos}", pos))
    # PitchAPI's 2021/22 Bundesliga holds Bayern, Leipzig, Dortmund and Bremen: Hannover and Darmstadt went down.
    x("""INSERT INTO core.matches(competition_season_id, season_id, match_date, status, home_team_id, away_team_id, home_score, away_score, source)
         VALUES (9727, 2021, '2021-08-13', 'finished', 9701, 9705, 1, 0, 'pitchapi'), (9727, 2021, '2021-08-14', 'finished', 9702, 9706, 2, 2, 'pitchapi')""")
    match = x("SELECT id FROM core.matches WHERE competition_season_id=9723").fetchone()[0]
    x("""INSERT INTO core.match_events(season_id, match_id, team_id, seq, event_type, player_name, is_own_goal) VALUES
         (2011, %s, 9702, 1, 'goal', 'Robert Lewandowski', false), (2011, %s, 9702, 2, 'goal', 'Robert Lewandowski', false),
         (2011, %s, 9702, 3, 'goal', 'Jérôme Boateng', true), (2011, %s, 9701, 4, 'goal', 'Mario Gómez', false)""", (match, match, match, match))
    x("""INSERT INTO core.league_player_seasons(competition_id, season_id, player_key, player_name, club_key, club_name, team_id,
           matches, minutes, goals, assists, yellow_cards, red_cards) VALUES
         (%s, 2015, '38253', 'Robert Lewandowski', '27', 'Bayern Munich', 9701, 32, 2747, 30, 3, 2, 0),
         (%s, 2015, '1', 'Sandro Wagner', '105', 'SV Darmstadt 98', NULL, 32, 2700, 14, 2, 4, 0)""", (bl, bl))
`;

export function seedLeagueHistory() {
  const backend = fileURLToPath(new URL("../..", import.meta.url));
  const done = spawnSync("python3", ["-c", SCRIPT, backend, process.env.VEGA_V2_API_NODE_TEST_DSN], { encoding: "utf8" });
  assert.equal(done.status, 0, done.stderr);
}

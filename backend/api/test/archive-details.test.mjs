// GET /api/archives/details and GET /api/archives/details?match= (140): what football-data.co.uk adds to the archived
// league seasons 2000/01–2020/21 (core.footballdata_matches, vega/sources/footballdata.py). No page reads it yet: it
// is how a person or an agent sees what the base holds.
//
// Failure modes and expected outcomes, written before the views and the route:
//  1. The coverage lists every division and season the files hold, with its country and level as the archives name
//     them, the rows read, the rows paired with an archived match, those with match statistics and those with prices;
//     ordered by country, level, season. Any parameter but `match`: 400.
//  2. An archived match's details: the base's day and score, the file's score (they may differ), the half-time
//     score, the kick-off time, the referee and the attendance when the file gives them; each side's statistics, a
//     statistic the file does not give being null (never 0), and `stats` null when the file gives none; the 1X2
//     prices the file gives, each bookmaker once, a closing price apart.
//  3. An archived match no row pairs with, an unknown key: 404. A key that is no key: 400.
//  4. The source's credit and its terms come with every answer.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { get, skip } from "./context.mjs";

// The reader's samples (backend/tests/footballdata_samples.py) over a hand-made archive, written by the reader itself.
before(() => {
  if (skip) return;
  const tests = fileURLToPath(new URL("../../tests", import.meta.url)), backend = fileURLToPath(new URL("../..", import.meta.url));
  const script = `
import re, sys
sys.path[:0] = [sys.argv[1], sys.argv[2]]
from datetime import datetime, timezone
from vega.store import connect_local, Store
from vega.sources import footballdata
import footballdata_samples
now = datetime(2026, 11, 19, tzinfo=timezone.utc)
db = connect_local(sys.argv[3])
x = db.execute
files = footballdata_samples.files()
footballdata.FILES, footballdata.MIN_VOTES = footballdata_samples.digests(files), 1
with db.transaction():
    for label in ("2010/2011", "2011/2012"):
        Store(db).season(label)
    x("INSERT INTO core.teams(id, name) VALUES (9101, 'Olympique Lyonnais'), (9102, 'AS Monaco'), (9103, 'Paris Saint-Germain'), (9104, 'AS Saint-Étienne')")
    x("INSERT INTO core.competitions(id, name) VALUES (9100, 'French Ligue 1')")
    x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, archive_key, archive_name, archive_country)
         VALUES (9110, 9100, 2010, '2010/2011', 'engsoccerdata/france/all/2010', 'Championnat de France', 'France'),
                (9111, 9100, 2011, '2011/2012', 'engsoccerdata/france/all/2011', 'Championnat de France', 'France')""")
    names = {9101: "Olympique Lyonnais", 9102: "AS Monaco", 9103: "Paris Saint-Germain", 9104: "AS Saint-Étienne"}
    for edition, season, day, home, away, hg, ag, key in [
            (9110, 2010, "2010-08-07", 9101, 9102, 0, 0, "fd:lyon-monaco"), (9110, 2010, "2010-08-08", 9103, 9104, 3, 1, "fd:psg-asse"),
            (9110, 2010, "2010-08-14", 9102, 9103, 2, 1, "fd:monaco-psg"), (9111, 2011, "2011-08-06", 9102, 9101, 1, 2, "fd:monaco-lyon"),
            (9111, 2011, "2011-08-07", 9104, 9103, 0, 1, "fd:asse-psg"), (9111, 2011, "2011-09-30", 9101, 9104, 1, 1, "fd:unpaired")]:
        x("""INSERT INTO core.matches(competition_season_id, season_id, match_date, status, home_team_id, away_team_id, home_score, away_score,
             source, archive_key, home_team_name, away_team_name) VALUES (%s,%s,%s,'finished',%s,%s,%s,%s,'engsoccerdata',%s,%s,%s)""",
          (edition, season, day, home, away, hg, ag, key, names[home], names[away]))
    def fetch(url, as_text=False, as_bytes=False):
        found = re.fullmatch(r"https://football-data\\.co\\.uk/mmz4281/(\\d{4})/([A-Z0-9]+)\\.csv", url)
        return files[f"{found[2]}/{found[1]}"]
    footballdata.run(db, fetch, "history", now)
`;
  const done = spawnSync("python3", ["-c", script, backend, tests, process.env.VEGA_V2_API_NODE_TEST_DSN], { encoding: "utf8" });
  assert.equal(done.status, 0, done.stderr);
});

const credit = (body) => {
  assert.equal(body.data.credit.name, "Football-Data");
  assert.equal(body.data.credit.url, "https://www.football-data.co.uk");
  assert.match(body.data.credit.terms, /private individuals/);
};

test("the coverage: each division and season, what is read and paired", { skip }, async () => {
  const { response, body } = await get("/api/archives/details");
  assert.equal(response.status, 200);
  credit(body);
  assert.deepEqual(body.data.coverage, [
    { division: "F1", country: "France", level: 1, season: "2010/2011", matches: 3, paired: 3, withStats: 2, withOdds: 2 },
    { division: "F1", country: "France", level: 1, season: "2011/2012", matches: 2, paired: 2, withStats: 1, withOdds: 1 },
    { division: "N1", country: "Pays-Bas", level: 1, season: "2010/2011", matches: 2, paired: 0, withStats: 0, withOdds: 2 },
  ]);
  assert.equal((await get("/api/archives/details?season=2010/2011")).response.status, 400);
});

test("an archived match's details: half-time, statistics by side, prices", { skip }, async () => {
  const { response, body } = await get("/api/archives/details?match=fd:psg-asse");
  assert.equal(response.status, 200);
  credit(body);
  const { credit: _, ...details } = body.data;
  assert.deepEqual(details, {
    match: "fd:psg-asse", date: "2010-08-08", score: [3, 1], sourceScore: [3, 1], halfTime: [1, 1],
    kickoff: null, referee: null, attendance: null,
    stats: {
      home: { shots: 17, shotsOnTarget: 9, woodwork: null, corners: 7, fouls: 10, freeKicksConceded: null, offsides: null, yellowCards: 0, redCards: 0, bookingPoints: null },
      away: { shots: 8, shotsOnTarget: 3, woodwork: null, corners: 2, fouls: 14, freeKicksConceded: null, offsides: null, yellowCards: 3, redCards: 1, bookingPoints: null },
    },
    odds: [
      { bookmaker: "bet365", closing: false, home: 1.8, draw: 3.5, away: 4.5 },
      { bookmaker: "market-average", closing: false, home: 1.78, draw: 3.45, away: 4.4 },
      { bookmaker: "market-maximum", closing: false, home: 1.85, draw: 3.6, away: 4.8 },
    ],
  });
  const later = (await get("/api/archives/details?match=fd:monaco-lyon")).body.data;
  assert.equal(later.kickoff, "20:00");
  assert.equal(later.referee, "A Bonnet");
  assert.deepEqual(later.odds.map((o) => [o.bookmaker, o.closing]), [["pinnacle", false], ["pinnacle", true], ["market-average", false], ["market-maximum", false]]);
  // A match without statistics in its file has none, not zeros; an odd of 1 is no odd.
  const bare = (await get("/api/archives/details?match=fd:monaco-psg")).body.data;
  assert.equal(bare.stats, null);
  assert.deepEqual(bare.odds, []);
  assert.deepEqual(bare.halfTime, [1, 0]);
  // The archive and the file may disagree on a score: both are served, the base's as `score`.
  assert.deepEqual([bare.score, bare.sourceScore], [[2, 1], [2, 2]]);
});

test("no row, an unknown key, a key that is no key", { skip }, async () => {
  assert.equal((await get("/api/archives/details?match=fd:unpaired")).response.status, 404);
  assert.equal((await get("/api/archives/details?match=r:nowhere:1")).response.status, 404);
  assert.equal((await get("/api/archives/details?match=" + "x".repeat(300))).response.status, 400);
  assert.equal((await get("/api/archives/details?match=a%20b")).response.status, 400);
  assert.equal((await get("/api/archives/details?match=fd:psg-asse&q=1")).response.status, 400);
});

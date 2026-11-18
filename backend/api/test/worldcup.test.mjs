// GET /api/worldcup/matches?edition= and GET /api/worldcup/matches/{key} (138): an archived World Cup match's details,
// from the Fjelstul World Cup Database (core.worldcup_*, vega/sources/worldcup.py). Mock-up validated 18 Nov 2026.
//
// Failure modes and expected outcomes, written before the views and the route:
//  1. The edition's index lists the men's matches paired with an archived match, each under its key, its day and the
//     teams as the archive names them, in the archive's order (the bracket finds its ties by them). An edition with
//     no paired match: 404. A year that is no year, any other parameter: 400.
//  2. A match's details are oriented as the archived match: its home side is the archive's home side, whatever the
//     database's order (the 1974 final: West Germany first in the archive, the Netherlands first in the database).
//     Its score is the base's.
//  3. A women's match, a match no archived match pairs with, an unknown key: 404. A key that is no key: 400.
//  4. Line-ups by side, starters first, each player with his shirt number and position (a number 0 or a position the
//     database does not give: null). Before 1970 the database has none: empty lists, never a fabricated eleven.
//  5. Events by time: goals (a penalty, an own goal counted for the other side), cards (yellow, second yellow, red),
//     substitutions (off and on, each its own row: two changes of one minute are not paired by the API). A player of
//     a single name keeps it.
//  6. A shoot-out's kicks in the order taken, each with its side; none when there was no shoot-out.
//  7. The licence's credit comes with every match: the author, the licence, the repository.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { get, skip } from "./context.mjs";

// The database's samples (backend/tests/worldcup_samples.py) and a 1974 archive, written by the readers themselves.
before(() => {
  if (skip) return;
  const tests = fileURLToPath(new URL("../../tests", import.meta.url)), backend = fileURLToPath(new URL("../..", import.meta.url));
  const script = `
import sys
sys.path[:0] = [sys.argv[1], sys.argv[2]]
from datetime import datetime, timezone
from vega.store import connect_local
from vega.sources import cups, worldcup
import worldcup_samples
now = datetime(2026, 11, 18, tzinfo=timezone.utc)
db = connect_local(sys.argv[3])
archive = {"name": "World Cup 1974", "season": "1974", "source": {"name": "OpenFootball", "url": "https://github.com/openfootball/worldcup.json"}, "matches": [
    {"round": "Final", "date": "1974-07-07", "team1": "West Germany", "team2": "Netherlands", "score": [2, 1]},
    {"round": "Matchday 1", "group": "Group 1", "date": "1974-06-14", "team1": "USA", "team2": "Sweden", "score": {"ft": [1, 1], "et": [1, 1], "p": [4, 5]}},
    {"round": "Matchday 1", "group": "Group 2", "date": "1974-06-13", "team1": "Brazil", "team2": "Yugoslavia", "score": [0, 0]}]}
files = worldcup_samples.texts()
worldcup.FILES, worldcup.COMMIT = worldcup_samples.digests(files), "a" * 40
with db.transaction():
    cups.save(db, "open-cups", "world-cup-history", "1974", archive, now)
    worldcup.run(db, lambda url, as_text=False: files[url.rsplit("/", 1)[1][:-4]], "worldcup", now)
`;
  const done = spawnSync("python3", ["-c", script, backend, tests, process.env.VEGA_V2_API_NODE_TEST_DSN], { encoding: "utf8" });
  assert.equal(done.status, 0, done.stderr);
});

test("an edition's index: its paired men's matches, as the archive names them", { skip }, async () => {
  const { response, body } = await get("/api/worldcup/matches?edition=1974");
  assert.equal(response.status, 200);
  assert.deepEqual(body.data, { edition: 1974, matches: [
    { key: "M-1974-01", date: "1974-06-14", home: "USA", away: "Sweden" },
    { key: "M-1974-38", date: "1974-07-07", home: "West Germany", away: "Netherlands" },
  ] });
  assert.equal((await get("/api/worldcup/matches?edition=1991")).response.status, 404); // the women's: paired with nothing
  assert.equal((await get("/api/worldcup/matches?edition=1975")).response.status, 404);
  for (const bad of ["/api/worldcup/matches", "/api/worldcup/matches?edition=74", "/api/worldcup/matches?edition=1974&season=2026/2027"])
    assert.equal((await get(bad)).response.status, 400, bad);
});

test("a match's details, oriented as the archived match", { skip }, async () => {
  const { response, body } = await get("/api/worldcup/matches/M-1974-38");
  assert.equal(response.status, 200);
  const m = body.data;
  assert.deepEqual([m.key, m.edition, m.stage, m.group, m.date, m.time], ["M-1974-38", 1974, "final", null, "1974-07-07", "16:00"]);
  assert.deepEqual(m.stadium, { name: "Olympiastadion", city: "Munich", country: "West Germany" });
  assert.deepEqual(m.referee, { name: "Jack Taylor", country: "England" });
  assert.deepEqual([m.home, m.away], [{ name: "West Germany", manager: "Helmut Schön" }, { name: "Netherlands", manager: "Rinus Michels" }]);
  assert.deepEqual([m.score, m.extraTime, m.penalties], [[2, 1], false, null]);
  assert.deepEqual(m.lineups, {
    home: [{ person: "P-00002", name: "Gerd Müller", number: 13, position: "CF", starter: true },
           { person: "P-00003", name: "Jairzinho", number: 20, position: "FW", starter: false }],
    away: [{ person: "P-00001", name: "Johan Cruyff", number: 14, position: "FW", starter: true }],
  });
  assert.deepEqual(m.events.map((e) => [e.minute, e.stoppage, e.side, e.kind, e.person, e.name]), [
    [2, 0, "away", "penalty", "P-00001", "Johan Cruyff"],
    [23, 0, "away", "yellow", "P-00001", "Johan Cruyff"],
    [45, 1, "home", "goal", "P-00002", "Gerd Müller"],
    [60, 0, "home", "own_goal", "P-00001", "Johan Cruyff"],
    [68, 0, "home", "off", "P-00002", "Gerd Müller"],
    [68, 0, "home", "on", "P-00003", "Jairzinho"],
    [80, 0, "away", "second_yellow", "P-00001", "Johan Cruyff"],
  ]);
  assert.deepEqual(m.kicks, []);
  assert.match(m.credit.name, /Joshua C\. Fjelstul/);
  assert.match(m.credit.license, /CC-BY-SA 4\.0/);
  assert.equal(m.credit.url, "https://github.com/jfjelstul/worldcup");
});

test("a shoot-out's kicks in order; a match without line-ups has empty lists", { skip }, async () => {
  const m = (await get("/api/worldcup/matches/M-1974-01")).body.data;
  assert.deepEqual([m.home.name, m.away.name, m.score, m.extraTime, m.penalties], ["USA", "Sweden", [1, 1], true, [4, 5]]);
  assert.deepEqual(m.kicks.map((k) => [k.side, k.name, k.converted]), [["away", "Gerd Müller", true], ["home", "Jairzinho", false]]);
  assert.deepEqual(m.lineups, { home: [], away: [] });
  assert.deepEqual([m.referee, m.home.manager, m.away.manager], [null, null, null]);
});

test("what is not served: a women's match, an unpaired one, an unknown key, a malformed one", { skip }, async () => {
  for (const key of ["M-1991-01", "M-1974-99"]) assert.equal((await get(`/api/worldcup/matches/${key}`)).response.status, 404, key);
  for (const bad of ["/api/worldcup/matches/1974-38", "/api/worldcup/matches/M-1974-38?x=1"]) assert.equal((await get(bad)).response.status, 400, bad);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  createHomeReadRoute,
  HOME_TOP_FIVE,
  HOME_TOP_SEVEN,
  HOME_UEFA,
  HOME_SIMPLE_LEAGUES,
  HOME_FEATURED_CLUBS,
} from "../dashboard/backend/services/relational-home.js";
import {
  TOP_FIVE_IDS,
  TOP_SEVEN_IDS,
  UEFA_IDS,
  leagueProgress,
  teamRanks,
  matchdayWindow,
  weekResults,
  selectMatchOfTheWeek,
  weekPerformances,
  playerOfTheWeek,
  seasonTotals,
  seasonLeaders,
  recentRatings,
  bestWinStreak,
  bestDefences,
  biggestWin,
  seasonProgress,
  upcomingHighlights,
  personalClubIds,
} from "../dashboard/frontend/src/services/home-insights.js";
import { FEATURED_CLUB_IDS } from "../dashboard/frontend/src/services/home.js";
import { SIMPLE_LEAGUES } from "../dashboard/frontend/src/services/competition-standings.js";

const season = "2026/2027",
  leagueId = "l_3FJFUl",
  currentTime = Date.parse("2026-11-06T12:00:00Z");
const clubs = [
  { id: "t_41iFW3", name: "Paris", imageUrl: "paris.png" },
  { id: "t_0xMlRV", name: "Lyon", imageUrl: "lyon.png" },
  { id: "t_mid001", name: "Nice", imageUrl: "nice.png" },
  { id: "t_mid002", name: "Lille", imageUrl: "lille.png" },
];
const dateList = [
  "2026-10-01",
  "2026-10-10",
  "2026-10-20",
  "2026-11-02",
  "2026-11-04",
];
const game = (id, date, home, away, score = [1, 0], extra = {}) => ({
  id,
  season,
  leagueId,
  league: "Ligue 1",
  country: "FRA",
  date,
  status: "finished",
  timeUtc: date + "T19:00:00Z",
  home: { ...clubs[home], score: score[0], xg: 1.2 },
  away: { ...clubs[away], score: score[1], xg: 0.4 },
  shots: [],
  stats: [],
  ...extra,
});
const makeFixture = (m) => ({
  id: m.id,
  season,
  date: m.date,
  time_utc: m.timeUtc,
  status: m.status,
  home_team: { id: m.home.id, name: m.home.name, image_url: m.home.imageUrl },
  away_team: { id: m.away.id, name: m.away.name, image_url: m.away.imageUrl },
  league: { id: m.leagueId, name: m.league },
  score_home: m.home.score,
  score_away: m.away.score,
});
const games = dateList.flatMap((date, i) => [
  game(`m_table${i}a`, date, 0, 1, i === 4 ? [5, 0] : [1, 0]),
  game(`m_table${i}b`, date, 2, 3, [1, 1]),
]);
games.push(
  game("m_portug", "2026-11-04", 2, 3, [1, 0], {
    leagueId: "l_4QexZg",
    league: "Liga Portugal",
    country: "POR",
  }),
);
games[8].shots.push({
  id: "shot1",
  teamId: clubs[0].id,
  minute: 21,
  xg: 0.5,
  isGoal: true,
  isOwnGoal: false,
});
games[8].stats.push({ key: "expected_goals", home: 1.4, away: 0.3 });
const future = [
  game("m_next01", "2026-11-07", 0, 1, [null, null], {
    status: "not_started",
    timeUtc: "2026-11-07T15:00:00Z",
  }),
  game("m_next02", "2026-11-07", 0, 3, [null, null], {
    status: "not_started",
    leagueId: "l_0bfbkO",
    league: "Champions League",
    timeUtc: "2026-11-07T20:00:00Z",
  }),
  game("m_next03", "2026-11-06", 2, 3, [null, null], {
    status: "not_started",
    timeUtc: "2026-11-06T18:00:00Z",
  }),
];
const appearance = (id, playerId, match, values = {}) => ({
  id,
  playerId,
  matchId: match.id,
  teamId: match.home.id,
  team: match.home.name,
  leagueId: match.leagueId,
  league: match.league,
  country: match.country,
  season,
  date: match.date,
  name: playerId,
  imageUrl: null,
  minutes: 90,
  rating: 7,
  goals: 0,
  assists: 0,
  xg: 0.4,
  xa: 0,
  ...values,
});
const apps = [
  appearance("a_home01", "p_alpha1", games[0], {
    name: "Alpha",
    rating: 6,
    goals: 1,
  }),
  appearance("a_home02", "p_alpha1", games[6], {
    name: "Alpha",
    minutes: 10,
    rating: 10,
    goals: 1,
    xg: null,
  }),
  appearance("a_home03", "p_alpha1", games[8], {
    name: "Alpha",
    rating: 8,
    goals: 3,
    xg: 1,
  }),
  appearance("a_home04", "p_bravo1", games[6], {
    name: "Bravo",
    rating: 8,
    goals: 2,
    xg: 2,
  }),
  appearance("a_home05", "p_bravo1", games[8], {
    name: "Bravo",
    rating: 9,
    goals: 2,
    xg: 2,
  }),
  appearance("a_home06", "p_gamma1", games[9], {
    name: "Gamma",
    rating: 7,
    goals: 0,
    xg: 3,
  }),
  appearance("a_home07", "p_other1", games[10], {
    name: "Other",
    rating: 10,
    goals: 1,
  }),
  appearance("a_unused", "p_unused", games[8], {
    name: "Unused",
    minutes: 0,
    rating: 10,
    goals: 99,
  }),
];
const orderedApps = apps
  .filter((a) => a.minutes >= 1)
  .sort(
    (a, b) =>
      a.leagueId.localeCompare(b.leagueId) ||
      a.date.localeCompare(b.date) ||
      a.matchId.localeCompare(b.matchId) ||
      a.id.localeCompare(b.id),
  );
const fixtures = [...games, ...future].map(makeFixture);

test("SQL home editorial policy matches the established frontend policy", () => {
  assert.deepEqual(HOME_TOP_FIVE, TOP_FIVE_IDS);
  assert.deepEqual(HOME_TOP_SEVEN, TOP_SEVEN_IDS);
  assert.deepEqual(HOME_UEFA, UEFA_IDS);
  assert.deepEqual(new Set(HOME_SIMPLE_LEAGUES), SIMPLE_LEAGUES);
  assert.deepEqual(new Set(HOME_FEATURED_CLUBS), FEATURED_CLUB_IDS);
});

test("home read parameters have bounded favorites and server-owned time", async () => {
  let calls = 0;
  const route = createHomeReadRoute(async () => {
    calls++;
    return [];
  });
  for (const query of [
    "now=2026-01-01",
    "archive=2",
    "personalTeams=t_bad",
    "personalPlayers=p_valid1,p_unknown",
    "leagues=invalid",
    `personalTeams=${Array(101).fill("t_41iFW3").join(",")}`,
  ]) {
    const request = new Request(
      `https://api.test/api/read/home?season=${season}&${query}`,
    );
    await assert.rejects(
      route(request, "/api/read/home", new URL(request.url).searchParams),
      (error) => error.status === 400,
    );
  }
  assert.equal(calls, 0);
});

test(
  "SQL home uses complete scopes for selections, exact coverage and Paris calendar periods",
  { skip: !process.env.VEGA_TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.VEGA_TEST_DATABASE_URL);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    const requireLocal = createRequire(
      new URL("../dashboard/package.json", import.meta.url),
    );
    const { Client } = requireLocal("pg"),
      client = new Client({ connectionString: url.href });
    await client.connect();
    let clock = currentTime;
    const insertGame = async (m, insertMatch = true) => {
      if (insertMatch)
        await client.query(
          "INSERT INTO statarena_app.matches(id,season,league_id,league,country,date,day,time_utc,status,home_id,home_name,home_image_url,home_score,home_xg,away_id,away_name,away_image_url,away_score,away_xg) VALUES($1,$2,$3,$4,$5,$6::text,$6::date,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
          [
            m.id,
            season,
            m.leagueId,
            m.league,
            m.country,
            m.date,
            m.timeUtc,
            m.status,
            m.home.id,
            m.home.name,
            m.home.imageUrl,
            m.home.score,
            m.home.xg,
            m.away.id,
            m.away.name,
            m.away.imageUrl,
            m.away.score,
            m.away.xg,
          ],
        );
      await client.query(
        "INSERT INTO statarena_app.fixtures(id,season,league_id,league_name,day,time_utc,status,home_team_id,home_name,home_image_url,score_home,away_team_id,away_name,away_image_url,score_away) VALUES($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
        [
          m.id,
          season,
          m.leagueId,
          m.league,
          m.date,
          m.timeUtc,
          m.status,
          m.home.id,
          m.home.name,
          m.home.imageUrl,
          m.home.score,
          m.away.id,
          m.away.name,
          m.away.imageUrl,
          m.away.score,
        ],
      );
    };
    try {
      await client.query("BEGIN");
      await client.query(
        await readFile(
          new URL(
            "../dashboard/backend/migrations/003_relational_core.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await client.query(
        await readFile(
          new URL(
            "../dashboard/backend/migrations/006_catalog_models.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await client.query("UPDATE statarena_app.publications SET generation=42");
      for (const [id, name] of [
        [leagueId, "Ligue 1"],
        ["l_4QexZg", "Liga Portugal"],
        ["l_0bfbkO", "Champions League"],
      ]) {
        await client.query(
          "INSERT INTO statarena_app.partitions(season,league_id,source_digest,retrieved_at,start_date,end_date) VALUES($1,$2,'digest','2026-11-06T08:00:00Z','2026-10-01','2026-11-04')",
          [season, id],
        );
        await client.query(
          "INSERT INTO statarena_app.competitions(id,name,country,latest_season) VALUES($1,$2,'FRA',$3)",
          [id, name, season],
        );
      }
      for (const m of games) await insertGame(m);
      for (const m of future) await insertGame(m, false);
      for (const a of apps) {
        await client.query(
          "INSERT INTO statarena_app.players(id,player_id,name,image_url) VALUES($1,$2,$3,$4)",
          ["ref-" + a.id, a.playerId, a.name, a.imageUrl],
        );
        await client.query(
          "INSERT INTO statarena_app.appearances(id,player_ref,player_id,match_id,team_id,team,league_id,league,country,season,date,minutes,rating,goals,assists,xg,xa) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
          [
            a.id,
            "ref-" + a.id,
            a.playerId,
            a.matchId,
            a.teamId,
            a.team,
            a.leagueId,
            a.league,
            a.country,
            a.season,
            a.date,
            a.minutes,
            a.rating,
            a.goals,
            a.assists,
            a.xg,
            a.xa,
          ],
        );
      }
      await client.query(
        "INSERT INTO statarena_app.shots(id,match_id,team_id,minute,xg,is_goal,is_own_goal) VALUES('shot1','m_table4a','t_41iFW3',21,0.5,true,false)",
      );
      await client.query(
        "INSERT INTO statarena_app.team_statistics(match_id,metric_key,ordinal,home_value,away_value) VALUES('m_table4a','expected_goals',0,1.4,0.3)",
      );
      const route = createHomeReadRoute(
        async (sql, values) => (await client.query(sql, values)).rows,
        () => clock,
      );
      const get = async (extra = {}, headers) => {
        const params = new URLSearchParams({ season, ...extra }),
          request = new Request("https://api.test/api/read/home?" + params, {
            headers,
          });
        return route(request, "/api/read/home", params);
      };
      const response = await get(),
        body = await response.json(),
        data = body.data;
      const period = matchdayWindow(games, clock),
        results = weekResults(games, period),
        progress = leagueProgress(fixtures),
        ranks = teamRanks(progress);
      const performances = weekPerformances(
          orderedApps,
          period,
          60,
          new Map(games.map((m) => [m.id, m])),
        ),
        potw = playerOfTheWeek(performances);
      const totals = seasonTotals(orderedApps, season),
        leaders = seasonLeaders(totals),
        winning = biggestWin(results);
      assert.deepEqual(data.period, period);
      assert.equal(data.resultCount, results.length);
      assert.deepEqual(
        data.results.map((m) => m.id),
        results.map((m) => m.id),
      );
      assert.equal(data.featured.id, selectMatchOfTheWeek(results, ranks).id);
      assert.equal(data.featured.shots.length, 1);
      assert.equal(data.featured.stats[0].home, 1.4);
      assert.ok(
        data.results.every((m) => m.shots.length === 0 && m.stats.length === 0),
      );
      assert.equal(data.potw.id, potw.id);
      assert.equal(data.potwMatch.id, potw.matchId);
      assert.deepEqual(
        data.potwSeason,
        totals.find((p) => p.playerId === potw.playerId),
      );
      assert.deepEqual(
        data.potwRecent.map((r) => r.id),
        recentRatings(orderedApps, potw.playerId, season).map((r) => r.id),
      );
      assert.deepEqual(
        data.others.map((r) => r.id),
        performances
          .filter((p) => p.playerId !== potw.playerId)
          .slice(0, 9)
          .map((r) => r.id),
      );
      assert.deepEqual(data.leaders, leaders);
      assert.equal(
        data.leaders.goals.find((p) => p.playerId === "p_alpha1").xg,
        null,
      );
      assert.equal(data.streak.id, bestWinStreak(progress).id);
      assert.deepEqual(data.streak, bestWinStreak(progress));
      assert.deepEqual(data.defences, bestDefences(progress));
      assert.equal(data.win.match.id, winning.match.id);
      assert.equal(data.win.margin, winning.margin);
      assert.equal(data.seasonProgress, seasonProgress(progress));
      assert.deepEqual(data.tables[0], {
        ...progress.get(leagueId),
        teamCount: 4,
      });
      const upcoming = upcomingHighlights(fixtures, clock, null, ranks);
      assert.deepEqual(
        data.highlights.map((item) => item.fixture.id),
        upcoming.slice(0, 5).map((item) => item.fixture.id),
      );
      const personal = personalClubIds(
        [{ entries: [{ kind: "players", id: "p_alpha1" }] }],
        orderedApps,
        season,
      );
      const personalBody = await (
        await get({ personalPlayers: "p_alpha1" })
      ).json();
      assert.deepEqual(
        personalBody.data.highlights.map((item) => item.fixture.id),
        upcomingHighlights(fixtures, clock, null, ranks, 7, personal)
          .slice(0, 5)
          .map((item) => item.fixture.id),
      );
      assert.equal(personalBody.data.highlights[0].fixture.id, "m_next02");
      assert.equal(body.meta.generation, "42");
      assert.ok(response.headers.get("cache-control").includes("s-maxage=30"));
      assert.equal(
        (await get({}, { "If-None-Match": response.headers.get("etag") }))
          .status,
        304,
      );
      clock += 60_000;
      assert.equal(
        (await get({}, { "If-None-Match": response.headers.get("etag") }))
          .status,
        200,
      );
      clock = currentTime;
      const empty = (await (await get({ leagues: "none" })).json()).data;
      assert.equal(empty.potw, null);
      assert.equal(empty.featured, null);
      assert.equal(empty.resultCount, 0);
      assert.equal(empty.hasSeasonPlayers, false);
      clock = Date.parse("2027-11-06T12:00:00Z");
      const stale = (await (await get()).json()).data;
      assert.equal(stale.potw, null);
      assert.equal(stale.featured, null);
      assert.equal(stale.resultCount, 0);
      const archive = (await (await get({ archive: "1" })).json()).data;
      assert.equal(archive.period.current, false);
      assert.equal(archive.period.start, period.start);
      assert.equal(archive.potw.id, potw.id);
      clock = currentTime;
      for (let i = 0; i < 9; i++)
        await insertGame(game(`m_dense${i}`, "2026-11-05", 0, 1));
      await insertGame(game("m_hidden", "2026-11-05", 2, 3, [12, 0]));
      const bounded = (await (await get()).json()).data;
      assert.equal(
        bounded.results.filter((m) => m.date === "2026-11-05").length,
        8,
      );
      assert.ok(!bounded.results.some((m) => m.id === "m_hidden"));
      assert.equal(
        bounded.win.match.id,
        "m_hidden",
        "winner uses all weekly results before ticker LIMIT",
      );
      assert.equal(bounded.resultCount, results.length + 10);
      assert.ok(bounded.results.length <= 32);
      const midnight = game("m_midnit", "2026-10-25", 0, 1, [2, 0], {
        timeUtc: "2026-10-25T23:30:00Z",
      });
      await insertGame(midnight);
      clock = Date.parse("2026-10-26T00:00:00Z");
      const dst = (await (await get()).json()).data;
      assert.equal(dst.period.start, "2026-10-26");
      assert.ok(
        dst.results.some((m) => m.id === "m_midnit"),
        "explicit kickoff uses Paris day after DST",
      );
      await insertGame(
        game("m_cat001", "2026-11-04", 0, 1, [2, 0], {
          leagueId: "l_0bfbkO",
          league: "Champions League",
        }),
      );
      const addRound = async (edition) => {
        const {
          rows: [catalog],
        } = await client.query(
          "INSERT INTO statarena_app.catalog_editions(catalog,scope,edition,model,source_digest,response_status) VALUES('matchdays','l_0bfbkO',$1,'matchdays',repeat('a',64),200) RETURNING resource_id",
          [edition],
        );
        await client.query(
          "INSERT INTO statarena_app.cat_matchdays(resource_id,record_no,missing,null_groups) VALUES($1,0,'{}','{}')",
          [catalog.resource_id],
        );
        await client.query(
          "INSERT INTO statarena_app.cat_matchdays_matches(resource_id,record_no,parent_no,position,metric_label,name,missing,null_groups) VALUES($1,1,0,0,'m_cat001','Semi-finals','{}','{}')",
          [catalog.resource_id],
        );
        return catalog.resource_id;
      };
      await addRound("2025/2026");
      assert.equal(
        (await (await get()).json()).data.raceOpen,
        false,
        "another season's rounds cannot open this season",
      );
      const catalogId = await addRound(season);
      await client.query(
        "UPDATE statarena_app.publications SET published_at=clock_timestamp()",
      );
      assert.equal(
        (await (await get()).json()).data.raceOpen,
        true,
        "a completed semi-final known only in the matchday catalog opens the race",
      );
      await client.query(
        "UPDATE statarena_app.cat_matchdays_matches SET missing=ARRAY['name'] WHERE resource_id=$1",
        [catalogId],
      );
      await client.query(
        "UPDATE statarena_app.publications SET published_at=clock_timestamp()",
      );
      assert.equal(
        (await (await get()).json()).data.raceOpen,
        false,
        "a field omitted from the catalog representation is not an observed round",
      );
      await client.query(
        "UPDATE statarena_app.fixtures SET round_name='Semi-finals' WHERE id='m_cat001'",
      );
      await client.query(
        "UPDATE statarena_app.publications SET published_at=clock_timestamp()",
      );
      assert.equal(
        (await (await get()).json()).data.raceOpen,
        true,
        "typed fixture round remains a fallback when catalog metadata is missing",
      );
      await client.query("UPDATE statarena_app.publications SET generation=43");
      await assert.rejects(
        get({ generation: "42" }),
        (error) => error.status === 409,
      );
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  },
);

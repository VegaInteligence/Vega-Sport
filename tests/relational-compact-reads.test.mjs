import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  createPlayerReadRoute,
  positionNumberSql,
} from "../dashboard/backend/services/relational-players.js";
import { createClubReadRoute } from "../dashboard/backend/services/relational-clubs.js";
import { createHomeReadRoute } from "../dashboard/backend/services/relational-home.js";
import { allClubSummaries } from "../dashboard/frontend/src/services/club-analysis.js";
import { aggregateSeasonPlayers } from "../dashboard/frontend/src/services/season-player.js";
import {
  EMPTY_ADVANCED,
  parseAdvanced,
} from "../dashboard/frontend/src/services/advanced-filters.js";
import {
  playerDirectoryScope,
  playerAverage,
  filterPlayerAverages,
  searchPlayerAverages,
  sortPlayerAverages,
} from "../dashboard/frontend/src/services/player-directory.js";
import { rankSeasonPlayers } from "../dashboard/frontend/src/services/player-leaderboard.js";

const season = "2026/2027",
  leagueId = "l_3FJFUl";
const app = (id, playerId, matchId, values = {}) => ({
  id,
  playerId,
  matchId,
  name: playerId === "p_3yEwhj" ? "Cristiano Ronaldo" : playerId,
  teamId: "t_paris1",
  team: "Paris",
  leagueId,
  league: "Ligue 1",
  country: "FRA",
  season,
  imageUrl: null,
  date: `2026-11-${matchId.slice(-2)}`,
  positionId: 91,
  minutes: 90,
  rating: 7,
  starter: true,
  goals: 0,
  assists: 0,
  ...values,
});

test("compact conditional validators avoid aggregations and preserve generation checks", async () => {
  for (const [name, factory] of [
    ["players", createPlayerReadRoute],
    ["clubs", createClubReadRoute],
    ["home", createHomeReadRoute],
  ]) {
    const calls = [];
    let generation = "42",
      advanceOnPayload = false;
    const route = factory(
      async (sql) => {
        calls.push(sql);
        if (advanceOnPayload && sql.includes("/*vega:compact:"))
          generation = "43";
        return [
          { generation, partition_count: 1, players: [], clubs: [], total: 0 },
        ];
      },
      () => Date.parse("2026-11-06T12:00:00Z"),
    );
    const params = new URLSearchParams({ season });
    const request = async (
      headers = {},
      method = "GET",
      parameters = params,
    ) => {
      const req = new Request(
        `https://api.test/api/read/${name}?${parameters}`,
        { method, headers },
      );
      return route(req, `/api/read/${name}`, parameters);
    };
    const first = await request(),
      etag = first.headers.get("etag");
    assert.equal(first.status, 200);
    calls.length = 0;
    assert.equal((await request({ "If-None-Match": etag })).status, 304);
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].includes("statarena_app.appearances"));
    assert.ok(!calls[0].includes("statarena_app.matches"));
    calls.length = 0;
    const head = await request({}, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].includes("/*vega:compact:"));
    calls.length = 0;
    advanceOnPayload = true;
    const missed = await request({ "If-None-Match": 'W/"old-representation"' });
    assert.equal(calls.length, 2);
    assert.equal(
      (await missed.json()).meta.generation,
      "43",
      "payload owns its publication snapshot after conditional miss",
    );
    const stale = new URLSearchParams({ season, generation: "42" });
    calls.length = 0;
    await assert.rejects(
      request({ "If-None-Match": "*" }, "HEAD", stale),
      (error) => error.status === 409,
    );
    assert.equal(calls.length, 1);
  }
});

test(
  "SQL club directories and analysis retain all results and observed-stat denominators",
  { skip: !process.env.VEGA_TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.VEGA_TEST_DATABASE_URL);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    const requireLocal = createRequire(
      new URL("../dashboard/package.json", import.meta.url),
    );
    const { Client } = requireLocal("pg");
    const client = new Client({ connectionString: url.href });
    await client.connect();
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
      await client.query("UPDATE statarena_app.publications SET generation=42");
      await client.query(
        "INSERT INTO statarena_app.partitions(season,league_id,source_digest) VALUES($1,$2,'digest')",
        [season, leagueId],
      );
      await client.query(
        "INSERT INTO statarena_app.competitions(id,name,country,latest_season) VALUES($1,'Ligue 1','FRA',$2)",
        [leagueId, season],
      );
      const games = structuredClone(matches);
      for (const match of games) {
        match.home.formation = "4-3-3";
        match.away.formation = "4-4-2";
        match.home.xg = 1.2;
        match.away.xg = 0.8;
        match.stats = [];
        match.shots = [];
        await client.query(
          "INSERT INTO statarena_app.matches(id,season,league_id,league,date,day,status,home_id,home_name,home_score,home_formation,home_xg,away_id,away_name,away_score,away_formation,away_xg) VALUES($1,$2,$3,'Ligue 1',$4::text,$4::date,'finished',$5,$6,$7,'4-3-3',1.2,$8,$9,$10,'4-4-2',0.8)",
          [
            match.id,
            season,
            leagueId,
            match.date,
            match.home.id,
            match.home.name,
            match.home.score,
            match.away.id,
            match.away.name,
            match.away.score,
          ],
        );
      }
      games[0].stats.push(
        { key: "expected_goals", home: 1.5, away: null },
        { key: "passes", home: 400, away: 300 },
      );
      await client.query(
        "INSERT INTO statarena_app.team_statistics(match_id,metric_key,ordinal,home_value,away_value) VALUES('m_game01','expected_goals',0,1.5,null),('m_game01','passes',1,400,300),('m_game02','passes',0,999,999)",
      );
      games[1].coverage = { teamStatsReliable: false };
      games[1].stats = [{ key: "passes", home: 999, away: 999 }];
      await client.query(
        "INSERT INTO statarena_app.match_coverage(match_id,coverage_key,flag) VALUES('m_game02','teamStatsReliable',false)",
      );
      games[0].shots = [
        {
          id: "shot1",
          teamId: "t_paris1",
          minute: 15,
          isGoal: true,
          isOwnGoal: false,
        },
        {
          id: "shot2",
          teamId: "t_other1",
          minute: 46,
          isGoal: true,
          isOwnGoal: false,
        },
        {
          id: "shot3",
          teamId: "t_other1",
          minute: 80,
          isGoal: true,
          isOwnGoal: true,
        },
      ];
      for (const [ordinal, shot] of games[0].shots.entries())
        await client.query(
          "INSERT INTO statarena_app.shots(id,match_id,ordinal,team_id,minute,is_goal,is_own_goal) VALUES($1,'m_game01',$2,$3,$4,$5,$6)",
          [
            shot.id,
            ordinal,
            shot.teamId,
            shot.minute,
            shot.isGoal,
            shot.isOwnGoal,
          ],
        );
      const route = createClubReadRoute(
        async (sql, values) => (await client.query(sql, values)).rows,
      );
      const get = async (extra) => {
        const params = new URLSearchParams({ season, ...extra }),
          req = new Request("https://api.test/api/read/clubs?" + params);
        return (await route(req, "/api/read/clubs", params)).json();
      };
      const directory = await get({ limit: "1" });
      assert.equal(directory.pagination.total, 2);
      assert.equal(directory.data.clubs.length, 1);
      assert.equal(directory.data.clubs[0].name, "Lyon");
      assert.equal(directory.data.clubs[0].count, 3);
      assert.deepEqual(directory.data.facets, {
        countries: ["FRA"],
        competitionIds: [leagueId],
      });
      assert.equal((await get({ country: "BRA" })).pagination.total, 0);
      assert.equal((await get({ q: "paris" })).data.clubs[0].id, "t_paris1");
      assert.equal((await get({ leagues: "none" })).pagination.total, 0);
      const analysis = await get({ analysis: "1" }),
        oracle = allClubSummaries({ matches: games, fixtures: [], teams: [] });
      assert.equal(analysis.pagination.total, 2);
      for (const club of analysis.data.clubs) {
        const expected = oracle.find((value) => value.id === club.id);
        for (const key of [
          "matches",
          "wins",
          "draws",
          "losses",
          "points",
          "goalsFor",
          "goalsAgainst",
          "cleanSheets",
          "home",
          "away",
          "stats",
          "formations",
          "excludedStats",
          "unscored",
          "goalTimes",
        ])
          assert.deepEqual(club[key], expected[key], `${club.id}.${key}`);
        assert.deepEqual(
          club.forms.map(({ result, scoreFor, scoreAgainst, side }) => ({
            result,
            scoreFor,
            scoreAgainst,
            side,
          })),
          expected.forms.map(({ result, scoreFor, scoreAgainst, side }) => ({
            result,
            scoreFor,
            scoreAgainst,
            side,
          })),
        );
        assert.deepEqual(club.games, []);
        assert.deepEqual(club.shots, []);
      }
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  },
);
const source = [
  app("a01", "p_alpha1", "m_game01", {
    name: "Alpha",
    minutes: 10,
    rating: 10,
    goals: 3,
    xg: 1,
    xa: null,
    positionId: 31,
    passesAccurate: 5,
    passesAttempted: 10,
    duelsWon: 1,
    duelsLost: 1,
  }),
  app("a02", "p_alpha1", "m_game02", {
    name: "Alpha",
    minutes: 90,
    rating: 6,
    goals: 0,
    xg: null,
    xa: 0,
    positionId: 91,
    passesAccurate: 18,
    passesAttempted: 20,
    duelsWon: 3,
    duelsLost: 1,
  }),
  app("a03", "p_bravo1", "m_game01", {
    name: "Bravo",
    teamId: "t_other1",
    team: "Lyon",
    minutes: 80,
    rating: 8,
    goals: 2,
    xg: 0,
    positionId: 81,
    passesAccurate: 0,
    passesAttempted: 0,
  }),
  app("a04", "p_bravo1", "m_game02", {
    name: "Bravo",
    teamId: "t_other1",
    team: "Lyon",
    minutes: 20,
    rating: null,
    goals: 3,
    xg: 3,
    starter: false,
    positionId: 2,
  }),
  app("a05", "p_3yEwhj", "m_game01", {
    minutes: 90,
    rating: 9,
    goals: 4,
    xg: 2,
    xa: 0.4,
    positionId: 91,
  }),
  app("a06", "p_zero01", "m_game01", {
    name: "Unused",
    minutes: 0,
    rating: null,
    starter: false,
    positionId: null,
  }),
  app("a07", "p_unknown", "m_game01", {
    name: "Unknown",
    minutes: null,
    rating: null,
    positionId: null,
  }),
  app("a08", "p_alpha1", "m_game03", {
    name: "Alpha",
    minutes: null,
    rating: null,
    xg: null,
  }),
  app("a09", "p_alpha1", "m_game03", {
    name: "Alpha",
    minutes: 30,
    rating: 8,
    xg: 1,
    goals: 1,
    starter: false,
  }),
  app("a10", "p_alpha1", "m_game03", {
    name: "Alpha",
    minutes: 30,
    rating: 1,
    xg: 999,
    goals: 999,
  }),
];
const matches = [1, 2, 3].map((n) => ({
  id: `m_game0${n}`,
  date: `2026-11-0${n}`,
  season,
  leagueId,
  home: { id: "t_paris1", name: "Paris", score: n === 2 ? 0 : 2 },
  away: { id: "t_other1", name: "Lyon", score: n === 2 ? 1 : 0 },
  status: "finished",
}));
function expected(params) {
  const filters = {
    league: params.get("league") || "all",
    leagues: params.get("leagues")?.split(",") || [],
    query: params.get("q") || "",
    minutes: Number(params.get("minutes") ?? 1),
    match: params.get("match") || "all",
    advanced: { ...EMPTY_ADVANCED, ...parseAdvanced(params) },
  };
  const sample = playerDirectoryScope(
    source,
    season,
    filters,
    new Map(matches.map((match) => [match.id, match])),
  );
  const values = aggregateSeasonPlayers(sample).map((profile) => {
    const row = playerAverage(profile, params.get("basis") || "perMatch");
    return {
      ...row,
      finishingDelta:
        Number.isFinite(row.goals) && Number.isFinite(row.xg)
          ? row.goals - row.xg
          : null,
      totals: Object.fromEntries(
        ["goals", "assists", "xg"].map((key) => [
          key,
          profile.stats[key]?.count ? profile.stats[key].sum : null,
        ]),
      ),
    };
  });
  const filtered = searchPlayerAverages(
    filterPlayerAverages(values, filters),
    filters.query,
  );
  return params.get("ranking")
    ? rankSeasonPlayers(filtered, params.get("ranking"))
    : sortPlayerAverages(filtered, {
        key: params.get("sort") || "rating",
        direction: params.get("direction") || "desc",
      });
}

test("compact player parameters reject unsafe or unbounded reads before SQL", async () => {
  let calls = 0;
  const route = createPlayerReadRoute(async () => {
    calls++;
    return [];
  });
  for (const extra of [
    "limit=101",
    "page=-1",
    "sort=rating;drop",
    "pos=Z",
    "stats=unknown:1",
    "from=2026-99-99",
    "leagues=unknown",
    "rmin=NaN",
  ]) {
    const req = new Request(
      `https://api.test/api/read/players?season=2026/2027&${extra}`,
    );
    await assert.rejects(
      route(req, "/api/read/players", new URL(req.url).searchParams),
      (error) => error.status === 400,
    );
  }
  assert.equal(calls, 0);
});

test(
  "SQL player aggregation preserves frontend means, coverage, filters and complete ranking before pagination",
  { skip: !process.env.VEGA_TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.VEGA_TEST_DATABASE_URL);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    const requireLocal = createRequire(
      new URL("../dashboard/package.json", import.meta.url),
    );
    const { Client } = requireLocal("pg");
    const client = new Client({ connectionString: url.href });
    await client.connect();
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
      await client.query("UPDATE statarena_app.publications SET generation=42");
      await client.query(
        "INSERT INTO statarena_app.partitions(season,league_id,source_digest,retrieved_at,start_date,end_date) VALUES($1,$2,'digest','2026-11-06T08:00:00Z','2026-08-01','2026-11-05')",
        [season, leagueId],
      );
      await client.query(
        "INSERT INTO statarena_app.competitions(id,name,country,latest_season) VALUES($1,'Ligue 1','FRA',$2)",
        [leagueId, season],
      );
      for (const match of matches)
        await client.query(
          "INSERT INTO statarena_app.matches(id,season,league_id,date,day,status,home_id,home_name,home_score,away_id,away_name,away_score) VALUES($1,$2,$3,$4::text,$4::date,'finished',$5,$6,$7,$8,$9,$10)",
          [
            match.id,
            season,
            leagueId,
            match.date,
            match.home.id,
            match.home.name,
            match.home.score,
            match.away.id,
            match.away.name,
            match.away.score,
          ],
        );
      const fields = [
        "playerId",
        "teamId",
        "team",
        "matchId",
        "leagueId",
        "league",
        "country",
        "season",
        "date",
        "minutes",
        "rating",
        "starter",
        "goals",
        "assists",
        "xg",
        "xa",
        "passesAccurate",
        "passesAttempted",
        "duelsWon",
        "duelsLost",
      ];
      const snake = (value) =>
        value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      for (const [ordinal, row] of source.entries()) {
        const ref = "ref-" + row.id;
        await client.query(
          "INSERT INTO statarena_app.players(id,player_id,name,image_url) VALUES($1,$2,$3,$4)",
          [ref, row.playerId, row.name, row.imageUrl],
        );
        const values = [
          row.id,
          ref,
          ordinal,
          row.positionId,
          row.positionId === null ? "NoneType" : "int",
          ...fields.map((key) => row[key] ?? null),
        ];
        await client.query(
          `INSERT INTO statarena_app.appearances(id,player_ref,ordinal,position_id,position_id_type,${fields.map(snake).join(",")}) VALUES(${values.map((_, i) => "$" + (i + 1)).join(",")})`,
          values,
        );
      }
      const route = createPlayerReadRoute(
        async (sql, values) => (await client.query(sql, values)).rows,
      );
      const request = async (extra) => {
        const params = new URLSearchParams({ season, ...extra });
        const req = new Request("https://api.test/api/read/players?" + params);
        return {
          response: await route(req, "/api/read/players", params),
          params,
        };
      };
      for (const extra of [
        {},
        { basis: "total" },
        { basis: "per90" },
        { minutes: "0" },
        { minutes: "45", rmin: "8" },
        { basis: "total", stats: "goals:4" },
        { pos: "A" },
        { pos: "M" },
        { role: "sub" },
        { venue: "away" },
        { result: "win" },
        { from: "2026-11-02", to: "2026-11-03" },
        { match: "m_game02" },
        { q: "CR7" },
        { q: "Paris" },
        { basis: "total", ranking: "goals" },
        { basis: "total", ranking: "clinical" },
        { basis: "total", ranking: "wasteful" },
        { sort: "passAccuracy", direction: "asc" },
      ]) {
        const { response, params } = await request(extra);
        assert.equal(response.status, 200);
        const body = await response.json(),
          oracle = expected(params);
        assert.equal(
          body.pagination.total,
          oracle.length,
          JSON.stringify(extra),
        );
        assert.deepEqual(
          body.data.players.map((row) => row.playerId),
          oracle.map((row) => row.playerId),
          JSON.stringify(extra),
        );
        for (const [i, row] of body.data.players.entries()) {
          const original = oracle[i];
          for (const field of [
            "matches",
            "minutes",
            "rating",
            "goals",
            "assists",
            "xg",
            "xa",
            "passAccuracy",
            "duelRate",
            "position",
            "finishingDelta",
          ]) {
            if (typeof original[field] === "number")
              assert.ok(
                Math.abs(row[field] - original[field]) < 1e-9,
                `${JSON.stringify(extra)} ${row.playerId}.${field}: ${row[field]} vs ${original[field]}`,
              );
            else
              assert.equal(
                row[field],
                original[field],
                `${row.playerId}.${field}`,
              );
          }
          assert.deepEqual(row.profile.stats, { ...original.profile.stats });
          assert.deepEqual(row.profile.ratios, { ...original.profile.ratios });
          assert.equal(
            row.profile.unknownMinutes,
            original.profile.unknownMinutes,
          );
          assert.equal(row.profile.starts, original.profile.starts);
          assert.equal(row.profile.ratingCount, original.profile.ratingCount);
        }
      }
      const first = await (
        await request({ limit: "1", ranking: "goals", basis: "total" })
      ).response.json();
      const second = await (
        await request({
          limit: "1",
          page: "2",
          ranking: "goals",
          basis: "total",
          generation: first.meta.generation,
        })
      ).response.json();
      assert.equal(first.pagination.total, 3);
      assert.notEqual(
        first.data.players[0].playerId,
        second.data.players[0].playerId,
      );
      assert.equal(
        (await (await request({ leagues: "none" })).response.json()).pagination
          .total,
        0,
      );
      const malformedPositions = await client.query(
        `SELECT ${positionNumberSql("p")} value FROM (VALUES('1e999','float'),('91','int'),('NaN','float')) p(position_id,position_id_type)`,
      );
      assert.deepEqual(
        malformedPositions.rows.map((row) => row.value),
        [null, 91, null],
      );
      assert.equal(first.meta.missingWatermarks, 0);
      await client.query(
        "INSERT INTO statarena_app.partitions(season,league_id,source_digest,retrieved_at) VALUES($1,'l_4QexZg','missing',null)",
        [season],
      );
      const partialFreshness = await (await request({})).response.json();
      assert.equal(partialFreshness.meta.sourceRetrievedAt, null);
      assert.equal(
        partialFreshness.meta.latestSourceRetrievedAt,
        "2026-11-06T08:00:00Z",
      );
      assert.equal(partialFreshness.meta.missingWatermarks, 1);
      await client.query("UPDATE statarena_app.publications SET generation=43");
      await assert.rejects(
        request({ page: "2", generation: "42" }),
        (error) => error.status === 409,
      );
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  },
);

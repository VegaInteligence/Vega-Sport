import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createActorRoute } from "../dashboard/backend/services/relational-actors.js";
import { createPerformanceRoute } from "../dashboard/backend/services/relational-performance.js";
import { clubSummary } from "../dashboard/frontend/src/services/club-analysis.js";
import { appearanceRecord } from "../dashboard/backend/services/relational-core.js";
import {
  performanceProfile,
  matchRatingRank,
} from "../dashboard/frontend/src/services/player-profile.js";

const request = (route, path, params, options) => {
  const url = new URL(path, "https://api.test");
  url.search = new URLSearchParams(params);
  return route(new Request(url, options), url.pathname, url.searchParams);
};

test("actor routes reject invalid IDs, details, scopes and methods before SQL", async () => {
  let calls = 0;
  const route = createActorRoute(async () => {
    calls++;
    throw Error("must not query");
  });
  for (const params of [
    { player: "bad", season: "2026/2027" },
    { player: "p_000001", season: "bad" },
    { player: "p_000001", season: "2026/2027", include: "archive" },
    { player: "p_000001", season: "2026/2027", detail: "archive" },
    { player: "p_000001", season: "2026/2027", leagues: "x' OR TRUE" },
    { player: "p_000001", season: "2026/2027", limit: "101" },
  ])
    await assert.rejects(
      request(route, "/api/read/player", params),
      (error) => error.status === 400,
    );
  await assert.rejects(
    request(
      route,
      "/api/read/player",
      { player: "p_000001", season: "2026/2027" },
      { method: "POST" },
    ),
    (error) => error.status === 405,
  );
  assert.equal(
    await route(
      new Request("https://api.test/"),
      "/unrelated",
      new URLSearchParams(),
    ),
    null,
  );
  assert.equal(calls, 0);
});

test("actor summary omits detail fan-out and retains club overview statistics", async () => {
  const calls = [];
  const route = createActorRoute(async (sql) => {
    calls.push(sql);
    return [{ generation: "42", total: 0 }];
  });
  const player = await (
    await request(route, "/api/read/player", {
      season: "2026/2027",
      player: "p_000001",
      detail: "summary",
      limit: "100",
    })
  ).json();
  assert.equal(player.data.meta.detail, "summary");
  assert.equal(player.pagination.limit, 100);
  assert.match(calls[0], /statarena_app.appearances/);
  assert.doesNotMatch(
    calls[0],
    /appearance_metrics|team_statistics|match_coverage|match_warnings|statarena_app.shots/,
  );
  const club = await (
    await request(route, "/api/read/club", {
      season: "2026/2027",
      team: "t_000001",
      detail: "summary",
      limit: "100",
    })
  ).json();
  assert.equal(club.data.meta.detail, "summary");
  assert.match(calls[1], /statarena_app.team_statistics/);
  assert.match(calls[1], /coverage_key='teamStatsReliable'/);
  assert.doesNotMatch(
    calls[1],
    /page_appearances|appearance_metrics|match_warnings|statarena_app.shots/,
  );
});

test("unknown outfield positions enter their peer cohort once", () => {
  const cohort = Array.from({ length: 29 }, (_, i) => ({
    minutes: 90,
    positionId: i === 0 ? null : 31,
    shots: i,
    xg: i / 10,
  }));
  const profile = performanceProfile(cohort[0], cohort);
  assert.equal(profile.peers, 29);
  assert.ok(
    profile.sections
      .flatMap((section) => section.metrics)
      .every((metric) => metric.percentile === null),
  );
});

const databaseUrl =
  process.env.VEGA_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
test(
  "PostgreSQL actor pages and exact performance percentiles preserve scope, laziness and generation",
  { skip: !databaseUrl },
  async () => {
    const target = new URL(databaseUrl);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
    assert.match(target.pathname, /^\/(?:vega_refactor_test|.*_e2e)$/);
    const require = createRequire(
      new URL("../dashboard/package.json", import.meta.url),
    );
    const { Client } = require("pg"),
      db = new Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      await db.query("BEGIN");
      assert.equal(
        (await db.query("SELECT to_regnamespace('statarena_app') AS name"))
          .rows[0].name,
        null,
      );
      for (const name of [
        "003_relational_core.sql",
        "011_appearance_shirt_numbers.sql",
        "020_publication_foreign_key_indexes.sql",
      ])
        await db.query(
          readFileSync(
            new URL(`../dashboard/backend/migrations/${name}`, import.meta.url),
            "utf8",
          ),
        );
      await db.query(`UPDATE statarena_app.publications SET generation=42;
      INSERT INTO statarena_app.competitions(id,name,latest_season) VALUES ('l_000001','Ligue 1','2026/2027'),('l_000002','Coupe','2026/2027');
      INSERT INTO statarena_app.partitions(season,league_id,source_digest,retrieved_at,start_date,end_date) VALUES
        ('2026/2027','l_000001','digest-one','2026-11-06T12:00:00Z','2026-08-01','2026-11-05'),
        ('2026/2027','l_000002','digest-two','2026-11-06T11:00:00Z','2026-09-01','2026-11-04');
      INSERT INTO statarena_app.teams(id,name,latest_season) VALUES ('t_000001','Paris','2026/2027'),('t_000002','Lyon','2026/2027'),('t_000003','Autre','2026/2027');
      INSERT INTO statarena_app.team_seasons(team_id,season,league_id,name,sample_matches) VALUES
        ('t_000001','2026/2027','l_000001','Paris',2),('t_000002','2026/2027','l_000001','Lyon',2);
      INSERT INTO statarena_app.matches(id,season,league_id,day,date,status,home_id,away_id,home_name,away_name,home_score,away_score) VALUES
        ('m_000001','2026/2027','l_000001','2026-11-01','2026-11-01','finished','t_000001','t_000002','Paris','Lyon',2,1),
        ('m_000002','2026/2027','l_000001','2026-11-02','2026-11-02','finished','t_000002','t_000001','Lyon','Paris',0,0),
        ('m_000003','2026/2027','l_000002','2026-11-03','2026-11-03','finished','t_000003','t_000002','Autre','Lyon',1,3);
      INSERT INTO statarena_app.fixtures(id,season,league_id,day,status,home_team_id,away_team_id,home_name,away_name) VALUES
        ('m_000001','2026/2027','l_000001','2026-11-01','finished','t_000001','t_000002','Paris','Lyon'),
        ('m_000002','2026/2027','l_000001','2026-11-02','finished','t_000002','t_000001','Lyon','Paris'),
        ('m_000004','2026/2027','l_000001','2026-11-20','scheduled','t_000001','t_000002','Paris','Lyon');
      INSERT INTO statarena_app.players(id,player_id,name) VALUES
        ('p_000001','p_000001','Joueur choisi'),('p_000002','p_000002','Adversaire'),('p_000003','p_000003','Position inconnue');
      INSERT INTO statarena_app.team_statistics(match_id,metric_key,ordinal,label,home_value,away_value) VALUES ('m_000001','possession',0,'Possession',60,40),('m_000001','expected_goals',1,'xG',99.9,20.5),('m_000002','expected_goals',0,'xG',0.4,1.4);
      INSERT INTO statarena_app.match_coverage(match_id,coverage_key,flag) VALUES ('m_000001','shots',true),('m_000001','teamStatsReliable',false),('m_000002','teamStatsReliable',true);
      INSERT INTO statarena_app.shots(id,match_id,ordinal,player_id,team_id,xg) VALUES ('shot-one','m_000001',0,'p_000001','t_000001',0.2);`);
      const inputs = [];
      for (let i = 0; i < 36; i++) {
        const actor = i < 2 ? "p_000001" : i === 2 ? "p_000003" : "p_000002";
        const match = i === 1 ? "m_000002" : i === 35 ? "m_000003" : "m_000001";
        const source = {
          id: `appearance-${i}`,
          player_ref: actor,
          player_id: actor,
          team_id: actor === "p_000002" ? "t_000002" : "t_000001",
          match_id: match,
          season: "2026/2027",
          league_id: i === 35 ? "l_000002" : "l_000001",
          ordinal: i,
          position_id: i === 2 ? null : i === 34 ? "0" : "31",
          position_id_type: i === 2 ? "NoneType" : "int",
          minutes: i === 33 ? 10 : 90,
          rating: 6 + (i % 4) / 2,
          shots: i % 3,
          xg: i % 3 ? (i % 4) / 10 : null,
          shots_on_target: i % 3 ? 1 : null,
          passes_accurate: 30 + i,
          passes_attempted: i === 4 ? 5 : 50,
          duels_won: i % 6,
          duels_lost: i % 3,
          tackles: i % 4,
          interceptions: i % 3,
          saves: i === 34 ? 3 : null,
        };
        const keys = Object.keys(source);
        await db.query(
          `INSERT INTO statarena_app.appearances(${keys.join(",")}) VALUES(${keys.map((_, n) => `$${n + 1}`).join(",")})`,
          Object.values(source),
        );
        inputs.push(source);
      }
      await db.query(
        "INSERT INTO statarena_app.appearance_shirt_numbers(appearance_id,value_text,value_type) VALUES ('appearance-0','07','str')",
      );
      const calls = [],
        read = async (sql, values) => {
          calls.push(sql);
          return (await db.query(sql, values)).rows;
        };
      const actorRoute = createActorRoute(read),
        performanceRoute = createPerformanceRoute(read);
      const scope = {
        season: "2026/2027",
        leagues: "l_000001",
        generation: "42",
      };
      const player = { ...scope, player: "p_000001", page: "1", limit: "1" };
      const first = await (
        await request(actorRoute, "/api/read/player", player)
      ).json();
      assert.equal(first.pagination.total, 2);
      assert.equal(first.pagination.pages, 2);
      assert.equal(first.data.matches[0].id, "m_000002");
      assert.equal(first.data.appearances.length, 1);
      assert.equal(first.data.appearances[0].playerId, "p_000001");
      assert.ok(!calls.at(-1).includes("statarena_app.shots"));
      const second = await (
        await request(actorRoute, "/api/read/player", {
          ...player,
          page: "2",
          include: "shots",
        })
      ).json();
      assert.equal(second.data.matches[0].shots.length, 1);
      assert.equal(second.data.matches[0].stats[0].home, 60);
      assert.equal(second.data.appearances[0].shirtNumber, "07");
      assert.equal(second.data.matches[0].coverage.shots, true);
      const lightPlayer = await (
        await request(actorRoute, "/api/read/player", {
          ...scope,
          player: "p_000001",
          detail: "summary",
          limit: "100",
        })
      ).json();
      assert.equal(lightPlayer.pagination.total, 2);
      assert.equal(lightPlayer.data.appearances.length, 2);
      assert.equal(lightPlayer.data.meta.detail, "summary");
      assert.ok(
        lightPlayer.data.appearances.every((row) => row.minutes === 90),
      );
      assert.ok(
        lightPlayer.data.matches.every((match) => match.stats.length === 0),
      );
      const club = await (
        await request(actorRoute, "/api/read/club", {
          ...scope,
          team: "t_000001",
        })
      ).json();
      assert.equal(club.pagination.total, 3);
      assert.equal(club.data.fixtures.length, 3);
      assert.equal(club.data.appearances.length, 0);
      assert.ok(!calls.at(-1).includes("page_appearances"));
      const lightClub = await (
        await request(actorRoute, "/api/read/club", {
          ...scope,
          team: "t_000001",
          detail: "summary",
          limit: "100",
        })
      ).json();
      assert.equal(lightClub.pagination.total, club.pagination.total);
      assert.deepEqual(
        lightClub.data.matches.map((match) => match.stats),
        club.data.matches.map((match) => match.stats),
      );
      assert.equal(lightClub.data.fixtures.length, 3);
      assert.equal(
        lightClub.data.matches.find((m) => m.id === "m_000001").coverage
          .teamStatsReliable,
        false,
      );
      const fullSummary = clubSummary(club.data, "t_000001");
      const lightSummary = clubSummary(lightClub.data, "t_000001");
      assert.equal(lightSummary.excludedStats, 1);
      assert.deepEqual(lightSummary.stats, fullSummary.stats);
      assert.equal(lightSummary.excludedStats, fullSummary.excludedStats);
      assert.equal(lightSummary.matches, fullSummary.matches);
      const squad = await (
        await request(actorRoute, "/api/read/club", {
          ...scope,
          team: "t_000001",
          include: "appearances",
        })
      ).json();
      assert.equal(squad.data.appearances.length, 3);
      assert.ok(
        squad.data.appearances.every((row) => row.teamId === "t_000001"),
      );
      const empty = await (
        await request(actorRoute, "/api/read/player", {
          ...player,
          leagues: "none",
        })
      ).json();
      assert.equal(empty.pagination.total, 0);
      assert.equal(empty.pagination.pages, 1);
      assert.equal(empty.data.matches.length, 0);

      const cohort = inputs
        .filter((row) => row.league_id === "l_000001")
        .map(appearanceRecord);
      for (const index of [0, 2, 34]) {
        const response = await request(
          performanceRoute,
          "/api/read/performance",
          { ...scope, appearance: `appearance-${index}` },
        );
        const body = await response.json();
        assert.deepEqual(
          body.data.profile,
          performanceProfile(body.data.row, cohort),
        );
        assert.deepEqual(
          body.data.rank,
          matchRatingRank(body.data.row, cohort),
        );
        assert.equal(body.data.match.id, "m_000001");
        assert.equal(body.data.match.shots.length, 0);
        assert.ok(!calls.at(-1).includes("statarena_app.shots"));
        const conditional = await request(
          performanceRoute,
          "/api/read/performance",
          { ...scope, appearance: `appearance-${index}` },
          { headers: { "if-none-match": response.headers.get("etag") } },
        );
        assert.equal(conditional.status, 304);
        assert.ok(
          !calls.at(-1).includes("cohort AS"),
          "Conditional validation must not aggregate peers",
        );
      }
      await assert.rejects(
        request(performanceRoute, "/api/read/performance", {
          ...scope,
          appearance: "appearance-35",
        }),
        (error) => error.status === 404,
      );
      await assert.rejects(
        request(
          performanceRoute,
          "/api/read/performance",
          { ...scope, appearance: "appearance-35" },
          { method: "HEAD", headers: { "if-none-match": "*" } },
        ),
        (error) => error.status === 404,
      );
      const actorHead = await request(actorRoute, "/api/read/player", player, {
        method: "HEAD",
      });
      assert.equal(actorHead.status, 200);
      assert.ok(
        !calls.at(-1).includes("statarena_app.appearances"),
        "Actor HEAD must not extract appearances",
      );
      await db.query("UPDATE statarena_app.publications SET generation=43");
      await assert.rejects(
        request(actorRoute, "/api/read/player", player, { method: "HEAD" }),
        (error) => error.status === 409,
      );
      await assert.rejects(
        request(performanceRoute, "/api/read/performance", {
          ...scope,
          appearance: "appearance-0",
        }),
        (error) => error.status === 409,
      );
    } finally {
      await db.query("ROLLBACK");
      await db.end();
    }
  },
);

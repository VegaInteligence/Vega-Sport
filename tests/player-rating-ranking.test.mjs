import test from "node:test";
import assert from "node:assert/strict";
import {
  playerDirectoryRanking,
  playerDirectoryView,
  playerRankingKey,
  rankSeasonPlayers,
} from "../dashboard/frontend/src/services/player-leaderboard.js";
import {
  playerReadParams,
  supportsCompactRead,
} from "../dashboard/frontend/src/services/compact-reads.js";
import {
  parsePlayerRead,
  playerReadQuery,
} from "../dashboard/backend/services/relational-players.js";
import { MIN_RATED_MATCHES } from "../dashboard/shared/player-profile.js";

const filters = {
  query: "",
  match: "all",
  league: "all",
  leagues: [],
  ranking: "",
  minutes: 1,
  basis: "perMatch",
};

test("ratings are the default performance list, with explicit ranking and search overrides", () => {
  assert.equal(playerDirectoryView(null), "table");
  assert.equal(playerDirectoryView("lists"), "lists");
  assert.equal(playerDirectoryRanking(filters, true), "rating");
  assert.equal(playerRankingKey("rating"), "rating");
  assert.equal(playerRankingKey("all"), "all");
  assert.equal(
    playerDirectoryRanking({ ...filters, ranking: "all" }, true),
    "",
  );
  assert.equal(
    playerDirectoryRanking({ ...filters, ranking: "goals" }, true),
    "goals",
  );
  assert.equal(
    playerDirectoryRanking({ ...filters, query: "Abdulaziz" }, true),
    "",
  );
  assert.equal(
    playerDirectoryRanking({ ...filters, league: "l_abcdef" }, true),
    "",
  );
  assert.equal(
    playerDirectoryRanking({ ...filters, match: "m_abcdef" }, true),
    "",
  );
  assert.equal(playerDirectoryRanking(filters, false), "");
});

test("the top ratings use rated appearances rather than total matches or a single peak", () => {
  const row = (name, rating, ratingCount, matches = ratingCount) => ({
    playerId: name,
    name,
    rating,
    matches,
    profile: { ratingCount },
    totals: { goals: 0 },
  });
  const players = [
    row("One match", 9.66, 1),
    row("Four ratings", 9.1, 4, 10),
    row("Five ratings", 8.4, 5),
    row("More rated matches", 8.4, 9),
    row("Highest qualified", 8.63, 15),
    row("No rating", null, 0, 20),
  ];
  assert.deepEqual(
    rankSeasonPlayers(players, "rating").map(({ name }) => name),
    ["Highest qualified", "More rated matches", "Five ratings"],
  );
});

test("compact rankings apply the same qualification before count and pagination", () => {
  const f = {
    filters,
    focus: "all",
    season: "2026/2027",
    manifest: {},
  };
  const read = playerReadParams(f, { ranking: "rating" });
  assert.equal(read.ranking, "rating");
  assert.equal(playerReadParams(f, { ranking: "all" }).ranking, "");
  assert.equal(
    playerReadParams(f, { ranking: "rating", cohort: true }).ranking,
    "",
  );
  const params = new URLSearchParams({
    season: read.season,
    leagues: read.leagues,
    ranking: read.ranking,
  });
  const parsed = parsePlayerRead(params);
  assert.equal(parsed.ranking, "rating");
  const { sql } = playerReadQuery(parsed, params);
  const filtered = sql.slice(
    sql.indexOf("filtered AS"),
    sql.indexOf("page AS"),
  );
  assert.ok(filtered.includes("d.rating_count>=" + MIN_RATED_MATCHES));
  assert.match(sql, /ORDER BY d\.rating DESC NULLS LAST,d\.rating_count DESC/);
});

test("the rating ranking waits for the compact backend capability", () => {
  const manifest = {
    storage: "aws-relational",
    capabilities: { compactReads: { players: true } },
  };
  assert.equal(
    supportsCompactRead(manifest, "players", { ranking: "goals" }),
    true,
  );
  assert.equal(
    supportsCompactRead(manifest, "players", { ranking: "rating" }),
    false,
  );
  manifest.capabilities.playerRatingRanking = true;
  assert.equal(
    supportsCompactRead(manifest, "players", { ranking: "rating" }),
    true,
  );
});

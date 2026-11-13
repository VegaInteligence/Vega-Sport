import assert from "node:assert/strict";
import test from "node:test";
import { ownRate, points, replace } from "../src/lineup.mjs";
import { SWAP_MIN_MINUTES, swapReason } from "../src/routes/rankings.mjs";
import { get, skip } from "./context.mjs";

// The forecast's coefficients as the API reads them; the values are those backend/tests/test_lineup.py
// checks on vega/lineup.py.
const MODEL = { home_base: 0.26, home_slope: 0.93, away_base: 0.32, away_slope: 0.91, rho: -0.03 };
const near = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} against ${expected}`);

test("the same calculation as the model's module", () => {
  near(ownRate(3.0, 260), 0.38028169014084506);
  near(ownRate(4.5, 1760), 0.1832579185520362);
  near(points(MODEL, 1650, 1520), 1.9154036860888715);
  near(points(MODEL, 1500, 1500), 1.3686359975976474);
  const better = replace(MODEL, 44.8, 1650, 1520, 0.31, 0.05);
  near(better.shift, 11.648);
  near(better.points, 0.046919724825661646);
  const worse = replace(MODEL, 44.8, 1400, 1520, -0.12, 0.2);
  near(worse.shift, -14.336);
  near(worse.points, -0.05230882216908672);
  assert.deepEqual(replace(MODEL, 44.8, 1500, 1500, 0.2, 0.2), { shift: 0, points: 0 });
});

test("no estimate for a goalkeeper, across roles, or on too few minutes", () => {
  const forward = { role: "centre_forward", minutes: 2000 };
  assert.equal(swapReason(forward, { role: "centre_forward", minutes: SWAP_MIN_MINUTES }), null);
  assert.equal(swapReason(forward, { role: "winger", minutes: 2000 }), "role");
  assert.equal(swapReason(forward, { role: "goalkeeper", minutes: 2000 }), "goalkeeper");
  assert.equal(swapReason({ role: "goalkeeper", minutes: 2000 }, { role: "goalkeeper", minutes: 2000 }), "goalkeeper");
  assert.equal(swapReason(forward, { role: "centre_forward", minutes: SWAP_MIN_MINUTES - 1 }), "minutes");
});

test("a player in another's place: the gap between their rates, in Elo points, then in points", { skip }, async () => {
  const { body } = await get("/api/forecasts/swap?season=2025/2026&out=p_aaaab2&in=p_aaaab1");
  // The club and the role are those of the player replaced; each rate is read on the season and the one before.
  assert.deepEqual([body.season, body.role, body.position, body.club.name], ["2025/2026", "centre_forward", "Avant-centre", "Racing Club"]);
  assert.deepEqual(body.out, { id: "p_aaaab2", name: "Marc Petit", rate: 0.05, minutes: 540 });
  assert.deepEqual(body.in, { id: "p_aaaab1", name: "Élie Durand", rate: 0.434, minutes: 2660, team: body.in.team });
  assert.equal(body.in.team.name, "Olympique Été");
  assert.deepEqual(body.model, { version: "lineup-v1", fittedAt: "2025-09-06T03:14:00.000Z", matches: 28524, eloPerUnit: 44.8, error: 3.2 });
  const gap = ownRate(15, 2660) - ownRate(0.55, 540);
  assert.equal(body.estimate.rateGap, Math.round(gap * 1000) / 1000);
  assert.equal(body.estimate.elo, Math.round(44.8 * gap * 10) / 10);
  // The points follow from the club's strength against the other clubs of its league (the published figures are rounded).
  const { league } = body.club;
  assert.equal(league.name, "Ligue 1");
  assert.ok(league.matches >= 1 && Number.isFinite(body.club.elo) && Number.isFinite(league.opponentsElo));
  const expected = replace(MODEL, 44.8, body.club.elo, league.opponentsElo, ownRate(15, 2660), ownRate(0.55, 540));
  near(body.estimate.pointsPerMatch, expected.points, 0.002);
  assert.ok(body.estimate.pointsPerMatch > 0);
  near(body.estimate.pointsPerSeason, body.estimate.pointsPerMatch * league.matches, 0.06 + 0.0005 * league.matches);
  // The other way round, the club loses what the better player brought.
  const back = (await get("/api/forecasts/swap?season=2025/2026&out=p_aaaab1&in=p_aaaab2")).body;
  assert.equal(back.estimate.rateGap, -body.estimate.rateGap);
  assert.ok(back.estimate.pointsPerMatch < 0);
});

test("a replacement without an estimate says why", { skip }, async () => {
  const roles = (await get("/api/forecasts/swap?season=2025/2026&out=p_aaaab1&in=p_aaaab4")).body;
  assert.deepEqual([roles.reason, roles.inRole, roles.inPosition, roles.estimate], ["role", "winger", "Ailier / milieu offensif", undefined]);
  assert.equal((await get("/api/forecasts/swap?season=2025/2026&out=p_aaaab1&in=p_aaaab3")).body.reason, "goalkeeper");
  // A player the ranking has not read this season, a season without a ranking, or the same player twice.
  assert.equal((await get("/api/forecasts/swap?season=2024/2025&out=p_aaaab1&in=p_aaaab2")).response.status, 404);
  assert.equal((await get("/api/forecasts/swap?season=2025/2026&out=p_aaaab1&in=p_aaaab1")).response.status, 400);
  assert.equal((await get("/api/forecasts/swap?season=2025/2026&out=p_aaaab1")).response.status, 400);
});

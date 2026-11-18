// The halves the season-by-half tests write after the shared seed (test/seed.py), season
// 2025/2026, team 1 (docs/calculs/09-audit-2026-11/FAILURE_MODES.md §4 and §4.1):
// - Moitiés Test (p_aaab30) in m1 (two complete halves, the second without a shot and so
//   without xG), m3 (a first half without tackles, a second whose shot has no xG), m5 (a first
//   half without touches, a complete second half of 40 minutes) and the canceled m_aaad01
//   (complete, not a match of the season);
// - Demi Inconnu (p_aaab31) has incomplete halves only;
// - Passe Seule (p_aaab32): one first half whose passes alone are published, second halves of
//   0 and of unknown minutes;
// - Non Fini (p_aaab33): xG published NaN, +∞ and −∞, and a blank xG whose shots are unknown;
// - Rien Mesuré (p_aaab34): two played halves without any statistic;
// - Hors Saison (p_aaab35): halves of a canceled match, of a match not started, of 0 minutes;
// - Zéro Observé (p_aaab36): a complete half whose every statistic is a published 0;
// - Précision Fine (p_aaab37): xG with more digits than 6 (§4.1 FM-HC.10–12). First halves: three
//   complete ones, 0.12345679, 1.2345678 and no shot. Second halves: 0.12345679 beside a shot without
//   xG and a NaN. Their stored single-precision values are 0.12345679104328155517578125 and
//   1.23456776142120361328125 exactly; the shortest decimals reading back as them are the inputs.
export const HALF_COLUMNS = ["minutes_played", "goals", "total_shots", "xg", "accurate_passes", "touches", "duels_won", "recoveries", "touches_opp_box", "dribbles_succeeded", "tackles"];
const UNKNOWN = Array(10).fill(null);
// (player, match, period, minutes, goals, shots, xg, passes, touches, duels won, recoveries, touches in the box, dribbles, tackles)
export const HALVES = [
  [130, 1, "first_half", 45, 1, 2, 0.6, 10, 30, 2, 3, 4, 1, 1],
  [130, 1, "second_half", 45, 0, 0, null, 12, 25, 1, 2, 0, 0, 2],
  [130, 3, "first_half", 45, 0, 1, 0.1, 8, 20, 1, 1, 1, 0, null],
  [130, 3, "second_half", 45, 1, 1, null, 9, 22, 2, 1, 2, 1, 0],
  [130, 5, "first_half", 45, 0, 0, null, 5, null, 0, 1, 0, 0, 0],
  [130, 5, "second_half", 40, 0, 1, 0.2, 7, 18, 0, 2, 1, 2, 1],
  [130, 9301, "first_half", 45, 2, 3, 1.5, 10, 30, 3, 3, 5, 2, 2],
  [131, 1, "first_half", 45, 0, 1, null, 4, 12, 0, 1, 0, 0, 1],
  [131, 3, "second_half", 45, 0, 0, null, 6, 15, 1, null, 0, 0, 0],
  [132, 1, "first_half", 45, null, null, null, 14, null, null, null, null, null, null],
  [132, 1, "second_half", 0, null, null, null, 0, null, null, null, null, null, null],
  [132, 3, "second_half", null, null, null, null, 3, null, null, null, null, null, null],
  [133, 1, "first_half", 45, 0, 0, NaN, 5, 10, 0, 1, 0, 0, 0],
  [133, 3, "first_half", 45, 0, 1, Infinity, 6, 11, 1, 1, 1, 0, 0],
  [133, 5, "first_half", 45, 1, 2, -Infinity, 7, 12, 1, 2, 2, 1, 1],
  [133, 1, "second_half", 45, 0, 1, 0.4, 8, 13, 1, 1, 1, 0, 0],
  [133, 3, "second_half", 45, 0, null, null, 9, 14, 0, 2, 0, 1, 1],
  [134, 1, "first_half", 45, ...UNKNOWN],
  [134, 3, "second_half", 30, ...UNKNOWN],
  [135, 9301, "first_half", 45, 1, 1, 0.3, 5, 10, 1, 1, 1, 0, 0],
  [135, 6, "first_half", 45, 0, 0, null, 5, 10, 1, 1, 0, 0, 0],
  [135, 5, "second_half", 0, 0, 0, null, 0, 0, 0, 0, 0, 0, 0],
  [136, 1, "first_half", 45, 0, 0, null, 0, 0, 0, 0, 0, 0, 0],
  [137, 1, "first_half", 45, 0, 1, 0.12345679, 5, 10, 0, 1, 1, 0, 0],
  [137, 3, "first_half", 45, 1, 2, 1.2345678, 6, 11, 1, 1, 1, 0, 1],
  [137, 5, "first_half", 45, 0, 0, null, 7, 12, 1, 2, 0, 1, 0],
  [137, 1, "second_half", 45, 0, 1, 0.12345679, 8, 13, 1, 1, 1, 0, 0],
  [137, 3, "second_half", 45, 0, 2, null, 9, 14, 0, 2, 1, 1, 1],
  [137, 5, "second_half", 45, 0, 0, NaN, 4, 9, 1, 0, 0, 0, 0],
];
export const HALF_PLAYERS = [
  [130, "p_aaab30", "Moitiés Test"], [131, "p_aaab31", "Demi Inconnu"], [132, "p_aaab32", "Passe Seule"], [133, "p_aaab33", "Non Fini"],
  [134, "p_aaab34", "Rien Mesuré"], [135, "p_aaab35", "Hors Saison"], [136, "p_aaab36", "Zéro Observé"],
  [137, "p_aaab37", "Précision Fine"],
];

/** Writes the canceled m_aaad01, the players and their halves with `owner` (a pg client of the seeded base). */
export async function writeHalves(owner) {
  const x = (sql, values) => owner.query(sql, values);
  await x(`INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,match_date,kickoff_at)
           VALUES (9301,1,2025,'pitchapi','canceled',1,4,'2025-09-12','2025-09-12T19:00:00Z')`);
  await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('match','pitchapi','m_aaad01',9301)");
  for (const [id, key, name] of HALF_PLAYERS) {
    await x("INSERT INTO core.players(id,name) VALUES ($1,$2)", [id, name]);
    await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','pitchapi',$1,$2)", [key, id]);
  }
  for (const [player, match, period, ...values] of HALVES)
    await x(
      `INSERT INTO core.player_match_half_stats(season_id,match_id,team_id,player_id,period,${HALF_COLUMNS.join(",")})
       VALUES (2025,$1,1,$2,$3,${HALF_COLUMNS.map((_, i) => `$${i + 4}`).join(",")})`,
      [match, player, period, ...values],
    );
}

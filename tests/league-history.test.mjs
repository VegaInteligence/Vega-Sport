// The archived seasons offered by the competition page (services/league-history.js): the five big leagues get
// 2020/2021 … 2010/2011 after their own seasons, no other competition does; matchday labels.
import test from "node:test";
import assert from "node:assert/strict";
import { HISTORY_SEASONS, isHistorySeason, matchdayLabel, shortClub, withHistorySeasons } from "../dashboard/frontend/src/services/league-history.js";

test("the five leagues offer their archived seasons after their own; others nothing more", () => {
  assert.equal(HISTORY_SEASONS[0], "2020/2021");
  assert.equal(HISTORY_SEASONS.at(-1), "2010/2011");
  assert.equal(HISTORY_SEASONS.length, 11);
  const l1 = { id: "l_3FJFUl", seasons: ["2026/2027", "2021/2022"] };
  assert.deepEqual(withHistorySeasons(l1).slice(0, 4), ["2026/2027", "2021/2022", "2020/2021", "2019/2020"]);
  assert.equal(withHistorySeasons(l1).length, 13);
  const other = { id: "l_other", seasons: ["2026/2027"] };
  assert.deepEqual(withHistorySeasons(other), ["2026/2027"]);
  assert.deepEqual(withHistorySeasons(null), []);
  assert.equal(isHistorySeason("l_3FJFUl", "2015/2016"), true);
  assert.equal(isHistorySeason("l_3FJFUl", "2021/2022"), false);
  assert.equal(isHistorySeason("l_other", "2015/2016"), false);
});

test("matchday and month labels; short club names", () => {
  assert.equal(matchdayLabel({ number: 1 }), "1ʳᵉ journée");
  assert.equal(matchdayLabel({ number: 38 }), "38ᵉ journée");
  assert.equal(matchdayLabel({ month: "2010-08" }), "Août 2010");
  assert.equal(shortClub("Gazélec FC Ajaccio"), "Ajaccio");
  assert.equal(shortClub("Stade de Reims"), "Reims");
  assert.equal(shortClub("Troyes"), "Troyes");
});

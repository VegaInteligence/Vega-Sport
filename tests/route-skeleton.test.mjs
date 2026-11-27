import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { routeSkeleton, routeSkeletonScript } from "../dashboard/frontend/src/services/route-skeleton.js";

// § 84: the home and a match open on a skeleton of their own shape, like a club, a nation and a competition.
test("each redesigned page has its own loading skeleton", () => {
  assert.equal(routeSkeleton("/", ""), "home");
  assert.equal(routeSkeleton("/competitions/", ""), "competition");
  assert.equal(routeSkeleton("/matchs/", "?id=m_0BcQYa"), "match");
  // The calendar (no id) has its own since § 88; an archived World Cup match (cdm) keeps the logo, as does a page
  // without a skeleton of its own.
  assert.equal(routeSkeleton("/matchs/", "?tab=results"), "calendar");
  assert.equal(routeSkeleton("/matchs/", ""), "calendar");
  assert.equal(routeSkeleton("/matchs/", "?cdm=WC-1930-01"), "");
  assert.equal(routeSkeleton("/compte/", ""), "");
});

// § 87: the rankings and the players' pages too; the players' directory and a player's page each in their shape.
test("the rankings and the players open on their skeletons", () => {
  assert.equal(routeSkeleton("/classement-joueurs/", ""), "ballon");
  assert.equal(routeSkeleton("/power-ranking/", "?tab=clubs"), "power");
  assert.equal(routeSkeleton("/joueurs/", ""), "players");
  assert.equal(routeSkeleton("/joueurs/", "?season=2026%2F2027"), "players");
  assert.equal(routeSkeleton("/joueurs/", "?id=p_217YMB"), "player");
});

test("the head script flags the same skeleton before the first paint", () => {
  const flag = (pathname, search) => {
    const attributes = new Map();
    const documentElement = {
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name),
    };
    vm.runInNewContext(routeSkeletonScript, { location: { pathname, search }, document: { documentElement }, URLSearchParams });
    return attributes.get("data-route-skeleton") || "";
  };
  assert.equal(flag("/", ""), "home");
  assert.equal(flag("/matchs/", "?id=m_0BcQYa"), "match");
  assert.equal(flag("/matchs/", ""), "calendar");
  assert.equal(flag("/matchs/", "?cdm=WC-1930-01"), "");
  assert.equal(flag("/competitions/", "?id=l_3FJFUl"), "competition");
  assert.equal(flag("/classement-joueurs/", ""), "ballon");
  assert.equal(flag("/power-ranking", ""), "power");
  assert.equal(flag("/joueurs/", "?season=2026%2F2027"), "players");
  assert.equal(flag("/joueurs/", "?season=2026%2F2027&id=p_217YMB"), "player");
});

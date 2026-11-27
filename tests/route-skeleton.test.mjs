import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { routeSkeleton, routeSkeletonScript } from "../dashboard/frontend/src/services/route-skeleton.js";

// § 84: the home and a match open on a skeleton of their own shape, like a club, a nation and a competition.
test("each redesigned page has its own loading skeleton", () => {
  assert.equal(routeSkeleton("/", ""), "home");
  assert.equal(routeSkeleton("/competitions/", ""), "competition");
  assert.equal(routeSkeleton("/matchs/", "?id=m_0BcQYa"), "match");
  // The calendar (no id) keeps the logo; so does a page without a skeleton of its own.
  assert.equal(routeSkeleton("/matchs/", "?tab=results"), "");
  assert.equal(routeSkeleton("/joueurs/", ""), "");
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
  assert.equal(flag("/matchs/", ""), "");
  assert.equal(flag("/competitions/", "?id=l_3FJFUl"), "competition");
});

// The club page's similar clubs come from one place (VI-22, handoff of the VI-23 calculation
// audit): the API route, which needs max(5, ⌈0.75 × the club's axes⌉) axes in common. The
// browser's own similarClubs scored a club with no axis in common 100 and fed the comparison's
// default club and the « Comparer avec » suggestions. Written before the change. Expected:
// - no consumer of the page calls the browser's similarClubs any more, and it is gone;
// - a neighbour of the API becomes a menu item with its country and league.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { neighbourBrief, neighbourRows } from "../dashboard/frontend/src/services/club-neighbours.js";

const src = (file) => fs.readFileSync(new URL(`../dashboard/frontend/src/${file}`, import.meta.url), "utf8");

test("the page's similar clubs all come from the API", () => {
  assert.doesNotMatch(src("components/ClubScoutProfile.jsx"), /similarClubs\(/);
  assert.doesNotMatch(src("services/club-scout.js"), /export function similarClubs/);
  assert.match(src("components/ClubScoutProfile.jsx"), /useClubNeighbours\(/);
});

test("a neighbour of the API as a menu item", () => {
  const [row] = neighbourRows({ similar: [{ id: "t_aaaaaa", name: "Como", image_url: "https://img/c.png", similarity: 79, closest: ["possession"], league: { id: "l_0ALvwF", name: "Serie A", country: "ITA" }, position: 5 }] });
  assert.deepEqual(neighbourBrief(row, (code) => ({ ITA: "Italie" })[code]), { id: "t_aaaaaa", name: "Como", imageUrl: "https://img/c.png", meta: "Italie · Serie A" });
  assert.deepEqual(neighbourBrief({ id: "t_b", name: "B", imageUrl: null, league: null }, () => ""), { id: "t_b", name: "B", imageUrl: null, meta: "" });
});

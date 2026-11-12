import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";

// The hook reads through the resource cache; the rows are pure.
const source = await fs.readFile(new URL("../dashboard/frontend/src/services/player-neighbours.js", import.meta.url), "utf8");
const { neighbourRows } = await import("data:text/javascript," + encodeURIComponent(source.replace(/^import .*$/m, "const useResource = null, json = null;")));

test("a neighbour shows who he is, where he plays and how close he is", () => {
  const rows = neighbourRows({ compared: 9000, similar: [
    { id: "p_a", name: "Michael Olise", similarity: 86, image_url: "https://img.example/a.webp", team: { id: "t_a", name: "Bayern München" }, position: "Ailier", role: "winger" },
    { id: "p_b", name: "Sans Classement", similarity: 0 },
    { id: "p_c", name: "", similarity: 50 },
    { id: "p_d", name: "Sans Mesure", team: { id: "t_d", name: "Club" } },
  ] });
  assert.deepEqual(rows, [
    { id: "p_a", name: "Michael Olise", imageUrl: "https://img.example/a.webp", similarity: 86, context: "Bayern München · Ailier" },
    { id: "p_b", name: "Sans Classement", imageUrl: null, similarity: 0, context: "" },
    { id: "p_d", name: "Sans Mesure", imageUrl: null, similarity: null, context: "Club" },
  ]);
  assert.deepEqual(neighbourRows(null), []);
  assert.deepEqual(neighbourRows({}), []);
});

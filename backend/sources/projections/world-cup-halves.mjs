import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const decisions = JSON.parse(readFileSync(new URL("./world-cup-halves.json", import.meta.url)));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function worldCupHalf(season, match, score) {
  const key = [season, match.date, match.team1, match.team2].join("|");
  const proof = decisions[key];
  if (!proof || match.status || !score || !same(score.et ?? score.ft, proof.source_final)
      || ![proof.native_ht, proof.official_ht].some((ht) => same(score.ht ?? null, ht))) return null;
  const arms = [match.goals1, match.goals2];
  if (!arms.every((arm, i) => Array.isArray(arm) && arm.length === proof.source_final[i]
      && arm.every((g) => g && typeof g === "object"))) return null;
  // The reviewed lists include the beneficiary's source side, original ordered minutes,
  // own goals and in-play penalties. Changed or incomplete arms do not supply a new fact.
  const timeline = arms.map((arm) => arm.map((g) => [String(g.minute), g.owngoal === true, g.penalty === true]));
  const digest = createHash("sha256").update(JSON.stringify(timeline)).digest("hex");
  if (digest !== proof.native_timeline_sha256) return null;
  return proof;
}

/**
 * Vega's match grade, the site's only match rating (15 November 2026): how exceptional a
 * match was for the player's role, whatever his season, on the 0–100 curve of Vega's
 * ranking (50 an ordinary match of the role). The API gives each appearance its `grade`
 * (shown from 20 minutes, or below them for an extreme match) and its normal score `gradeZ`
 * (vega/power.py, « Match grades »; docs/calculs/08-notes-vega).
 */
import { isNumber } from "./format.js";

/** The grade of a normal score z: 100 / (1 + 10^(−z/4)). */
export const gradeOf = (z) => 100 / (1 + 10 ** (-z / 4));

/** The matches a season grade reads: 20 minutes or more (vega/power.py, GRADE_SEASON_MINUTES). */
export const GRADE_SEASON_MINUTES = 20;

/**
 * A season grade: the grade of the minutes-weighted mean z of the rows' matches of 20 minutes
 * or more (averaging z, not grades: the curve compresses its tails). { grade, count, minutes }.
 */
export function seasonGrade(rows) {
  let zm = 0,
    minutes = 0,
    count = 0;
  for (const row of rows || []) {
    if (!(row.minutes >= GRADE_SEASON_MINUTES) || !isNumber(row.gradeZ)) continue;
    zm += row.minutes * row.gradeZ;
    minutes += row.minutes;
    count++;
  }
  return { grade: minutes ? gradeOf(zm / minutes) : null, count, minutes };
}

/** About the best 7 % of full matches (z ≥ 1.47) and the worst 7 %. */
export const GRADE_HIGH = 70;
export const GRADE_LOW = 30;

/** The grade's tone, 1 (poor) to 5 (outstanding), by tail shares of full matches. */
export const gradeTone = (grade) => (grade >= GRADE_HIGH ? 5 : grade >= 60 ? 4 : grade >= 40 ? 3 : grade >= GRADE_LOW ? 2 : 1);

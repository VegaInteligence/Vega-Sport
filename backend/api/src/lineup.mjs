/**
 * What a club's expected points become when one player plays in another's place: the same
 * calculation as backend/vega/lineup.py (rate, points, replace), which fits the model and
 * documents it; the two are held together by the values both test suites check.
 */
import { outcome, rates } from "./inplay.mjs";

export const LAMBDA = 450; // power.LAMBDA: the minutes that draw a rate towards 0
const WHOLE_MATCH = { down: 1, up: 1 };

/** A player's own rate per 90 minutes, from his own contributions and his minutes. */
export const ownRate = (total, minutes) => (90 * total) / (minutes + LAMBDA);

/**
 * A club's expected points per league match against a side of `opponents` Elo, half of
 * its matches at home and half away, with `shift` Elo points added to the club.
 * `model`: the forecast's coefficients (home_base, home_slope, away_base, away_slope, rho).
 */
export function points(model, elo, opponents, shift = 0) {
  const [homeFor, homeAgainst] = rates(model, elo + shift, opponents);
  const [win, drawAtHome] = outcome(homeFor, homeAgainst, 1, 0, 0, 0, 0, WHOLE_MATCH, model.rho);
  const [awayAgainst, awayFor] = rates(model, opponents, elo + shift);
  const [, drawAway, winAway] = outcome(awayAgainst, awayFor, 1, 0, 0, 0, 0, WHOLE_MATCH, model.rho);
  return 0.5 * (3 * win + drawAtHome) + 0.5 * (3 * winAway + drawAway);
}

/** The Elo points and the expected points per league match a club gains when a player of
 *  own rate `rateIn` plays in the place of one of rate `rateOut`. */
export function replace(model, eloPerUnit, elo, opponents, rateIn, rateOut) {
  const shift = eloPerUnit * (rateIn - rateOut);
  return { shift, points: points(model, elo, opponents, shift) - points(model, elo, opponents) };
}

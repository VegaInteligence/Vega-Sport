/**
 * Win, draw and loss during a match: the forecast carried through its minutes. The same
 * calculation as backend/vega/inplay.py (which fits the model and documents it); the two
 * are held together by the values both test suites check.
 */
export const MAX_GOALS = 10;
export const QUARTERS = 6;
export const ADDED = 8;
export const MAX_RED = 2;
export const ELO_HOME = 60; // power.ELO_HOME: the home side's advantage, 0 on neutral ground

/** P(0..top) of a Poisson law, the last cell taking the tail. */
export function poisson(lam, top = MAX_GOALS) {
  const out = [];
  let p = Math.exp(-lam);
  for (let k = 0; k < top; k++) {
    out.push(p);
    p *= lam / (k + 1);
  }
  out.push(Math.max(0, 1 - out.reduce((a, b) => a + b, 0)));
  return out;
}

/** Dixon and Coles' correction of the four lowest scores. */
export function tau(i, j, lh, la, rho) {
  if (i === 0 && j === 0) return 1 - lh * la * rho;
  if (i === 0 && j === 1) return 1 + lh * rho;
  if (i === 1 && j === 0) return 1 + la * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

/** The expected goals of each side from the two strengths and the forecast's coefficients. */
export function rates(model, eloHome, eloAway, neutral = false) {
  const d = (eloHome + (neutral ? 0 : ELO_HOME) - eloAway) / 400;
  return [Math.exp(model.home_base + model.home_slope * d), Math.exp(model.away_base - model.away_slope * d)];
}

/** The share of a match's goals still to come after `minute` (+ `added` minutes). */
export function remaining(profile, minute, added = 0) {
  const tail = profile[QUARTERS];
  if (minute >= 90) return tail * Math.max(0, 1 - Math.min(added || 0, ADDED) / ADDED);
  const clock = Math.max(0, minute);
  const index = Math.min(QUARTERS - 1, Math.floor(clock / 15));
  let rest = profile[index] * (1 - (clock - 15 * index) / 15) + tail;
  for (let k = index + 1; k < QUARTERS; k++) rest += profile[k];
  return rest;
}

/** (home win, draw, away win) from the present state. */
export function outcome(rateHome, rateAway, share, scoreHome, scoreAway, redsHome, redsAway, model, rho = 0) {
  const home = Math.min(redsHome || 0, MAX_RED), away = Math.min(redsAway || 0, MAX_RED);
  const lh = rateHome * share * model.down ** home * model.up ** away;
  const la = rateAway * share * model.down ** away * model.up ** home;
  if (lh <= 0 && la <= 0) return scoreHome > scoreAway ? [1, 0, 0] : scoreHome === scoreAway ? [0, 1, 0] : [0, 0, 1];
  const ph = poisson(lh), pa = poisson(la);
  let win = 0, draw = 0, loss = 0;
  for (let i = 0; i < ph.length; i++)
    for (let j = 0; j < pa.length; j++) {
      const weight = ph[i] * pa[j] * Math.max(0, tau(scoreHome + i, scoreAway + j, rateHome, rateAway, rho));
      const final = scoreHome + i - scoreAway - j;
      if (final > 0) win += weight;
      else if (final === 0) draw += weight;
      else loss += weight;
    }
  const total = win + draw + loss;
  return total > 0 ? [win / total, draw / total, loss / total] : [1 / 3, 1 / 3, 1 / 3];
}

/**
 * The three probabilities at each minute from 0 to `last`. `events`: [{minute, added, kind,
 * side}] with kind "goal" or "red"; an event of minute m counts from minute m on.
 */
export function timeline(rateHome, rateAway, events, model, rho = 0, last = 90) {
  const ordered = [...events].sort((a, b) => Math.min(a.minute, last) - Math.min(b.minute, last) || (a.added || 0) - (b.added || 0));
  const state = [0, 0, 0, 0];
  const points = [];
  let index = 0;
  for (let minute = 0; minute <= last; minute++) {
    while (index < ordered.length && Math.min(ordered[index].minute, last) <= minute) {
      const e = ordered[index++];
      state[(e.kind === "goal" ? 0 : 2) + (e.side === "home" ? 0 : 1)]++;
    }
    const [home, draw, away] = outcome(rateHome, rateAway, remaining(model.profile, minute, 0), state[0], state[1], state[2], state[3], model, rho);
    points.push({ minute, home, draw, away, score: [state[0], state[1]] });
  }
  return points;
}

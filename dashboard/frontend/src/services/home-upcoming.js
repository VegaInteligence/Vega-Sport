/**
 * « Prochains matchs » (doc "Prochains matchs : comment on choisit"). The
 * block keeps its design: a big card with its countdown, four matches in a list, and a
 * match leaves at kick-off. Only the choice of the five and their order change:
 *
 * 1. candidates: the big matches of the common read (scope, next 7 days, by editorial
 *    weight) and the favourites' matches of the personal read (each favourite's next
 *    match, whatever the competition, up to 21 days);
 * 2. a favourite's strength: a followed club, then a followed player's last observed
 *    club, then his national team; a match between two favourites counts once;
 * 3. favourites in order: one match per favourite first (its closest), from the
 *    strongest favourite to the weakest; then their other matches. Ties: the closest,
 *    then a European cup before a league;
 * 4. places: five, at most three for the favourites, the rest to the big matches by
 *    editorial weight; when one side is short, the other completes up to five;
 * 5. the big card: the closest favourite match if it is within 48 h, else the highest
 *    editorial weight, else the closest favourite match;
 * 6. the list: the others by day, then time (NextMatches, upcomingDayOrder).
 *
 * The thresholds come with the other settings of the home (api.home_rules_v1).
 *
 * « À l'affiche » (VI-48): when the common read serves `billboard` (yesterday → today + 3, each match
 * with its importance v2 `weight`), the big matches come from it instead (chooseBillboard): the
 * favourites keep their places and their card, the big card is the most important match, and a
 * match still leaves at kick-off (the API's billboard also serves yesterday: never shown here).
 * Without a usable billboard (an older API, nothing left to play), the choice above is unchanged. The visitor's
 * country takes part in it under the priority of home-priority.js (chooseBillboard's `local`, `priority`);
 * the choice above ignores it.
 */
import { HOME_PRIORITIES, HOME_PRIORITY, PRIORITY_RULES, priorityOf } from "./home-priority.js";

export const DEFAULT_RULES = Object.freeze({ places: 5, favouritePlaces: 3, bigCardHours: 48 });

const closest = (a, b) => a.time - b.time || Number(b.europe) - Number(a.europe) || String(a.fixture.id).localeCompare(String(b.fixture.id));
const heaviest = (a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.time - b.time || String(a.fixture.id).localeCompare(String(b.fixture.id));

/** The favourites' matches in the order of step 3. */
export function favouriteOrder(favourites = [], matches = []) {
  const strength = new Map(favourites.map((f) => [f.teamId, f.strength]));
  const byTime = [...matches].sort(closest);
  // Step 3, first round: each favourite's closest match, strongest favourites first.
  const firsts = favourites
    .map((f) => ({ favourite: f, match: byTime.find((m) => (m.favourites || []).includes(f.teamId)) }))
    .filter((x) => x.match)
    .sort((a, b) => a.favourite.strength - b.favourite.strength || closest(a.match, b.match));
  const order = [],
    seen = new Set(),
    served = new Set();
  for (const { favourite, match } of firsts) {
    if (served.has(favourite.teamId) || seen.has(match.fixture.id)) continue;
    order.push(match);
    seen.add(match.fixture.id);
    // One match between two favourites serves both.
    for (const team of match.favourites || []) served.add(team);
  }
  // Then their other matches, the closest first.
  for (const match of byTime) {
    if (seen.has(match.fixture.id)) continue;
    if (!(match.favourites || []).some((team) => strength.has(team))) continue;
    order.push(match);
    seen.add(match.fixture.id);
  }
  return order;
}

/**
 * The five upcoming matches, the big card first. `editorial` and `matches` carry
 * { fixture, time, weight?, europe, favourites? }; matches already kicked off leave.
 */
export function chooseUpcoming({ editorial = [], billboard, favourites = [], matches = [], rules, now = Date.now(), local = null, priority = HOME_PRIORITY } = {}) {
  if (Array.isArray(billboard)) {
    const picked = chooseBillboard({ billboard, favourites, matches, rules, now, local, priority });
    if (picked.length) return picked;
  }
  const { places, favouritePlaces, bigCardHours } = { ...DEFAULT_RULES, ...(rules || {}) };
  const ahead = (m) => m && m.time >= now;
  const ordered = favouriteOrder(favourites, matches.filter(ahead));
  const favouriteIds = new Set(ordered.map((m) => m.fixture.id));
  const big = editorial.filter((m) => ahead(m) && !favouriteIds.has(m.fixture.id)).sort(heaviest);
  // Step 4: three places at most for favourites, the rest to the big matches; a short
  // side is completed by the other.
  let mine = ordered.slice(0, favouritePlaces);
  const theirs = big.slice(0, places - mine.length);
  if (mine.length + theirs.length < places) mine = ordered.slice(0, places - theirs.length);
  // A favourite's match keeps its editorial weight when the common read has it.
  const weights = new Map(editorial.map((m) => [m.fixture.id, m.weight]));
  const picked = [...mine.map((m) => ({ ...m, weight: m.weight ?? weights.get(m.fixture.id) ?? 0, favourite: true })), ...theirs];
  if (!picked.length) return [];
  // Step 5: the big card.
  const nearest = [...mine].sort(closest)[0];
  const card =
    nearest && nearest.time - now <= bigCardHours * 3_600_000
      ? nearest
      : [...theirs].sort(heaviest)[0] || nearest;
  const first = picked.find((m) => m.fixture.id === card.fixture.id);
  // Step 6: NextMatches orders the others by day, then time.
  return [first, ...picked.filter((m) => m !== first)];
}

// The card is the matches to come: a match leaves at kick-off (or once the feed says it started or ended).
// The home's strip uses the same rule for its matches to come (home-insights.js, scoreboardTicker).
export const ahead = (m, now) => m.time >= now && m.fixture?.status !== "finished" && m.fixture?.status !== "in_play";

/**
 * The five of « À l'affiche », the big card first, each marked `billboard: true`; none when
 * the billboard has nothing left to play (the caller then keeps today's choice). Only matches
 * to come: the billboard's finished and in-play matches (yesterday's results) are never picked.
 *
 * The visitor's country (home-priority.js): `local` is the list of the country's candidates
 * (localMatches: the billboard's local matches and home-local's inside the billboard's window),
 * or null without a country or an answer, which is the choice of before. `priority`:
 * - "location": after the favourites, up to PRIORITY_RULES.localPlaces places go to the country's
 *   most important matches to come, leaving at least bigPlacesKept to the big matches when there
 *   are any; the rest to the big matches by importance; a short side is completed by the other;
 * - "importance": importance only, a local match first at equal importance.
 * The big card: a favourite's match within 48 h, else the most important of the picked.
 */
export function chooseBillboard({ billboard = [], favourites = [], matches = [], rules, now = Date.now(), local = null, priority = HOME_PRIORITY } = {}) {
  const { places, favouritePlaces, bigCardHours } = { ...DEFAULT_RULES, ...(rules || {}) };
  const ordered = favouriteOrder(favourites, matches.filter((m) => m && ahead(m, now)));
  const favouriteIds = new Set(ordered.map((m) => m.fixture.id));
  // One record per match, the billboard's first; home-local's local candidates after it.
  const pool = [],
    seen = new Set();
  for (const m of [...billboard, ...(local || [])])
    if (m?.fixture && !seen.has(m.fixture.id)) {
      seen.add(m.fixture.id);
      pool.push(m);
    }
  const localIds = new Set((local || []).map((m) => m?.fixture?.id));
  const isLocal = (m) => localIds.has(m.fixture.id);
  const rest = pool.filter((m) => ahead(m, now) && !favouriteIds.has(m.fixture.id));
  const order = priorityOf(priority) === HOME_PRIORITIES.IMPORTANCE ? (a, b) => (b.weight ?? 0) - (a.weight ?? 0) || Number(isLocal(b)) - Number(isLocal(a)) || heaviest(a, b) : heaviest;
  let mine = ordered.slice(0, favouritePlaces);
  const free = places - mine.length;
  let theirs;
  if (local && priorityOf(priority) === HOME_PRIORITIES.LOCATION) {
    const { localPlaces, bigPlacesKept } = PRIORITY_RULES;
    const locals = rest.filter(isLocal).sort(heaviest),
      bigs = rest.filter((m) => !isLocal(m)).sort(heaviest);
    let nLocal = Math.min(localPlaces, locals.length, bigs.length ? Math.max(free - bigPlacesKept, 0) : free);
    const nBig = Math.min(bigs.length, free - nLocal);
    nLocal = Math.min(locals.length, free - nBig);
    theirs = [...locals.slice(0, nLocal), ...bigs.slice(0, nBig)];
  } else theirs = [...rest].sort(order).slice(0, free);
  if (mine.length + theirs.length < places) mine = ordered.slice(0, places - theirs.length);
  const nearest = [...mine].sort(closest)[0];
  const card =
    (nearest && nearest.time - now <= bigCardHours * 3_600_000 ? nearest : null) ||
    [...theirs].sort(order)[0] ||
    nearest;
  if (!card) return [];
  const weights = new Map(pool.map((m) => [m.fixture.id, m.weight]));
  const mark = (m, favourite) => ({
    ...m,
    ...(favourite && { weight: weights.get(m.fixture.id) ?? m.weight ?? 0, favourite: true }),
    billboard: true,
  });
  const picked = [...mine.map((m) => mark(m, true)), ...theirs.map((m) => mark(m, false))];
  const first = picked.find((m) => m.fixture.id === card.fixture.id);
  return [first, ...picked.filter((m) => m !== first)];
}

/**
 * The visitor's country inside the home's existing cards (VI-48, #69; doc "Accueil", « Le pays du visiteur »).
 * No card of its own: the country changes which matches « À l'affiche » picks (home-upcoming.js, chooseBillboard)
 * and the order of the results strip (home-insights.js, weekTicker). How much it weighs is the priority below.
 *
 * A match is local when its competition's country is the visitor's (the base's three-letter code): a European cup
 * is never local, whoever plays in it.
 */

export const HOME_PRIORITIES = Object.freeze({
  /** The country's matches get reserved places in « À l'affiche » and lead each day of the results strip. */
  LOCATION: "location",
  /** Importance only; the country decides only between two matches of equal importance. */
  IMPORTANCE: "importance",
});

/*
 * MEMO (VI-48, 24 Nov 2026): this will become a user setting, « Privilégier : localisation ou importance du match »,
 * in the home's preferences / the account settings (accounts: VI-38). Until then it is fixed here, on purpose: do
 * not read it from the preferences, a cookie or the URL, and show no control for it. Every function that orders
 * matches takes `priority` as a parameter (chooseUpcoming / chooseBillboard, weekTicker), so the setting will only
 * have to be passed in; both values are implemented and tested (tests/home-priority.test.mjs).
 * Where the stored value will come from: `preferences.homePriority` of the preferences store (orion.preferences.v1,
 * FootballContext; "" = not chosen), which the shared contract carries as `homePriority` ("location" |
 * "importance" | null) to and from the account (user-preferences.js, GET / PUT /account/preferences, VI-38). It is
 * already stored and synced, and read by nothing: applying it is `priorityOf(f.preferences.homePriority)` here,
 * plus the home cookie (home-bootstrap-preferences.js) for the server render.
 */
export const HOME_PRIORITY = HOME_PRIORITIES.LOCATION;

export const PRIORITY_RULES = Object.freeze({
  /** "location": places of « À l'affiche » given to the country's most important matches, after the favourites'. */
  localPlaces: 2,
  /** "location": places always left to the big matches when there are any. */
  bigPlacesKept: 1,
});

/** A known priority, else the fixed one. */
export const priorityOf = (value) =>
  Object.values(HOME_PRIORITIES).includes(value) ? value : HOME_PRIORITY;

const leagueOf = (record) =>
  record?.leagueId || record?.league?.id || record?.fixture?.league?.id || "";

/**
 * The country's competitions: those of `collections` ({ id, country }: the page's competition index, home-local's
 * `competitions`) whose country is `country`; null without a country.
 */
export function localLeagues(country, ...collections) {
  if (!country) return null;
  const ids = new Set();
  for (const collection of collections)
    for (const competition of collection || [])
      if (competition?.id && competition.country === country) ids.add(competition.id);
  return ids;
}

/** A result, a fixture or a window record of one of the country's competitions. */
export const isLocal = (record, leagues) =>
  Boolean(leagues?.size) && leagues.has(leagueOf(record));

/**
 * The local candidates of « À l'affiche »: the billboard's own local matches, then home-local's matches whose Paris
 * `day` is inside the billboard's window as the API states it (`window`, none without it) and whose league is in the
 * visitor's chosen scope (`scopeIds`, null: every league); once each, the billboard's record kept. null when there is
 * no home-local answer (`local`): the caller then keeps the choice of before.
 */
export function localMatches({ billboard = [], local, window, scopeIds = null, leagues }) {
  if (!local || !leagues) return null;
  const seen = new Set(),
    out = [];
  const add = (match) => {
    const id = match?.fixture?.id;
    if (id == null || seen.has(id)) return;
    seen.add(id);
    out.push(match);
  };
  for (const match of billboard || []) if (isLocal(match, leagues)) add(match);
  if (window?.start && window?.end)
    for (const match of local.matches || [])
      if (
        typeof match?.day === "string" &&
        match.day >= window.start &&
        match.day <= window.end &&
        isLocal(match, leagues) &&
        (!scopeIds || scopeIds.has(leagueOf(match)))
      )
        add(match);
  return out;
}

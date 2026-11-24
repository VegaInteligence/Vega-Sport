/**
 * What /compte says about the account (VI-38, docs/COMPTES_SITE.md S1 to S5): the monogram's letter and a summary
 * of a preferences contract (user-preferences.js). Pure: reads only, never throws.
 */
const KINDS = ["clubs", "nations", "players", "matches"];
/** The kinds listed as favourites; a match is counted, not listed. */
const LISTED = ["clubs", "nations", "players"];
export const FAVOURITES_SHOWN = 8;

const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === "string" ? value : "");
const firstSign = (value) => text(value).match(/[\p{L}\p{N}]/u)?.[0] ?? "";

/** One capital for the monogram: from the name, else from the address before « @ »; "" when nothing reads. */
export function accountInitial(user) {
  const sign = firstSign(user?.name) || firstSign(text(user?.email).split("@")[0]);
  return sign.toLocaleUpperCase("fr");
}

/**
 * { counts: { clubs, nations, players, matches }, favourites: [{ kind, id, name, imageUrl }], more, leagues, views,
 *   templates, country }: distinct ids per kind over every list; the first FAVOURITES_SHOWN clubs, nations and
 * players in the lists' order (`shown`: another limit, Infinity for all), `more` the ones left out; country "auto"
 * (detection), "none" or a code.
 */
export function accountSummary(contract, { shown = FAVOURITES_SHOWN } = {}) {
  const limit = shown === Infinity || (Number.isInteger(shown) && shown > 0) ? shown : FAVOURITES_SHOWN;
  const c = contract && typeof contract === "object" && !Array.isArray(contract) ? contract : {};
  const seen = Object.fromEntries(KINDS.map((kind) => [kind, new Set()]));
  const listed = [];
  for (const one of list(c.lists)) {
    for (const entry of list(one?.entries)) {
      const kind = entry?.kind;
      if (!KINDS.includes(kind) || typeof entry.id !== "string" || !entry.id || seen[kind].has(entry.id)) continue;
      seen[kind].add(entry.id);
      if (LISTED.includes(kind)) listed.push({ kind, id: entry.id, name: text(entry.name), imageUrl: text(entry.imageUrl) });
    }
  }
  return {
    counts: Object.fromEntries(KINDS.map((kind) => [kind, seen[kind].size])),
    favourites: listed.slice(0, limit),
    more: Math.max(0, listed.length - limit),
    leagues: list(c.leagues).length,
    views: list(c.views).length,
    templates: list(c.templates).length,
    country: c.country === "none" ? "none" : typeof c.country === "string" && /^[A-Z]{3}$/.test(c.country) ? c.country : "auto",
  };
}

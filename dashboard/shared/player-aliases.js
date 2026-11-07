// Aliases belong to provider identities, never to every player with that name.
const ALIASES = Object.freeze({ p_3yEwhj: Object.freeze(["cr7"]) });
const EMPTY = Object.freeze([]);

export const playerAliasEntries = () => Object.entries(ALIASES);

export const playerSearchAliases = (id) =>
  Object.hasOwn(ALIASES, id) ? ALIASES[id] : EMPTY;

export function playerAliasIds(query) {
  const value = String(query).trim().toLowerCase();
  return Object.keys(ALIASES).filter((id) => ALIASES[id].includes(value));
}

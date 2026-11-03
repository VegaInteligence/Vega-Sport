// Aliases are tied to provider IDs so namesakes never inherit a nickname.
const ALIASES = Object.freeze({ p_3yEwhj: Object.freeze(["cr7"]) });
const EMPTY = Object.freeze([]);
export const playerSearchAliases = (id) =>
  Object.hasOwn(ALIASES, id) ? ALIASES[id] : EMPTY;

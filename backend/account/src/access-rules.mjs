/**
 * The single list of reserved reads: path prefix -> minimum level (2 Plus, 3 Pro). A read
 * that no rule names is public. The gate before the cache applies it (gate.mjs), and the
 * site reads the same list to know which offer opens a block.
 *
 * Empty until an offer opens: stage 1 (free accounts) reserves nothing. A read enters this
 * list only once it is served on a path of its own (a response that carries public and
 * reserved content together cannot be refused before the cache: VI-38).
 */
export const ACCESS_RULES = [];

/**
 * What /compte decides (VI-38, docs/COMPTES_SITE.md section 10): whether the account has a password, whether the sync
 * is worth a word, and how the favourites are grouped. Pure: reads only, never throws.
 */
import { syncLabel } from "./account-messages.js";

/** Favourites shown per kind before « Afficher les N autres » (C4). */
export const FAVOURITES_PER_KIND = 6;
const KINDS = [
  ["clubs", "Clubs"],
  ["players", "Joueurs"],
  ["nations", "Nations"],
];
/** The sync states that are said (C3); every other one works, or is about to. */
const SAID = new Set(["failed", "stopped", "unavailable"]);

/**
 * C2: Better Auth's listAccounts() answer ({ data, error }) → true (a "credential" account: a password), false (none),
 * null (an error, no list: unknown, the row stays hidden).
 */
export function hasPassword(answer) {
  const data = answer && typeof answer === "object" ? answer.data : undefined;
  if (!Array.isArray(data)) return null;
  return data.some((account) => account?.providerId === "credential");
}

/** C3: { state, text, detail } when the sync does not work, else null. Without the account API: unavailable (W2). */
export function syncNote(sync, syncOn) {
  const state = syncOn ? sync?.state : "unavailable";
  if (!SAID.has(state)) return null;
  const label = syncLabel({ ...(syncOn ? sync : {}), state });
  return { state, text: `Synchronisation ${label.text.toLocaleLowerCase("fr")}`, detail: label.detail };
}

/**
 * C4: the favourites ({ kind, id, name, imageUrl }, the lists' order) → [{ kind, label, entries, more }], clubs, players,
 * nations; FAVOURITES_PER_KIND each unless the kind is in `opened`. A kind without favourites has no group.
 */
export function favouriteGroups(favourites, opened = new Set()) {
  const list = Array.isArray(favourites) ? favourites : [];
  return KINDS.map(([kind, label]) => {
    const every = list.filter((entry) => entry?.kind === kind && typeof entry.id === "string" && entry.id);
    const entries = opened?.has?.(kind) ? every : every.slice(0, FAVOURITES_PER_KIND);
    return { kind, label, entries, more: every.length - entries.length };
  }).filter((group) => group.entries.length);
}

/** C4: the words of the rest. */
export const moreLabel = (count) => (count === 1 ? "Afficher l’autre" : `Afficher les ${count} autres`);

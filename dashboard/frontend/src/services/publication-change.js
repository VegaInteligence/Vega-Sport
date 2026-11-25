/**
 * The API refused a read pinned to the publication the site holds (409: a newer one is
 * published). The read recovers on its own (compact-reads.js, match-pages.js); this tells
 * the site to re-read its manifest (FootballContext), so the next reads name the current
 * publication.
 */
const listeners = new Set();

/** What a read still refused after recovering says, never the API's refusal text. */
export const PUBLICATION_UNAVAILABLE = "Données momentanément indisponibles.";

export function onPublicationChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyPublicationChanged() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A listener's failure never fails the read that recovered.
    }
  }
}

/**
 * The publications a visitor asked for by their link (`?v=`, FootballContext): a read pinned
 * to one of them shows it or fails, it is never read again at another publication nor
 * labelled with it (compact-reads.js). Returns the release.
 */
const explicit = new Map();

export function holdExplicitPublication(generation) {
  if (!generation) return () => {};
  explicit.set(generation, (explicit.get(generation) || 0) + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const count = explicit.get(generation) - 1;
    if (count > 0) explicit.set(generation, count);
    else explicit.delete(generation);
  };
}

export const isExplicitPublication = (generation) =>
  Boolean(generation) && explicit.has(generation);

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

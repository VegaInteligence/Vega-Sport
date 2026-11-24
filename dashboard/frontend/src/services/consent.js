/**
 * Consent to the audience and speed measurement (Vercel Web Analytics and Speed Insights), for visitors in Europe.
 *
 * Who is asked: the server decides from Vercel's geolocation headers (`consentFor`), read by /api/consent-region only;
 * the pages stay static or cached and never carry the banner. Unknown location → asked. The IP address is never read.
 * What is kept: one localStorage key, `vega.consent.v1` = { measurement: true|false, at: ISO date }, per browser,
 * valid six months. Nothing else waits for a consent: theme, preferences, favourites and the session are asked for by
 * the visitor.
 */

export const CONSENT_KEY = "vega.consent.v1";
/** The privacy page's section on cookies and the browser's storage (src/content/legal-privacy.jsx, id `cookies`). */
export const PRIVACY_HREF = "/confidentialite#cookies";
/** Sent by the footer's « Cookies » button (ConsentSettingsLink) to show the banner again. */
export const CONSENT_OPEN_EVENT = "vega:consent-open";
export const CONSENT_REGION_PATH = "/api/consent-region";
/** Six months: after that the choice is asked again. */
export const CONSENT_MAX_AGE_MS = 183 * 24 * 60 * 60 * 1000;

// EU law outside the continent Vercel reports: the outermost regions (Guadeloupe, Martinique, Guyane, La Réunion,
// Mayotte, Saint-Martin), plus the EU and EEA members by country, whatever continent the database gives them (Cyprus).
const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV",
  "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "IS", "LI", "NO", "GP", "MQ", "GF", "RE", "YT", "MF",
]);
const OTHER_CONTINENTS = new Set(["AF", "AN", "AS", "NA", "OC", "SA"]);

/**
 * "required" or "none", from the request's headers (a Headers or anything with get()).
 * Only a known continent outside Europe, with a country outside the EU, spares the banner.
 */
export function consentFor(headers) {
  const continent = (headers.get("x-vercel-ip-continent") || "").trim().toUpperCase();
  const country = (headers.get("x-vercel-ip-country") || "").trim().toUpperCase();
  if (EU_COUNTRIES.has(country)) return "required";
  return OTHER_CONTINENTS.has(continent) ? "none" : "required";
}

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The stored choice still valid at `now`, or null (none, unreadable, from the future or older than six months). */
export function readConsent(now = Date.now()) {
  try {
    const saved = JSON.parse(storage()?.getItem(CONSENT_KEY) ?? "null");
    const at = Date.parse(saved?.at);
    if (typeof saved?.measurement !== "boolean" || Number.isNaN(at)) return null;
    if (at > now + 60_000 || now - at > CONSENT_MAX_AGE_MS) return null;
    return { measurement: saved.measurement, at: saved.at };
  } catch {
    return null;
  }
}

/** Keeps the choice; returns it (kept for this page only when the browser refuses storage). */
export function writeConsent(measurement, now = new Date()) {
  const choice = { measurement: Boolean(measurement), at: now.toISOString() };
  try {
    storage()?.setItem(CONSENT_KEY, JSON.stringify(choice));
  } catch {}
  return choice;
}

/** Shows the banner again with the current choice (the footer's « Cookies »). */
export function openConsentSettings() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
}

/**
 * The one image gate of the site (FAILURE_MODES.md §21): an image is asked of the API only when its
 * URL is a known provider's, Vega's reference to a reviewed packed image, or UEFA's logo of a club.
 * The API (/api/assets, media=1) then answers with the base's copy: no address is built from a URL.
 */
const VEGA_REFERENCE = /^\/sha256\/[a-f0-9]{64}\.(?:png|jpg|webp)$/;
const UEFA_CLUB_LOGO = /^\/imgml\/TP\/teams\/logos\/70x70\/\d+\.png$/;

export function acceptedImageSource(value) {
  if (typeof value !== "string" || !value || value.length > 2048) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  switch (url.hostname) {
    case "cdn.pitchapi.dev":
      return true;
    case "upload.wikimedia.org":
      return /^\/wikipedia\/commons\//.test(url.pathname);
    case "img.thesports.com":
      return /^\/football\/(?:team|competition)\/[a-z0-9]+\.(?:png|webp|jpe?g)$/i.test(url.pathname);
  }
  // The two exact forms: no query, no fragment.
  if (url.search || url.hash || /[?#]/.test(value)) return false;
  if (url.hostname === "media.vega.invalid") return VEGA_REFERENCE.test(url.pathname);
  if (url.hostname === "img.uefa.com") return UEFA_CLUB_LOGO.test(url.pathname);
  return false;
}

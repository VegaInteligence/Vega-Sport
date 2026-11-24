// The two synced values kept outside the stores (#69, user-preferences.js): the theme and the competition
// /competitions opens on. Read and written here so the toggle, the page and the account sync share one path.
import { PREFERRED_COMPETITION_KEY } from "./competition-standings.js";

export const THEME_KEY = "statarena.theme";
/** Fired on window when the theme is set from elsewhere than the toggle (the account's contract). */
export const THEME_EVENT = "vega:theme";

/** "light" | "dark" chosen by the visitor, else null (app/layout.jsx shows dark). */
export function readTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}

/** Shows and keeps a theme; null forgets the choice and shows dark. */
export function applyTheme(theme) {
  const root = document.documentElement,
    next = theme === "light" ? "light" : "dark";
  // Hover transitions on buttons, fields and cards would otherwise fade
  // those elements into the new theme after everything else: switch with
  // transitions off, then restore them once the new colours are painted.
  if (root.dataset.theme !== next) {
    root.setAttribute("data-theme-switching", "");
    root.dataset.theme = next;
    void document.body.offsetHeight;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => root.removeAttribute("data-theme-switching")),
    );
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", next === "light" ? "#F6F8FB" : "#0E0F12");
  // Before the storage, which a browser may refuse: the icon follows the theme shown.
  window.__vegaSetFavicon?.(next);
  try {
    if (theme === "light" || theme === "dark") localStorage.setItem(THEME_KEY, theme);
    else localStorage.removeItem(THEME_KEY);
  } catch {}
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
}

export function readPreferredCompetition() {
  try {
    return window.localStorage.getItem(PREFERRED_COMPETITION_KEY) || null;
  } catch {
    return null;
  }
}

/** Keeps the competition /competitions opens on; null forgets it. Read by the page when it opens. */
export function writePreferredCompetition(id) {
  try {
    if (id) window.localStorage.setItem(PREFERRED_COMPETITION_KEY, id);
    else window.localStorage.removeItem(PREFERRED_COMPETITION_KEY);
  } catch {}
}

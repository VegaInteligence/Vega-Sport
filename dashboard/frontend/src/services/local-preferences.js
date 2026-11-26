// The two synced values kept outside the stores (#69, user-preferences.js): the theme and the competition
// /competitions opens on. Read and written here so the toggle, the page and the account sync share one path.
import { PREFERRED_COMPETITION_KEY } from "./competition-standings.js";

export const THEME_KEY = "statarena.theme";
/** Fired on window when the theme is set from elsewhere than the toggle (the account's contract). */
export const THEME_EVENT = "vega:theme";

const CHOICES = ["light", "dark", "system"];

/** "light" | "dark" | "system" (follow the computer) chosen in the account's settings, else null: not chosen, the
 *  computer's theme is shown (app/layout.jsx; § 76.2). */
export function readTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    return CHOICES.includes(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** The theme a choice shows: light or dark as chosen, else the computer's. */
export function shownTheme(theme) {
  if (theme === "light" || theme === "dark") return theme;
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

/** Shows and keeps a theme; "system" and null show the computer's (null forgets the choice). */
export function applyTheme(theme) {
  const root = document.documentElement,
    next = shownTheme(theme);
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
  // Before the storage, which a browser may refuse: the icon and the browser's colour follow
  // the theme shown. Both tags are the theme script's (app/layout.jsx), not React's.
  window.__vegaSetFavicon?.(next);
  window.__vegaSetThemeColor?.(next);
  try {
    if (CHOICES.includes(theme)) localStorage.setItem(THEME_KEY, theme);
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

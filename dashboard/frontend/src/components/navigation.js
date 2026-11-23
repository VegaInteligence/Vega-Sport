/* The site's navigation (VI-41): the header groups the pages under menus by
 * use, the phone tab bar opens the same sections in a sheet. Labels come from
 * shared/pages.json so both stay in step with it. */
import { pages } from "../../../shared/pages.js";
import { EUROPE_FOCUS } from "../../../shared/competition-scope.js";

const page = (key) => pages.find((candidate) => candidate.key === key);
const link = (key, label) => ({
  key,
  path: page(key).path,
  label: label || page(key).title,
});

/** The sections, in reading order. A section with `items` is a menu. */
export const SECTIONS = [
  { ...link("overview"), key: "overview", icon: "home" },
  {
    key: "competitions",
    label: "Compétitions",
    icon: "trophy",
    items: [
      link("competitions", "Toutes les compétitions"),
      { ...link("archives"), icon: "archive" },
    ],
  },
  {
    key: "teams",
    label: "Équipes",
    icon: "shield",
    items: [link("clubs"), { ...link("nations"), icon: "flag" }],
  },
  {
    key: "players",
    label: "Joueurs",
    icon: "players",
    items: [
      link("players", "Tous les joueurs"),
      { ...link("power-ranking"), icon: "ranking" },
      { ...link("player-ranking"), icon: "medal" },
    ],
  },
  { ...link("matches"), key: "calendar", icon: "calendar" },
];

/** Pages about the site itself, under « Plus ». */
export const ABOUT = [{ ...link("method"), icon: "book" }];

/** The leagues a competitions menu opens straight onto. */
const SHORTCUT_IDS = [
  "l_3FJFUl",
  "l_4WFCIZ",
  "l_0ErfuF",
  "l_1Isor4",
  "l_0ALvwF",
  "l_0bfbkO",
];
const SHORTCUT_NAMES = { l_0bfbkO: "Ligue des champions" };
export const SHORTCUTS = SHORTCUT_IDS.map((id) => {
  const competition = EUROPE_FOCUS.find((entry) => entry.id === id);
  return { id, label: SHORTCUT_NAMES[id] || competition.name };
});

/** A competition's page, keeping the rest of the navigation's context. */
export function competitionHref(href, id) {
  const url = new URL(href("/competitions/"), "https://vega.local");
  url.searchParams.set("id", id);
  return `${url.pathname}${url.search}`;
}

const bare = (value = "") => value.replace(/\/+$/, "") || "/";
const OWNER = {
  overview: "overview",
  competitions: "competitions",
  archives: "competitions",
  clubs: "teams",
  nations: "teams",
  players: "players",
  "power-ranking": "players",
  "player-ranking": "players",
  matches: "calendar",
  calendar: "calendar",
  method: "about",
};

/** The page a path shows (a match, a club or a player belongs to its list). */
export function currentPage(path) {
  const here = bare(path);
  return (
    pages.find((candidate) => bare(candidate.path) === here) ||
    pages
      .filter(
        (candidate) =>
          candidate.path !== "/" && here.startsWith(`${bare(candidate.path)}/`),
      )
      .sort((a, b) => b.path.length - a.path.length)[0]
  );
}
/** The section a path lights up. */
export const currentSection = (path) => OWNER[currentPage(path)?.key];
/** Whether a link points at the page shown. */
export const isCurrent = (path, item) =>
  bare(currentPage(path)?.path) === bare(item.path);

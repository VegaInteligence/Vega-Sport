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

/** The sections, in reading order. A section with `items` is a menu; `short` is its name
 * where room is short (the phone's tab bar, the header under 761px). */
export const SECTIONS = [
  { ...link("overview"), key: "overview", icon: "home", short: "Accueil" },
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
/* Their logos, as the provider's competitions list gives them (`imageUrl`): the menus draw them with
   `Media`, which reads its copy on the site's API and falls back to the initials (§ 76). */
const LEAGUE_LOGO = {
  l_3FJFUl: "60132b94cec9376428f59561ef11650b8a69b097d492642f9b737dc76f45cf94",
  l_4WFCIZ: "91b2d9475023f0a6197af3d0d9295809f8a2ba871e9a8dc538da6a3d5604bb3e",
  l_0ErfuF: "4a840c09a3b5d1b2150eeba66e2c31d83d23503c0df04b3ddd04341f9c7b2b48",
  l_1Isor4: "f798d3b662336f2336cbd121d4e83958ae3205fb9922b6716e2e9bd5eb7c6050",
  l_0ALvwF: "1e6b2d0d7b14ef10ae27b51a6a7f536b32fdceea229d84c475be346978232f22",
  l_0bfbkO: "b1d686d355832acff3032f4b9ee3cf885bf81879dac40c68e6ad033b695c1210",
};
export const SHORTCUTS = SHORTCUT_IDS.map((id) => {
  const competition = EUROPE_FOCUS.find((entry) => entry.id === id);
  return {
    id,
    label: SHORTCUT_NAMES[id] || competition.name,
    logo: LEAGUE_LOGO[id]
      ? `https://cdn.pitchapi.dev/images/leagues/${LEAGUE_LOGO[id]}.webp`
      : undefined,
  };
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

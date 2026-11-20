"use client";
import React, { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import Icon from "./Icon.jsx";
import GlobalSearch from "./GlobalSearch.jsx";
import { pages } from "../../../shared/pages.js";
import { SECTIONS, currentSection } from "./navigation.js";
import { NavIcon, PhoneSheet } from "./SiteNavigation.jsx";

/** A tab's short label and icon, by page key. */
const TABS = {
  overview: ["Accueil", "home"],
  competitions: ["Compétitions", "trophy"],
  clubs: ["Clubs", "shield"],
  players: ["Joueurs", "players"],
};
/** The search sits in the middle of the bar, after this tab. */
const SEARCH_AFTER = "competitions";
/** Pages without a tab light the tab of the section they belong to. */
const SECTION = {
  archives: "competitions",
  nations: "clubs",
  "player-ranking": "players",
  "power-ranking": "players",
};
const bare = (path = "") => path.replace(/\/+$/, "") || "/";
const tabs = pages
  .filter((page) => TABS[page.key])
  .map((page) => ({
    key: page.key,
    path: page.path,
    label: TABS[page.key][0],
    icon: TABS[page.key][1],
  }));
const before = tabs.findIndex((tab) => tab.key === SEARCH_AFTER) + 1;

function activeTab(path) {
  const here = bare(path);
  const page =
    pages.find((candidate) => bare(candidate.path) === here) ||
    pages
      .filter(
        (candidate) =>
          candidate.path !== "/" && here.startsWith(`${bare(candidate.path)}/`),
      )
      .sort((a, b) => b.path.length - a.path.length)[0];
  return SECTION[page?.key] || page?.key;
}

/**
 * The phone navigation: a bar floating above the bottom of the screen, four
 * of the header's pages with the search in the middle; the calendar is a
 * button of the header, beside the theme (SiteHeader). styles.css
 * shows it under 640px, where the header's own links and search field are
 * hidden; wider screens keep the header. The search opens as a bar floating
 * over the page, which a touch beside it closes.
 */
export default function TabBar({ path, href }) {
  const active = activeTab(path);
  const [searching, setSearching] = useState(false);
  // A (VI-41): the section whose pages are open in a sheet.
  const [sheet, setSheet] = useState("");
  useEffect(() => setSheet(""), [path]);
  const section = currentSection(path);
  const trigger = useRef(null);
  // Closed from the keyboard, the focus goes back to the button that opened it.
  const closeSearch = (reason) => {
    setSearching(false);
    if (reason === "keyboard") trigger.current?.focus();
  };
  // Another page closes the sheet.
  useEffect(() => setSearching(false), [path]);
  useEffect(() => {
    if (!searching) return;
    // The page behind the sheet does not scroll.
    const root = document.documentElement,
      before = root.style.overflow;
    root.style.overflow = "hidden";
    // The sheet only exists on a phone-wide screen (a phone turned sideways).
    const wide = window.matchMedia("(min-width: 641px)"),
      onWide = () => wide.matches && setSearching(false);
    wide.addEventListener("change", onWide);
    return () => {
      root.style.overflow = before;
      wide.removeEventListener("change", onWide);
    };
  }, [searching]);
  const tab = (item) => (
    <Link
      key={item.key}
      className="tabbar-item"
      aria-current={item.key === active ? "page" : undefined}
      href={href(item.path)}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
  return (
    <>
      <nav className="tabbar nav-a-only" aria-label="Navigation principale">
        {SECTIONS.filter((item) => item.key !== "calendar").map((item, index) => [
          index === 2 && (
            <button
              key="search"
              type="button"
              className="tabbar-item tabbar-search"
              aria-label="Rechercher un joueur, un club ou une compétition"
              aria-haspopup="dialog"
              aria-expanded={searching}
              onClick={() => {
                setSheet("");
                flushSync(() => setSearching(true));
              }}
            >
              <Icon name="search" />
              <span>Recherche</span>
            </button>
          ),
          item.items ? (
            <button
              key={item.key}
              type="button"
              className="tabbar-item"
              aria-current={section === item.key ? "page" : undefined}
              aria-expanded={sheet === item.key}
              onClick={() => setSheet((open) => (open === item.key ? "" : item.key))}
            >
              <NavIcon name={item.icon} size={21} />
              <span>{item.label}</span>
            </button>
          ) : (
            <Link
              key={item.key}
              className="tabbar-item"
              aria-current={section === item.key ? "page" : undefined}
              href={href(item.path)}
            >
              <NavIcon name={item.icon} size={21} />
              <span>{item.key === "overview" ? "Accueil" : item.label}</span>
            </Link>
          ),
        ])}
      </nav>
      <div className="nav-a-only">
        <PhoneSheet
          section={SECTIONS.find((item) => item.key === sheet)}
          path={path}
          href={href}
          onClose={() => setSheet("")}
        />
      </div>
      <nav className="tabbar nav-c-only" aria-label="Navigation principale">
        {tabs.slice(0, before).map(tab)}
        <button
          ref={trigger}
          type="button"
          className="tabbar-item tabbar-search"
          aria-label="Rechercher un joueur, un club ou une compétition"
          aria-haspopup="dialog"
          aria-expanded={searching}
          // Rendered within the tap, so the field's focus opens the keyboard.
          onClick={() => flushSync(() => setSearching(true))}
        >
          <Icon name="search" />
          <span>Recherche</span>
        </button>
        {tabs.slice(before).map(tab)}
      </nav>
      {searching && (
        <div
          className="search-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Recherche"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeSearch();
          }}
        >
          <GlobalSearch sheet onClose={closeSearch} />
        </div>
      )}
    </>
  );
}

"use client";
import React, { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import Icon from "./Icon.jsx";
import GlobalSearch from "./GlobalSearch.jsx";
import { SECTIONS, currentSection } from "./navigation.js";
import { NavIcon, PhoneSheet } from "./SiteNavigation.jsx";

/**
 * The phone navigation: a bar floating above the bottom of the screen, the
 * header's sections with the search in the middle (a section with several
 * pages opens them in a sheet above the bar); the calendar is a
 * button of the header, beside the theme (SiteHeader). styles.css
 * shows it under 640px, where the header's own links and search field are
 * hidden; wider screens keep the header. The search opens as a bar floating
 * over the page, which a touch beside it closes.
 */
export default function TabBar({ path, href }) {
  const [searching, setSearching] = useState(false);
  // The section whose pages are open in a sheet (VI-41).
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
  return (
    <>
      <nav className="tabbar" aria-label="Navigation principale">
        {SECTIONS.filter((item) => item.key !== "calendar").map((item, index) => [
          index === 2 && (
            <button
              key="search"
              ref={trigger}
              type="button"
              className="tabbar-item tabbar-search"
              aria-label="Rechercher un joueur, un club ou une compétition"
              aria-haspopup="dialog"
              aria-expanded={searching}
              // Rendered within the tap, so the field's focus opens the keyboard.
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
              <span>{item.short || item.label}</span>
            </Link>
          ),
        ])}
      </nav>
      <PhoneSheet
        section={SECTIONS.find((item) => item.key === sheet)}
        path={path}
        href={href}
        onClose={() => setSheet("")}
      />
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

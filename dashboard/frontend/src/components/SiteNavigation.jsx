"use client";
/* The site's navigation (VI-41): the header groups the pages under menus by
 * use, opened on hover; on phones the tab bar opens each section in a sheet. */
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Archive,
  CalendarDays,
  ChartColumn,
  ChevronDown,
  Flag,
  House,
  Medal,
  Shield,
  Trophy,
  Users,
} from "lucide-react";
import {
  SECTIONS,
  SHORTCUTS,
  competitionHref,
  currentSection,
  isCurrent,
} from "./navigation.js";

const ICONS = {
  home: House,
  trophy: Trophy,
  archive: Archive,
  shield: Shield,
  flag: Flag,
  players: Users,
  ranking: ChartColumn,
  medal: Medal,
  calendar: CalendarDays,
};
export function NavIcon({ name, size = 18 }) {
  const Symbol = ICONS[name] || Trophy;
  return (
    <Symbol
      className="nav-icon"
      size={size}
      strokeWidth={1.7}
      aria-hidden="true"
    />
  );
}

/** Closes on a click elsewhere, Escape, or another page. */
function useDismiss(open, close, path, ref) {
  useEffect(() => close(), [path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onPointer = (event) => {
      if (!ref.current?.contains(event.target)) close();
    };
    const onKey = (event) => event.key === "Escape" && close("keyboard");
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}

function MenuLink({ item, path, href, onPick, icon = true }) {
  return (
    <Link
      className="nav-menu-item"
      href={href(item.path)}
      aria-current={isCurrent(path, item) ? "page" : undefined}
      onClick={onPick}
    >
      {icon && <NavIcon name={item.icon || SECTION_ICON[item.key]} />}
      <span>{item.label}</span>
    </Link>
  );
}
const SECTION_ICON = Object.fromEntries(
  SECTIONS.flatMap((section) =>
    (section.items || [section]).map((item) => [item.key, section.icon]),
  ),
);

/** A section's pages, and for competitions the leading leagues. */
function MenuPanel({ section, path, href, onPick }) {
  const shortcuts = section.key === "competitions";
  return (
    <div className={`nav-menu-panel${shortcuts ? " is-wide" : ""}`}>
      <div className="nav-menu-list">
        {section.items.map((item) => (
          <MenuLink key={item.key} {...{ item, path, href, onPick }} />
        ))}
      </div>
      {shortcuts && (
        <div className="nav-menu-list nav-menu-shortcuts">
          {SHORTCUTS.map((league) => (
            <Link
              key={league.id}
              className="nav-menu-item"
              href={competitionHref(href, league.id)}
              onClick={onPick}
            >
              <span>{league.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Wide screens: the links and menus of the header. */
export function HeaderMenus({ path, href }) {
  const [open, setOpen] = useState("");
  const ref = useRef(null);
  const triggers = useRef({});
  const close = (reason) => {
    if (reason === "keyboard") triggers.current[open]?.focus();
    setOpen("");
  };
  useDismiss(Boolean(open), close, path, ref);
  // A mouse opens a section's menu by hovering it and closes it by leaving; the short delay
  // lets the pointer cross the gap to the panel. Touch and keyboard keep the click.
  const timer = useRef(null);
  const hovered = useRef("");
  useEffect(() => () => clearTimeout(timer.current), []);
  const hoverIn = (key) => (event) => {
    if (event.pointerType !== "mouse") return;
    clearTimeout(timer.current);
    hovered.current = key;
    setOpen(key);
  };
  const hoverOut = (event) => {
    if (event.pointerType !== "mouse") return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      hovered.current = "";
      setOpen("");
    }, 180);
  };
  // A click on a section the mouse already opened keeps it open.
  const toggle = (key) => () => {
    if (hovered.current === key && open === key) return;
    hovered.current = "";
    setOpen((current) => (current === key ? "" : key));
  };
  const active = currentSection(path);
  return (
    <nav className="main-nav" aria-label="Navigation principale" ref={ref}>
      {SECTIONS.map((section) =>
        section.items ? (
          <div
            key={section.key}
            className={`nav-menu${open === section.key ? " is-open" : ""}`}
            onPointerEnter={hoverIn(section.key)}
            onPointerLeave={hoverOut}
          >
            <button
              type="button"
              ref={(node) => (triggers.current[section.key] = node)}
              className="nav-button"
              aria-expanded={open === section.key}
              aria-current={active === section.key ? "true" : undefined}
              onClick={toggle(section.key)}
            >
              {section.label}
              <ChevronDown className="nav-caret" size={13} strokeWidth={2} aria-hidden="true" />
            </button>
            {open === section.key && (
              <MenuPanel
                section={section}
                path={path}
                href={href}
                onPick={() => setOpen("")}
              />
            )}
          </div>
        ) : (
          <Link
            key={section.key}
            className="nav-button"
            aria-current={active === section.key ? "page" : undefined}
            href={href(section.path)}
            onPointerEnter={(event) => {
              if (event.pointerType !== "mouse") return;
              clearTimeout(timer.current);
              hovered.current = "";
              setOpen("");
            }}
          >
            {section.short ? (
              // One of the two is shown (styles.css), and only that one is read out.
              <>
                <span className="nav-long">{section.label}</span>
                <span className="nav-short">{section.short}</span>
              </>
            ) : (
              section.label
            )}
          </Link>
        ),
      )}
    </nav>
  );
}

/** Phones: a tab opens its section's pages in a sheet above the tab bar. */
export function PhoneSheet({ section, path, href, onClose }) {
  if (!section) return null;
  return (
    <div
      className="nav-sheet-layer"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="nav-sheet" role="dialog" aria-modal="true" aria-label={section.label}>
        <div className="nav-menu-list">
          {(section.items || []).map((item) => (
            <MenuLink key={item.key} {...{ item, path, href }} onPick={onClose} />
          ))}
        </div>
        {section.key === "competitions" && (
          <div className="nav-sheet-rail">
            {SHORTCUTS.map((league) => (
              <Link
                key={league.id}
                className="nav-pill"
                href={competitionHref(href, league.id)}
                onClick={onClose}
              >
                {league.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

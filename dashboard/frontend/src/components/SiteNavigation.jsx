"use client";
/* The two navigations under review (VI-41). Both are rendered; the root
 * element's data-nav (« a » or « c ») picks the one shown (navigation.css), so
 * switching never re-renders the page and the first paint already has the
 * right one. */
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Archive,
  BookOpen,
  CalendarDays,
  ChartColumn,
  ChevronDown,
  Flag,
  House,
  Medal,
  Menu,
  PanelLeft,
  Shield,
  Trophy,
  Users,
  X,
} from "lucide-react";
import StatarenaLogo from "./StatarenaLogo.jsx";
import {
  ABOUT,
  NAV_KEY,
  SECTIONS,
  SHORTCUTS,
  SIDE_KEY,
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
  book: BookOpen,
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

/** A: a section's pages, and for competitions the leading leagues. */
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

/** A, wide screens: the links and menus of the header. */
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
    <nav className="main-nav nav-a" aria-label="Navigation principale" ref={ref}>
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
            {section.label}
          </Link>
        ),
      )}
      <div
        className={`nav-menu nav-about${open === "about" ? " is-open" : ""}`}
        onPointerEnter={hoverIn("about")}
        onPointerLeave={hoverOut}
      >
        <button
          type="button"
          ref={(node) => (triggers.current.about = node)}
          className="nav-button"
          aria-expanded={open === "about"}
          aria-current={active === "about" ? "true" : undefined}
          onClick={toggle("about")}
        >
          Plus
          <ChevronDown className="nav-caret" size={13} strokeWidth={2} aria-hidden="true" />
        </button>
        {open === "about" && (
          <div className="nav-menu-panel">
            <div className="nav-menu-list">
              {ABOUT.map((item) => (
                <MenuLink key={item.key} {...{ item, path, href }} onPick={() => setOpen("")} />
              ))}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}

/** A, phones: a tab opens its section's pages in a sheet above the tab bar. */
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

const toggleRail = () => {
  const root = document.documentElement;
  const next = root.dataset.side === "rail" ? "full" : "rail";
  root.dataset.side = next;
  try {
    localStorage.setItem(SIDE_KEY, next);
  } catch {}
};

/** C: every page in a sidebar on wide screens, a drawer on phones. */
export function SideNav({ path, href, open, onClose }) {
  const ref = useRef(null);
  useEffect(() => onClose(), [path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (event) => event.key === "Escape" && onClose("keyboard");
    document.addEventListener("keydown", onKey);
    const root = document.documentElement,
      before = root.style.overflow;
    root.style.overflow = "hidden";
    ref.current?.querySelector("a")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      root.style.overflow = before;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = currentSection(path);
  const entry = (item, icon, sub = false) => (
    <Link
      key={item.key}
      className={`side-nav-item${sub ? " is-sub" : ""}`}
      href={href(item.path)}
      aria-current={isCurrent(path, item) ? "page" : undefined}
      title={item.label}
    >
      {!sub && <NavIcon name={icon} />}
      <span>{item.label}</span>
    </Link>
  );
  return (
    <>
      <div
        className={`side-nav-veil${open ? " is-open" : ""}`}
        onPointerDown={() => onClose()}
        aria-hidden="true"
      />
      <nav
        ref={ref}
        className={`side-nav${open ? " is-open" : ""}`}
        aria-label="Navigation principale"
      >
        <div className="side-nav-head">
          <Link className="brand" aria-label="Vega Intelligence, vue d’ensemble" href={href("/")}>
            <StatarenaLogo layout="symbol" className="brand-logo" width={32} height={32} />
          </Link>
          <button type="button" className="side-nav-fold" aria-label="Replier ou déplier le menu" onClick={toggleRail}>
            <PanelLeft size={18} strokeWidth={1.7} aria-hidden="true" />
          </button>
          <button type="button" className="side-nav-close" aria-label="Fermer le menu" onClick={() => onClose("keyboard")}>
            <X size={20} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
        {SECTIONS.map((section) =>
          section.items ? (
            <div
              key={section.key}
              className={`side-nav-group${active === section.key ? " is-active" : ""}`}
            >
              {section.items.map((item, index) =>
                index === 0
                  ? entry({ ...item, label: section.key === "teams" ? item.label : section.label }, section.icon)
                  : section.key === "teams"
                    ? entry(item, item.icon)
                    : entry(item, item.icon, true),
              )}
            </div>
          ) : (
            entry(section, section.icon)
          ),
        )}
        <div className="side-nav-end">{ABOUT.map((item) => entry(item, item.icon))}</div>
      </nav>
    </>
  );
}

/** Phones, C: the header's button that opens the drawer. */
export function DrawerButton({ open, onOpen }) {
  return (
    <button
      type="button"
      className="topbar-menu nav-c-only"
      aria-label="Ouvrir le menu"
      aria-expanded={open}
      onClick={onOpen}
    >
      <Menu size={21} strokeWidth={1.7} aria-hidden="true" />
    </button>
  );
}

/** Preview only: switches between the two layouts. */
export function NavSwitch() {
  const [nav, setNav] = useState("a");
  useEffect(() => setNav(document.documentElement.dataset.nav || "a"), []);
  const choose = (next) => {
    document.documentElement.dataset.nav = next;
    try {
      localStorage.setItem(NAV_KEY, next);
    } catch {}
    setNav(next);
  };
  return (
    <div className="nav-switch" role="group" aria-label="Navigation à essayer">
      {["a", "b", "c"].map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={nav === option}
          onClick={() => choose(option)}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

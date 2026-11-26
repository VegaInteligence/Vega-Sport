"use client";
/* The site's navigation (VI-41): the header groups the pages under menus by
 * use, opened on hover; on phones the tab bar opens each section in a sheet. */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Media } from "./UI.jsx";
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

/** The six leading leagues as tiles: the logo, the name (§ 76). */
function LeagueTiles({ href, onPick }) {
  return (
    <div className="nav-league-grid">
      {SHORTCUTS.map((league) => (
        <Link
          key={league.id}
          className="nav-menu-item nav-league"
          data-league={league.id}
          href={competitionHref(href, league.id)}
          onClick={onPick}
        >
          <Media url={league.logo} name={league.label} kind="club" size={32} className="crest nav-league-logo" />
          <span>{league.label}</span>
        </Link>
      ))}
    </div>
  );
}

/** A section's pages: for competitions the pages in pills beside the leagues in tiles, for the
 * others large tiles (piste 1 of the menus' mock-up, § 76). */
function MenuPanel({ section, path, href, onPick }) {
  if (section.key === "competitions")
    return (
      <div className="nav-menu-panel is-wide">
        <div className="nav-menu-list">
          <p className="nav-menu-cap">Pages</p>
          {section.items.map((item) => (
            <MenuLink key={item.key} {...{ item, path, href, onPick }} />
          ))}
        </div>
        <div>
          <p className="nav-menu-cap">Ligues</p>
          <LeagueTiles href={href} onPick={onPick} />
        </div>
      </div>
    );
  return (
    <div className="nav-menu-panel is-tiles" style={{ "--tiles": section.items.length }}>
      {section.items.map((item) => (
        <Link
          key={item.key}
          className="nav-menu-item nav-tile"
          href={href(item.path)}
          aria-current={isCurrent(path, item) ? "page" : undefined}
          onClick={onPick}
        >
          <NavIcon name={item.icon || SECTION_ICON[item.key]} size={24} />
          <span>{item.label}</span>
        </Link>
      ))}
    </div>
  );
}

/** Wide screens: the sections in one track; a veil glides behind the one under the mouse, and one
 * panel under the track holds the open section's menu, sliding from one section to the next
 * (piste B of the bar, piste 1 of its menus; § 76). */
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

  // The veil under the mouse: the hovered section's place in the track.
  const [glide, setGlide] = useState(null);
  const glideTo = (key) => (event) => {
    if (event.pointerType !== "mouse") return;
    const node = triggers.current[key], nav = ref.current;
    if (!node || !nav) return;
    const box = node.getBoundingClientRect(), navBox = nav.getBoundingClientRect();
    setGlide({ left: box.left - navBox.left, width: box.width, on: node.getAttribute("aria-current") == null });
  };

  // The panel: its content measured, then placed under the open section, within the window.
  const panelRef = useRef(null);
  const innerRef = useRef(null);
  const [frame, setFrame] = useState(null);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    const nav = ref.current, inner = innerRef.current, trigger = triggers.current[open];
    if (!nav || !inner || !trigger) return;
    const width = inner.offsetWidth, height = inner.offsetHeight;
    const navBox = nav.getBoundingClientRect(), box = trigger.getBoundingClientRect();
    const middle = box.left + box.width / 2;
    const left = Math.max(12, Math.min(middle - width / 2, window.innerWidth - width - 12)) - navBox.left;
    setFrame({ left, width, height, slide: wasOpen.current });
    wasOpen.current = true;
  }, [open]);

  // The panel sits after the track, so the Tab key is led from a section into its open menu and
  // from the menu's last link on to the next section, as when the menu followed its button.
  const links = () => [...(panelRef.current?.querySelectorAll("a[href]") || [])];
  const onTriggerKey = (key) => (event) => {
    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey && open === key)) {
      event.preventDefault();
      if (open !== key) setOpen(key);
      requestAnimationFrame(() => links()[0]?.focus());
    }
  };
  const onPanelKey = (event) => {
    if (event.key !== "Tab" || !open) return;
    const all = links(), keys = SECTIONS.map((item) => item.key);
    if (event.shiftKey && event.target === all[0]) {
      event.preventDefault();
      triggers.current[open]?.focus();
    } else if (!event.shiftKey && event.target === all[all.length - 1]) {
      const next = triggers.current[keys[keys.indexOf(open) + 1]];
      if (!next) return;
      event.preventDefault();
      setOpen("");
      next.focus();
    }
  };

  const active = currentSection(path);
  // The last menu opened stays drawn while the panel fades out.
  const shown = useRef("");
  if (open) shown.current = open;
  const section = SECTIONS.find((item) => item.key === shown.current && item.items);
  return (
    <nav
      className={`main-nav${glide?.on ? " is-gliding" : ""}`}
      aria-label="Navigation principale"
      ref={ref}
      onPointerLeave={(event) => event.pointerType === "mouse" && setGlide((g) => g && { ...g, on: false })}
    >
      <span
        className="nav-glide"
        aria-hidden="true"
        style={glide ? { width: glide.width, transform: `translateX(${glide.left}px)`, opacity: glide.on ? 1 : 0 } : undefined}
      />
      {SECTIONS.map((section) =>
        section.items ? (
          <div
            key={section.key}
            className={`nav-menu${open === section.key ? " is-open" : ""}`}
            onPointerEnter={(event) => {
              glideTo(section.key)(event);
              hoverIn(section.key)(event);
            }}
            onPointerLeave={hoverOut}
          >
            <button
              type="button"
              ref={(node) => (triggers.current[section.key] = node)}
              className="nav-button"
              aria-expanded={open === section.key}
              aria-current={active === section.key ? "true" : undefined}
              onClick={toggle(section.key)}
              onKeyDown={onTriggerKey(section.key)}
              aria-controls="nav-panel"
            >
              <NavIcon name={section.icon} size={17} />
              <span className="nav-label">{section.label}</span>
              <ChevronDown className="nav-caret" size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <Link
            key={section.key}
            ref={(node) => (triggers.current[section.key] = node)}
            className="nav-button"
            aria-current={active === section.key ? "page" : undefined}
            href={href(section.path)}
            onPointerEnter={(event) => {
              glideTo(section.key)(event);
              if (event.pointerType !== "mouse") return;
              clearTimeout(timer.current);
              hovered.current = "";
              setOpen("");
            }}
          >
            <NavIcon name={section.icon} size={17} />
            <span className="nav-label">
              {section.short ? (
                // One of the two is shown (styles.css), and only that one is read out.
                <>
                  <span className="nav-long">{section.label}</span>
                  <span className="nav-short">{section.short}</span>
                </>
              ) : (
                section.label
              )}
            </span>
          </Link>
        ),
      )}
      <div
        ref={panelRef}
        id="nav-panel"
        onKeyDown={onPanelKey}
        className={`nav-panel${open && frame ? " is-open" : ""}${frame?.slide ? " is-sliding" : ""}`}
        style={frame ? { left: frame.left, width: frame.width, height: frame.height } : undefined}
        onPointerEnter={(event) => event.pointerType === "mouse" && clearTimeout(timer.current)}
        onPointerLeave={hoverOut}
      >
        {section && (
          <div className="nav-panel-inner" ref={innerRef} key={section.key}>
            <MenuPanel section={section} path={path} href={href} onPick={() => setOpen("")} />
          </div>
        )}
      </div>
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
        {section.key === "competitions" && <LeagueTiles href={href} onPick={onClose} />}
        <div className={`nav-menu-list${section.key === "competitions" ? " nav-sheet-pages" : ""}`}>
          {(section.items || []).map((item) => (
            <MenuLink key={item.key} {...{ item, path, href }} onPick={onClose} />
          ))}
        </div>
      </div>
    </div>
  );
}

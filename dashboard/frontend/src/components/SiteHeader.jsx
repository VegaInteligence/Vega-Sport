import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import ThemeToggle from "./ThemeToggle.jsx";
import AccountEntry from "./AccountEntry.jsx";
import Icon from "./Icon.jsx";
import StatarenaLogo from "./StatarenaLogo.jsx";
import GlobalSearch from "./GlobalSearch.jsx";
import { HeaderMenus } from "./SiteNavigation.jsx";
const bare = (value = "") => value.replace(/\/+$/, "") || "/";
/** The calendar and the pages that belong to it (a match is one of them). */
const CALENDAR = ["/matchs", "/calendrier"];
/** The search opened beside the track (§ 76.1): the field takes 380 px from its icon leftwards; where that would
 *  cover the track, the track slides left (down to 16 px after the logo), then the field narrows (to 220 px), then
 *  the track shows its sections' symbols alone. Nothing is hidden. Returns the header's class and style. */
const FIELD = 380, FIELD_MIN = 220, GAP = 12;
function useSearchRoom(header) {
  const [room, setRoom] = useState(null);
  const compact = Boolean(room?.compact);
  const measure = useRef(() => {});
  measure.current = () => {
    const top = header.current;
    const search = top?.querySelector(".global-search"), nav = top?.querySelector(".main-nav"), brand = top?.querySelector(".brand");
    if (!search || !nav || !brand) return;
    const engaged = search.classList.contains("is-engaged") || search.contains(document.activeElement);
    if (!engaged || !window.matchMedia("(min-width: 641px)").matches) {
      setRoom((current) => (current ? null : current));
      return;
    }
    // The track's own place, without its slide (read while it moves: the box and the transform of the same moment).
    const box = nav.getBoundingClientRect();
    const moved = new DOMMatrixReadOnly(getComputedStyle(nav).transform === "none" ? undefined : getComputedStyle(nav).transform).m41;
    const left = box.left - moved, right = box.right - moved;
    const end = search.getBoundingClientRect().right;
    const most = Math.max(0, left - (brand.getBoundingClientRect().right + 16));
    const need = right + GAP + FIELD - end;
    let next;
    if (need <= most) next = { shift: Math.max(0, need), width: FIELD, compact };
    else {
      const width = Math.round(end - (right - most) - GAP);
      if (width < FIELD_MIN && !compact) next = { shift: 0, width: FIELD, compact: true };
      else next = { shift: most, width: Math.max(width, Math.min(FIELD_MIN, end - (brand.getBoundingClientRect().right + 16))), compact };
    }
    setRoom((current) =>
      current && current.shift === next.shift && current.width === next.width && current.compact === next.compact ? current : next,
    );
  };
  useEffect(() => {
    const search = header.current?.querySelector(".global-search");
    if (!search) return undefined;
    const run = () => measure.current();
    const later = () => requestAnimationFrame(run);
    const watch = new MutationObserver(run);
    watch.observe(search, { attributes: true, attributeFilter: ["class"] });
    search.addEventListener("focusin", run);
    search.addEventListener("focusout", later);
    window.addEventListener("resize", run);
    return () => {
      watch.disconnect();
      search.removeEventListener("focusin", run);
      search.removeEventListener("focusout", later);
      window.removeEventListener("resize", run);
    };
  }, [header]);
  // The symbols alone make the track narrower: measured again once drawn.
  useLayoutEffect(() => measure.current(), [compact]);
  return {
    className: `topbar${room ? " is-searching" : ""}${compact ? " is-track-compact" : ""}`,
    style: room ? { "--track-shift": `${-room.shift}px`, "--search-open": `${room.width}px` } : undefined,
  };
}

/* The pages are grouped under menus by use (VI-41, SiteNavigation). */
export default function SiteHeader({ path, href }) {
  const onCalendar = CALENDAR.includes(bare(path));
  const spinning = useRef(false);
  const header = useRef(null);
  const room = useSearchRoom(header);

  async function openHome(event) {
    if (
      event.defaultPrevented || event.button !== 0 || event.metaKey ||
      event.ctrlKey || event.shiftKey || event.altKey
    ) return;
    const link = event.currentTarget;
    const mark = link.querySelector(".brand-mark");
    if (!mark?.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    event.preventDefault();
    if (spinning.current) return;
    spinning.current = true;
    const destination = link.href;
    const sourcePath = window.location.pathname;
    const turn = mark.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      { duration: 360, easing: "cubic-bezier(.24,.06,.35,1)" },
    );
    await turn.finished.catch(() => {});
    spinning.current = false;
    if (window.location.pathname === sourcePath) window.location.assign(destination);
  }

  return (
    <header className={room.className} style={room.style} ref={header}>
      <a
        className="brand"
        aria-label="Vega Sport, vue d’ensemble"
        href={href("/")}
        onClick={openHome}
      >
        {/* The asterisk alone, at every width (the wordmark is the footer's). */}
        <StatarenaLogo
          layout="symbol"
          className="brand-mark"
          width={25}
          height={28}
        />
      </a>
      <HeaderMenus path={path} href={href} />
      <div className="topbar-actions">
        <GlobalSearch />
        {/* A phone's way to the calendar, which its tab bar leaves out (phone.css). */}
        <Link
          className="topbar-calendar"
          aria-label="Calendrier"
          aria-current={onCalendar ? "page" : undefined}
          href={href("/matchs/")}
        >
          <Icon name="calendar" />
        </Link>
        <ThemeToggle />
        <AccountEntry />
      </div>
    </header>
  );
}

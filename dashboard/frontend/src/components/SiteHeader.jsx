import React, { useRef } from "react";
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
/* The pages are grouped under menus by use (VI-41, SiteNavigation). */
export default function SiteHeader({ path, href }) {
  const onCalendar = CALENDAR.includes(bare(path));
  const spinning = useRef(false);

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
    <header className="topbar">
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

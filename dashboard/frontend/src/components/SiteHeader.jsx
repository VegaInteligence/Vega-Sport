import React from "react";
import Link from "next/link";
import ThemeToggle from "./ThemeToggle.jsx";
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
  return (
    <header className="topbar">
      <Link
        className="brand"
        aria-label="Vega Sport, vue d’ensemble"
        href={href("/")}
      >
        {/* The wordmark; under 1024px the mark « V. » (styles.css shows one of the two). */}
        <StatarenaLogo className="brand-logo" width={127} height={28} />
        <StatarenaLogo
          layout="symbol"
          className="brand-mark"
          width={32}
          height={30}
        />
      </Link>
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
      </div>
    </header>
  );
}

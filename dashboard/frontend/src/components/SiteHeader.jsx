import React from "react";
import Link from "next/link";
import ThemeToggle from "./ThemeToggle.jsx";
import Icon from "./Icon.jsx";
import StatarenaLogo from "./StatarenaLogo.jsx";
import GlobalSearch from "./GlobalSearch.jsx";
import { pages } from "../../../shared/pages.js";
const navigation = pages
  .filter((page) => page.navigation !== false)
  .map((page) => [page.path, page.title]);
const bare = (value = "") => value.replace(/\/+$/, "") || "/";
/** The calendar and the pages that belong to it (a match is one of them). */
const CALENDAR = ["/matchs", "/calendrier"];
export default function SiteHeader({ path, href }) {
  const onCalendar = CALENDAR.includes(bare(path));
  return (
    <header className="topbar">
      <Link
        className="brand"
        aria-label="Vega Intelligence, vue d’ensemble"
        href={href("/")}
      >
        <StatarenaLogo
          layout="symbol"
          className="brand-logo"
          width={32}
          height={32}
        />
      </Link>
      <nav className="main-nav" aria-label="Navigation principale">
        {navigation.map(([url, label]) => (
          <Link
            key={url}
            className="nav-button"
            aria-current={path === url ? "page" : undefined}
            href={href(url)}
          >
            {label}
          </Link>
        ))}
      </nav>
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

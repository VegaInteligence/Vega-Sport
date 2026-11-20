"use client";
import React, { useState } from "react";
import Link from "next/link";
import ThemeToggle from "./ThemeToggle.jsx";
import Icon from "./Icon.jsx";
import StatarenaLogo from "./StatarenaLogo.jsx";
import GlobalSearch from "./GlobalSearch.jsx";
import {
  DrawerButton,
  HeaderMenus,
  NavSwitch,
  SideNav,
} from "./SiteNavigation.jsx";
const bare = (value = "") => value.replace(/\/+$/, "") || "/";
/** The calendar and the pages that belong to it (a match is one of them). */
const CALENDAR = ["/matchs", "/calendrier"];
/* Navigations under review (VI-41): « A » groups the pages under menus in this
 * header, « B » keeps them and puts the page's filters in a sidebar
 * (SideFilters), « C » moves the pages to a sidebar (SideNav). The root
 * element's data-nav picks one (navigation.css). */
export default function SiteHeader({ path, href }) {
  const onCalendar = CALENDAR.includes(bare(path));
  const [drawer, setDrawer] = useState(false);
  return (
    <>
      <header className="topbar">
        <DrawerButton open={drawer} onOpen={() => setDrawer(true)} />
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
          <div className="topbar-tools">
            <NavSwitch />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <SideNav
        path={path}
        href={href}
        open={drawer}
        onClose={() => setDrawer(false)}
      />
    </>
  );
}

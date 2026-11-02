import React from "react";
import Link from "next/link";
import ThemeToggle from "./ThemeToggle.jsx";
import StatarenaLogo from "./StatarenaLogo.jsx";
import { pages } from "../../../shared/pages.js";
const navigation = pages
  .filter((page) => page.navigation !== false)
  .map((page) => [page.path, page.title]);
export default function SiteHeader({ path, href }) {
  return (
    <header className="topbar">
      <Link
        className="brand"
        aria-label="STATARENA, vue d’ensemble"
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
        <ThemeToggle />
      </div>
    </header>
  );
}

import React from "react";
import Link from "next/link";
import { pages } from "../../../shared/pages.js";
const navigation = pages
  .filter((page) => page.navigation !== false)
  .map((page) => [page.path, page.title]);
export default function SiteHeader({ path, href, configured = false }) {
  return (
    <header className="topbar">
      <Link
        className="brand"
        aria-label="Orion, vue d’ensemble"
        href={href("/")}
      >
        <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
          <rect width="40" height="40" rx="11" fill="currentColor" />
          <path
            d="M12 25 20 11l8 14M15.5 19h9"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="20" cy="28" r="2" />
        </svg>
        <span className="brand-word">
          orion<span className="brand-period">.</span>
        </span>
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
      <div className="topbar-meta">
        <span className="status-dot" />
        {configured ? "PitchAPI configuré" : "Données collectées"}
      </div>
    </header>
  );
}

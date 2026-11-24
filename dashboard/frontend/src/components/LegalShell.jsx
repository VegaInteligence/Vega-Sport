"use client";
// The site's frame for the static pages (route-data.js STATIC_PAGES): header, footer and the phone's tab bar,
// as the loading page draws them, without the data providers. Links are plain paths.
import Link from "next/link";
import SiteHeader from "./SiteHeader.jsx";
import SiteFooter from "./SiteFooter.jsx";
import TabBar from "./TabBar.jsx";

const plainHref = (page) => page;

export default function LegalShell({ path, children }) {
  return (
    <>
      <Link className="skip-link" href="#main">
        Aller au contenu
      </Link>
      <div className="app-shell">
        <SiteHeader path={path} href={plainHref} />
        <main id="main" className="workspace legal-workspace">
          {children}
        </main>
        <SiteFooter href={plainHref} path={path} />
        <TabBar path={path} href={plainHref} />
      </div>
    </>
  );
}

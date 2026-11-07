import React from "react";
import { usePathname } from "next/navigation";
import { pages } from "../../../shared/pages.js";
import SiteHeader from "./SiteHeader.jsx";
import PageLoader from "./PageLoader.jsx";
export default function LoadingPage({ href }) {
  const path = usePathname();
  const page = pages.find(
    (page) => page.path.replace(/\/$/, "") === path.replace(/\/$/, ""),
  );
  return (
    <div className="app-shell">
      <SiteHeader path={path} href={href} />
      <main
        id="main"
        className={`workspace${page?.path === "/classement-joueurs/" ? " ranking-page" : ""}`}
        aria-busy="true"
      >
        <PageLoader />
      </main>
    </div>
  );
}

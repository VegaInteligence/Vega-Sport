import React from "react";
import { usePathname } from "next/navigation";
import { pages } from "../../../shared/pages.js";
import SiteHeader from "./SiteHeader.jsx";
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
        <div className="page-heading">
          <h1 className="page-title">{page?.title || "STATARENA"}</h1>
        </div>
        <div className="season-loading" role="status">
          <span>Préparation de la page…</span>
        </div>
      </main>
    </div>
  );
}

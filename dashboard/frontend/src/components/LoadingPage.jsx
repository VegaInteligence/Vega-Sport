import React from "react";
import { preload } from "react-dom";
import { apiUrl } from "../data-url.js";
import { usePathname } from "next/navigation";
import { pages } from "../../../shared/pages.js";
import SiteHeader from "./SiteHeader.jsx";
import PageLoader from "./PageLoader.jsx";
export default function LoadingPage({ href }) {
  const path = usePathname();
  // The home server response already contains its manifest. Other routes still
  // start this request while their client code is being downloaded.
  if (path !== "/")
    preload(apiUrl("/api/dashboard/manifest"), {
      as: "fetch",
      crossOrigin: "anonymous",
    });
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

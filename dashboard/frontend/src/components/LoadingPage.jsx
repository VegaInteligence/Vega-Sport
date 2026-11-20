import React, { useLayoutEffect } from "react";
import { preload } from "react-dom";
import { apiUrl } from "../data-url.js";
import { usePathname } from "next/navigation";
import { pages } from "../../../shared/pages.js";
import SiteHeader from "./SiteHeader.jsx";
import SiteFooter from "./SiteFooter.jsx";
import TabBar from "./TabBar.jsx";
import PageLoader from "./PageLoader.jsx";
import ClubSkeleton from "./ClubSkeleton.jsx";
export default function LoadingPage({ href }) {
  const path = usePathname();
  // The home server response already contains its manifest. Other routes still
  // start this request while their client code is being downloaded.
  if (path !== "/")
    preload(apiUrl("/api/dashboard/manifest"), {
      as: "fetch",
      crossOrigin: "anonymous",
    });
  const clubs = path.replace(/\/$/, "") === "/clubs";
  // Keep the head script's flag right after a client-side navigation too.
  useLayoutEffect(() => {
    if (clubs)
      document.documentElement.toggleAttribute(
        "data-club-profile",
        new URLSearchParams(window.location.search).has("id"),
      );
  }, [clubs]);
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
        {clubs ? (
          <>
            <div className="club-route-skeleton">
              <ClubSkeleton />
            </div>
            <div className="club-route-logo">
              <PageLoader />
            </div>
          </>
        ) : (
          <PageLoader />
        )}
      </main>
      <SiteFooter href={href} path={path} />
      <TabBar path={path} href={href} />
    </div>
  );
}

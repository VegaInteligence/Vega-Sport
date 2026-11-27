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
import CompetitionSkeleton from "./CompetitionSkeleton.jsx";
import HomeSkeleton from "./HomeSkeleton.jsx";
import MatchSkeleton from "./MatchSkeleton.jsx";
import NationSkeleton from "./NationSkeleton.jsx";
import { routeSkeleton } from "../services/route-skeleton.js";
/** One skeleton per kind of services/route-skeleton.js. */
const SKELETONS = {
  club: <ClubSkeleton />,
  competition: <CompetitionSkeleton />,
  home: <HomeSkeleton />,
  match: <MatchSkeleton />,
  nation: <NationSkeleton />,
};
export default function LoadingPage({ href }) {
  const path = usePathname();
  // The home server response already contains its manifest. Other routes still
  // start this request while their client code is being downloaded.
  if (path !== "/")
    preload(apiUrl("/api/dashboard/manifest"), {
      as: "fetch",
      crossOrigin: "anonymous",
    });
  // The route's skeleton is rendered beside the logo; the flag shows one of them.
  const skeleton = SKELETONS[routeSkeleton(path, "id")];
  // Keep the head script's flag right after a client-side navigation too.
  useLayoutEffect(() => {
    const kind = routeSkeleton(path, window.location.search);
    if (kind)
      document.documentElement.setAttribute("data-route-skeleton", kind);
    else document.documentElement.removeAttribute("data-route-skeleton");
  }, [path]);
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
        {skeleton ? (
          <>
            <div className="route-skeleton">{skeleton}</div>
            <div className="route-logo">
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

"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { FootballProvider } from "../src/hooks/FootballContext.jsx";
import { ResearchProvider } from "../src/hooks/ResearchContext.jsx";
import { routeExists, routeNeedsSeason } from "../src/services/route-data.js";
import ResourceBootstrap from "../src/components/ResourceBootstrap.jsx";
import { MediaProvider } from "../src/components/MediaContext.jsx";
export default function Providers({ children, bootstrap, home = false }) {
  const pathname = usePathname();
  // The home server component supplies its own request-scoped initial data.
  if (pathname === "/" && !home) return children;
  // An unmatched URL renders the 404 page. The data providers show their
  // children only once a season has loaded, so they are left out there.
  if (!routeExists(pathname)) return children;
  return (
    <DataProviders pathname={pathname} bootstrap={bootstrap}>
      {children}
    </DataProviders>
  );
}
function DataProviders({ children, pathname, bootstrap }) {
  const params = useSearchParams();
  return (
    <ResourceBootstrap bootstrap={bootstrap}>
      <MediaProvider media={bootstrap?.media}>
        <FootballProvider
          loadData={routeNeedsSeason(pathname, params)}
          initialState={bootstrap?.state}
        >
          <ResearchProvider initialState={bootstrap?.state}>
            {children}
          </ResearchProvider>
        </FootballProvider>
      </MediaProvider>
    </ResourceBootstrap>
  );
}

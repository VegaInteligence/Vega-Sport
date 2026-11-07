"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { FootballProvider } from "../src/hooks/FootballContext.jsx";
import { ResearchProvider } from "../src/hooks/ResearchContext.jsx";
import { routeNeedsSeason } from "../src/services/route-data.js";
export default function Providers({ children }) {
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <FootballProvider loadData={routeNeedsSeason(pathname, params)}>
      <ResearchProvider>{children}</ResearchProvider>
    </FootballProvider>
  );
}

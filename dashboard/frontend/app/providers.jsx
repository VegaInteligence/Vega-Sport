"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { FootballProvider } from "../src/hooks/FootballContext.jsx";
import { ResearchProvider } from "../src/hooks/ResearchContext.jsx";
export default function Providers({ children }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const playerMatches = /^\/joueurs\/matchs\/?$/.test(pathname);
  const standingsOnly =
    pathname.startsWith("/clubs") &&
    Boolean(
      params.get("clubLeague") && params.get("clubTeam") && !params.get("id"),
    );
  return (
    <FootballProvider
      loadData={
        !pathname.startsWith("/classement-joueurs") &&
        !standingsOnly &&
        !playerMatches
      }
    >
      <ResearchProvider>{children}</ResearchProvider>
    </FootballProvider>
  );
}

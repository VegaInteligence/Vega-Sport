"use client";
import { usePathname } from "next/navigation";
import { FootballProvider } from "../src/hooks/FootballContext.jsx";
import { ResearchProvider } from "../src/hooks/ResearchContext.jsx";
export default function Providers({ children }) {
  const pathname = usePathname();
  return (
    <FootballProvider loadData={!pathname.startsWith("/classement-joueurs")}>
      <ResearchProvider>{children}</ResearchProvider>
    </FootballProvider>
  );
}

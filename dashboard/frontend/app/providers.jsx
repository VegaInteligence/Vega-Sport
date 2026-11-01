"use client";
import { usePathname } from "next/navigation";
import { FootballProvider } from "../src/hooks/FootballContext.jsx";
export default function Providers({ children }) {
  const pathname = usePathname();
  return (
    <FootballProvider
      loadData={
        !pathname.startsWith("/classements") &&
        !pathname.startsWith("/reglages")
      }
    >
      {children}
    </FootballProvider>
  );
}

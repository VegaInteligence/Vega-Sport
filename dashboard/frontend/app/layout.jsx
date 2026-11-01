import { Suspense } from "react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import Providers from "./providers.jsx";
import "../src/styles.css";
import "../src/analysis.css";
export const metadata = {
  title: { default: "Orion — Football Ranking", template: "%s — Orion" },
  description:
    "Performances, matchs et classements du football. Données collectées, métriques observées et historiques FIFA et UEFA.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>
        <Suspense
          fallback={
            <div className="loading-state" role="status">
              Chargement…
            </div>
          }
        >
          <Providers>{children}</Providers>
        </Suspense>
        <SpeedInsights />
      </body>
    </html>
  );
}

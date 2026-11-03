import { Suspense } from "react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import Providers from "./providers.jsx";
import ShellFallback from "./shell-fallback.jsx";
import { dataUrl } from "../src/data-url.js";
import "../src/brand-tokens.css";
import "../src/fonts.css";
import "../src/theme.css";
import "../src/styles.css";
import "../src/analysis.css";
import "../src/season-profile.css";
import "../src/competition-selector.css";
import "../src/openfootball-history.css";
import "../src/research.css";
import "../src/player-profile-redesign.css";
import "../src/home.css";
const siteUrl = "https://statarena-analytics.vercel.app";
const description =
  "Statistiques de football, analyses de matchs, profils de joueurs et classement du Ballon d’Or.";
export const metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "STATARENA",
  title: {
    default: "STATARENA — Football Analytics",
    template: "%s — STATARENA",
  },
  description,
  manifest: "/site.webmanifest?brand=green",
  icons: {
    icon: [
      { url: "/favicon.svg?brand=green", type: "image/svg+xml" },
      { url: "/favicon.ico?brand=green", sizes: "any" },
      {
        url: "/branding/green/icons/favicon-32.png",
        type: "image/png",
        sizes: "32x32",
      },
    ],
    apple: "/apple-touch-icon.png?brand=green",
  },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "STATARENA",
    title: "STATARENA — Football Analytics",
    description,
    images: [
      {
        url: "/og-image.png?brand=green",
        width: 1200,
        height: 630,
        alt: "STATARENA",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "STATARENA — Football Analytics",
    description,
    images: ["/og-image.png?brand=green"],
  },
};
export const viewport = { themeColor: "#0E0F12", colorScheme: "dark light" };
// Start the downloads every page needs while the scripts are still loading:
// the manifest, then the Top 7 + UEFA chunks of the default season, which
// both scopes display first.
const manifestUrl = dataUrl("dashboard-manifest.json");
export default function RootLayout({ children }) {
  return (
    <html lang="fr" data-theme="dark" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/inter-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href={manifestUrl}
          as="fetch"
          crossOrigin="anonymous"
        />
        <script
          id="statarena-theme"
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("statarena.theme")==="light"?"light":"dark";document.documentElement.dataset.theme=t;document.querySelector('meta[name="theme-color"]')?.setAttribute("content",t==="light"?"#F6F8FB":"#0E0F12")}catch{}`,
          }}
        />
      </head>
      <body>
        <Suspense fallback={<ShellFallback />}>
          <Providers>{children}</Providers>
        </Suspense>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}

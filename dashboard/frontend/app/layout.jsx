import { Suspense } from "react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import Providers from "./providers.jsx";
import ShellFallback from "./shell-fallback.jsx";
import { homeBootstrapGuardScript } from "../src/services/home-bootstrap-preferences.js";
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
const faviconVersion = 2;
const description = "Vega Intelligence : statistiques de football, analyses de matchs, joueurs et compétitions.";
export const metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Vega Intelligence",
  title: { default: "Vega Intelligence — Sports Analytics", template: "%s — Vega Intelligence" },
  description,
  manifest: "/site.webmanifest",
  icons: {
    icon: [{ url: `/branding/vega/favicon.svg?v=${faviconVersion}`, type: "image/svg+xml", sizes: "any" }],
    apple: [{ url: "/api/vega-image?kind=icon&size=180", sizes: "180x180" }],
  },
  openGraph: { type: "website", locale: "fr_FR", siteName: "Vega Intelligence",
    title: "Vega Intelligence — Sports Analytics", description,
    images: [{ url: "/api/vega-image?kind=og", width: 1200, height: 630, alt: "Vega Intelligence" }] },
  twitter: { card: "summary_large_image", title: "Vega Intelligence", description, images: ["/api/vega-image?kind=og"] },
};
export const viewport = { themeColor: "#0E0F12", colorScheme: "dark light" };
export default function RootLayout({ children }) {
  return (
    <html lang="fr" data-theme="dark" suppressHydrationWarning>
      <head>
        <script id="vega-home-scope" dangerouslySetInnerHTML={{ __html: homeBootstrapGuardScript }} />
        <link
          rel="preload"
          href="/fonts/inter-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script
          id="vega-theme"
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("statarena.theme")==="light"?"light":"dark";document.documentElement.dataset.theme=t;document.querySelector('meta[name="theme-color"]')?.setAttribute("content",t==="light"?"#F6F8FB":"#0E0F12");window.__vegaSetFavicon=function(theme){document.querySelectorAll('link[rel="icon"]').forEach(function(link){if(link.href.includes("/branding/vega/"))link.href=theme==="light"?"/branding/vega/icon-light.svg?v=${faviconVersion}":"/branding/vega/icon-dark.svg?v=${faviconVersion}"})};document.addEventListener("DOMContentLoaded",function(){window.__vegaSetFavicon(t)},{once:true})}catch{}`,
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

import { Suspense } from "react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import Providers from "./providers.jsx";
import ShellFallback from "./shell-fallback.jsx";
import { homeBootstrapGuardScript } from "../src/services/home-bootstrap-preferences.js";
import { apiUrl } from "../src/data-url.js";
import { routeSkeletonScript } from "../src/services/route-skeleton.js";
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
import "../src/phone.css";
import "../src/navigation.css";
const siteUrl = "https://vegasport.vercel.app";
// Raised with every new drawing of the icon, so no browser keeps the old one.
const faviconVersion = 3;
// The tab's icon follows the site's theme, which only the browser knows: the theme script
// writes the page's one link[rel="icon"] itself, and `metadata.icons` names none. React puts a
// metadata link back as soon as its address has changed under it (at hydration, at every
// navigation): the page then named favicon.svg, which follows the system's colours.
const themeScript = `var t="dark";try{if(localStorage.getItem("statarena.theme")==="light")t="light"}catch{}try{document.documentElement.dataset.theme=t;document.querySelector('meta[name="theme-color"]')?.setAttribute("content",t==="light"?"#F6F8FB":"#0E0F12")}catch{}try{window.__vegaSetFavicon=function(theme){var link=document.getElementById("vega-icon");if(!link){link=document.createElement("link");link.id="vega-icon";link.rel="icon";link.type="image/svg+xml";link.setAttribute("sizes","any");document.head.appendChild(link)}link.href="/branding/vega/icon-"+(theme==="light"?"light":"dark")+".svg?v=${faviconVersion}"};window.__vegaSetFavicon(t)}catch{}`;
// The share picture: the wordmark on a frame of the presentation film (public/branding/vega/).
const shareImage = "/branding/vega/share-1200x630.jpg";
const description = "Vega Intelligence : statistiques de football, analyses de matchs, joueurs et compétitions.";
export const metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Vega Intelligence",
  title: { default: "Vega Intelligence — Sports Analytics", template: "%s — Vega Intelligence" },
  description,
  manifest: "/site.webmanifest",
  icons: {
    apple: [{ url: "/api/vega-image?kind=icon&size=180", sizes: "180x180" }],
  },
  openGraph: { type: "website", locale: "fr_FR", siteName: "Vega Intelligence",
    title: "Vega Intelligence — Sports Analytics", description,
    images: [{ url: shareImage, width: 1200, height: 630, alt: "Vega Sport" }] },
  twitter: { card: "summary_large_image", title: "Vega Intelligence", description, images: [shareImage] },
};
// viewportFit "cover": the page reaches the screen's edges, and the shell keeps clear of
// the notch and the home indicator with the safe-area insets (styles.css).
export const viewport = {
  themeColor: "#0E0F12",
  colorScheme: "dark light",
  viewportFit: "cover",
};
// The origin the reads go to; none when they stay on the site's own origin.
const apiOrigin = (() => {
  try {
    return new URL(apiUrl("/api/status")).origin;
  } catch {
    return "";
  }
})();
export default function RootLayout({ children }) {
  return (
    <html lang="fr" data-theme="dark" suppressHydrationWarning>
      <head>
        <script id="vega-home-scope" dangerouslySetInnerHTML={{ __html: homeBootstrapGuardScript }} />
        {/* The reads go to the API's distribution: open that connection with the page. */}
        {apiOrigin && <link rel="preconnect" href={apiOrigin} crossOrigin="anonymous" />}
        <link
          rel="preload"
          href="/fonts/inter-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* Item pages open on their skeleton, not the logo (services/route-skeleton.js). */}
        <script
          id="vega-route"
          dangerouslySetInnerHTML={{ __html: routeSkeletonScript }}
        />
        {/* Without scripts nothing reads the site's theme: the icon that follows the system's colours. */}
        <noscript>
          <link
            rel="icon"
            href={`/branding/vega/favicon.svg?v=${faviconVersion}`}
            type="image/svg+xml"
            sizes="any"
          />
        </noscript>
        <script id="vega-theme" dangerouslySetInnerHTML={{ __html: themeScript }} />
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

import { Suspense } from "react";
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
import "../src/match-pills.css";
import "../src/navigation.css";
import "../src/home-pills.css";
import "../src/account.css";
import "../src/legal.css";
// Consent: the Vercel measurement waits for « Accepter » in Europe (src/services/consent.js).
import Consent from "../src/components/Consent.jsx";
import "../src/consent.css";
const siteUrl = "https://vegasport.vercel.app";
// Raised with every new drawing of the icon, so no browser keeps the old one.
const faviconVersion = 5;
// The colour the browser gives its own bars: the page's background in each theme (--bg, theme.css).
const themeColors = { dark: "#0E0F12", light: "#F6F8FB" };
// The theme: light or dark when chosen in the account's settings, else the computer's, followed while the page is open
// (« Système », and always when signed out: § 76.2).
// The tab's icon and the browser's colour follow the site's theme, which only the browser knows:
// the theme script writes the page's one link[rel="icon"] and its one meta[name="theme-color"]
// itself, and neither `metadata.icons` nor `viewport` names one. React puts a tag of its own back
// as soon as its address or its colour has changed under it (at hydration, at every navigation):
// the page then named favicon.svg, which follows the system's colours, and the dark theme's
// colour beside the light one's, or in its place.
const themeScript = `var t="dark",s=null,q=null;try{s=localStorage.getItem("statarena.theme")}catch{}try{q=window.matchMedia("(prefers-color-scheme: light)")}catch{}if(s==="light"||s==="dark")t=s;else if(q&&q.matches)t="light";try{document.documentElement.dataset.theme=t}catch{}try{window.__vegaSetFavicon=function(theme){var link=document.getElementById("vega-icon");if(!link){link=document.createElement("link");link.id="vega-icon";link.rel="icon";link.type="image/svg+xml";link.setAttribute("sizes","any");document.head.appendChild(link)}link.href="/branding/vega/icon-"+(theme==="light"?"light":"dark")+".svg?v=${faviconVersion}"};window.__vegaSetFavicon(t)}catch{}try{window.__vegaSetThemeColor=function(theme){var meta=document.getElementById("vega-theme-color")||document.createElement("meta");meta.id="vega-theme-color";meta.name="theme-color";meta.content=theme==="light"?"${themeColors.light}":"${themeColors.dark}";if(!meta.parentNode)document.head.appendChild(meta)};window.__vegaSetThemeColor(t)}catch{}try{q.addEventListener("change",function(){var c=null;try{c=localStorage.getItem("statarena.theme")}catch{}if(c==="light"||c==="dark")return;var n=q.matches?"light":"dark",r=document.documentElement;if(r.dataset.theme===n)return;r.dataset.theme=n;window.__vegaSetFavicon(n);window.__vegaSetThemeColor(n);window.dispatchEvent(new CustomEvent("vega:theme",{detail:n}))})}catch{}`;
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
// No themeColor here, nor in a page's own viewport: that tag is the theme script's (themeScript
// above), and React would take it over or add a second one.
export const viewport = {
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
        {/* Without scripts nothing reads the site's theme: the icon that follows the system's
            colours, and the dark theme's colour, the page staying dark. */}
        <noscript>
          <link
            rel="icon"
            href={`/branding/vega/favicon.svg?v=${faviconVersion}`}
            type="image/svg+xml"
            sizes="any"
          />
          <meta name="theme-color" content={themeColors.dark} />
        </noscript>
        <script id="vega-theme" dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Consent />
        <Suspense fallback={<ShellFallback />}>
          <Providers>{children}</Providers>
        </Suspense>
      </body>
    </html>
  );
}

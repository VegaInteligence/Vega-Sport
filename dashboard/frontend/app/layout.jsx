import { Suspense } from "react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import Providers from "./providers.jsx";
import "../src/brand-tokens.css";
import "../src/styles.css";
import "../src/analysis.css";
import "../src/theme.css";
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
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
      {
        url: "/branding/icons/favicon-32.png",
        type: "image/png",
        sizes: "32x32",
      },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "STATARENA",
    title: "STATARENA — Football Analytics",
    description,
    images: [
      { url: "/og-image.png", width: 1200, height: 630, alt: "STATARENA" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "STATARENA — Football Analytics",
    description,
    images: ["/og-image.png"],
  },
};
export const viewport = { themeColor: "#0F0F11", colorScheme: "dark light" };
export default function RootLayout({ children }) {
  return (
    <html lang="fr" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          id="statarena-theme"
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("statarena.theme")==="light"?"light":"dark";document.documentElement.dataset.theme=t;document.querySelector('meta[name="theme-color"]')?.setAttribute("content",t==="light"?"#FCFCFC":"#0F0F11")}catch{}`,
          }}
        />
      </head>
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
        <Analytics />
      </body>
    </html>
  );
}

import path from "node:path";
import { fileURLToPath } from "node:url";
const directory = path.dirname(fileURLToPath(import.meta.url));
/** @type {import('next').NextConfig} */
const config = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  poweredByHeader: false,
  // « Données & méthode » was removed (VI-41): old links land on the home page.
  async redirects() {
    return [{ source: "/methode", destination: "/", permanent: false }];
  },
  reactStrictMode: true,
  // Reuse visited route segments within the existing four-minute publication
  // revalidation window. Data caches and preference/generation fences still
  // own their freshness; this does not enable new route prefetch requests.
  experimental: { staleTimes: { dynamic: 240 } },
  devIndicators: false,
  outputFileTracingRoot: path.resolve(directory, "../.."),
  turbopack: { root: path.resolve(directory, "../..") },
  // The report images read their fonts from disk (app/api/rapport/image).
  outputFileTracingIncludes: { "/api/rapport/image": ["./src/server/fonts/**"] },
  outputFileTracingExcludes: {
    "/*": ["../../data/**/*", "../outputs/**/*", "../.env", "../.env.*"],
  },
};
export default config;

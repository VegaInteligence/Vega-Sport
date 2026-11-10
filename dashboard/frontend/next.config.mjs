import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_ORIGIN } from "./src/api-origin.js";
const directory = path.dirname(fileURLToPath(import.meta.url));
/** @type {import('next').NextConfig} */
const config = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  poweredByHeader: false,
  images: {
    // The image copies the API's distribution serves.
    remotePatterns: [
      {
        protocol: "https",
        hostname: new URL(API_ORIGIN).hostname,
        port: "",
        pathname: "/data/sources/**",
        search: "",
      },
    ],
    imageSizes: [32, 48, 64, 96, 128, 192, 256],
    deviceSizes: [384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    minimumCacheTTL: 31536000,
    maximumRedirects: 0,
  },
  reactStrictMode: true,
  // Reuse visited route segments within the existing four-minute publication
  // revalidation window. Data caches and preference/generation fences still
  // own their freshness; this does not enable new route prefetch requests.
  experimental: { staleTimes: { dynamic: 240 } },
  devIndicators: false,
  outputFileTracingRoot: path.resolve(directory, "../.."),
  turbopack: { root: path.resolve(directory, "../..") },
  outputFileTracingExcludes: {
    "/*": ["../../data/**/*", "../outputs/**/*", "../.env", "../.env.*"],
  },
};
export default config;

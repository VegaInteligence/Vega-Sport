import path from "node:path";
import { fileURLToPath } from "node:url";
const directory = path.dirname(fileURLToPath(import.meta.url));
/** @type {import('next').NextConfig} */
const config = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  poweredByHeader: false,
  images: {
    remotePatterns: ["raw", "computed", "sources"].map((prefix) => ({
      protocol: "https",
      hostname: "d2clu0phovomb8.cloudfront.net",
      port: "",
      pathname: `/data/${prefix}/**`,
      search: "",
    })),
    imageSizes: [32, 48, 64, 96, 128, 192, 256],
    deviceSizes: [384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    minimumCacheTTL: 31536000,
    maximumRedirects: 0,
  },
  reactStrictMode: true,
  devIndicators: false,
  outputFileTracingRoot: path.resolve(directory, "../.."),
  turbopack: { root: path.resolve(directory, "../..") },
  outputFileTracingExcludes: {
    "/*": ["../../data/**/*", "../outputs/**/*", "../.env", "../.env.*"],
  },
};
export default config;

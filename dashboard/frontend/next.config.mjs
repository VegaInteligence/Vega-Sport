import path from "node:path";
import { fileURLToPath } from "node:url";
const directory = path.dirname(fileURLToPath(import.meta.url));
/** @type {import('next').NextConfig} */
const config = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  env: { NEXT_PUBLIC_DATA_REVISION: process.env.VERCEL_GIT_COMMIT_SHA || "" },
  outputFileTracingRoot: path.resolve(directory, "../.."),
  turbopack: { root: path.resolve(directory, "../..") },
  outputFileTracingExcludes: {
    "/*": ["../../data/**/*", "../outputs/**/*", "../.env", "../.env.*"],
  },
};
export default config;

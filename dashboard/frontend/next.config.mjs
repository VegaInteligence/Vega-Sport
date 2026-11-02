import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportPublicData } from "../scripts/export_public_data.mjs";
const directory = path.dirname(fileURLToPath(import.meta.url));
/** @type {import('next').NextConfig} */
const config = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  env: {
    NEXT_PUBLIC_DATA_REVISION: process.env.VERCEL
      ? process.env.VERCEL_GIT_COMMIT_SHA || ""
      : "",
  },
  async headers() {
    return [
      {
        source: "/assets/:revision/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  outputFileTracingRoot: path.resolve(directory, "../.."),
  turbopack: { root: path.resolve(directory, "../..") },
  outputFileTracingExcludes: {
    "/*": ["../../data/**/*", "../outputs/**/*", "../.env", "../.env.*"],
  },
};
export default async function configure(phase) {
  if (process.env.VERCEL && phase === "phase-production-build") {
    await exportPublicData(
      path.resolve(directory, "../../data"),
      path.join(directory, "public"),
      process.env.VERCEL_GIT_COMMIT_SHA,
    );
  }
  return config;
}

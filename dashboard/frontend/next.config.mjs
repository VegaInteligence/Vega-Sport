/** @type {import('next').NextConfig} */
const config = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
};
export default config;

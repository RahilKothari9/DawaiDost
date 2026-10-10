import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  // Lets a second, isolated dev server run beside the shared one (NEXT_DIST_DIR=.next-preview).
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;

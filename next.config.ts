import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray package-lock.json in the parent folder otherwise confuses root detection.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;

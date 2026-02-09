import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@reiryoku/ctrader-layer"],
  transpilePackages: [
    "lightweight-charts-line-tools-core",
    "lightweight-charts-line-tools-rectangle",
    "lightweight-charts-line-tools-lines",
    "lightweight-charts-line-tools-path",
    "lightweight-charts-line-tools-long-short-position",
  ],
};

export default nextConfig;

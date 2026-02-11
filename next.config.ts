import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@reiryoku/ctrader-layer"],
  outputFileTracingIncludes: {
    "/api/ctrader/accounts": [
      "./node_modules/@reiryoku/ctrader-layer/protobuf/**/*",
      "./node_modules/@reiryoku/ctrader-layer/build/protobuf/**/*",
    ],
    "/api/ctrader/bars": [
      "./node_modules/@reiryoku/ctrader-layer/protobuf/**/*",
      "./node_modules/@reiryoku/ctrader-layer/build/protobuf/**/*",
    ],
    "/api/ctrader/trades": [
      "./node_modules/@reiryoku/ctrader-layer/protobuf/**/*",
      "./node_modules/@reiryoku/ctrader-layer/build/protobuf/**/*",
    ],
  },
  transpilePackages: [
    "lightweight-charts-line-tools-core",
    "lightweight-charts-line-tools-rectangle",
    "lightweight-charts-line-tools-lines",
    "lightweight-charts-line-tools-path",
    "lightweight-charts-line-tools-long-short-position",
  ],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Data-provider SDKs load with Node's own require instead of being bundled.
  // eodhd has an optional `ws` import (for its WebSocket feed) that the bundler
  // cannot resolve; eventregistry reads optional settings files with `fs`.
  serverExternalPackages: ["eodhd", "eventregistry"],
};

export default nextConfig;

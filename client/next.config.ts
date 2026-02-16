import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure strict mode for production safety
  reactStrictMode: true,

  // Environment variable validation for production
  // KV_REST_API_URL and KV_REST_API_TOKEN are validated at runtime in lib/matchStore.ts

  onDemandEntries: {
    // Precompute API routes to avoid cold starts
    maxInactiveAge: 60 * 60 * 1000, // 1 hour
    pagesBufferLength: 5,
  },
};

export default nextConfig;

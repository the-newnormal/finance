import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` prints every server action call with its arguments, which include names, emails and
  // payout details. Logs carry codes and counts only (CLAUDE.md), so not these.
  logging: {
    serverFunctions: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  output: "standalone",
  // Migrations are read from disk at startup; make sure the standalone bundle ships them.
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*"] }, // lean Docker image for the school server
};

export default config;

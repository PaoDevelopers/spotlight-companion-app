import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  output: "standalone", // lean Docker image for the school server
};

export default config;

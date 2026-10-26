import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// In development the Go server (default http://localhost:3000) answers /api and the Microsoft redirects;
// Vite serves the UI with hot reload and forwards those paths.
const goServer = process.env.SPOTLIGHT_SERVER ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    port: 5173,
    proxy: {
      "/api": goServer,
      "/auth": goServer,
      "/healthz": goServer,
    },
  },
  build: { outDir: "dist", sourcemap: false },
});

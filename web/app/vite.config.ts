import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/ui-assets/",
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/ws": { target: "ws://127.0.0.1:8080", ws: true },
      "/assets": "http://127.0.0.1:8080",
      "/world-map-paths.svg": "http://127.0.0.1:8080",
    },
  },
  build: {
    outDir: "../dist",
    // scripts/build.mjs publishes a clean build and retains one previous
    // dependency graph locally for tabs that still need its lazy chunks.
    emptyOutDir: true,
    assetsDir: ".",
    rollupOptions: {
      input: "index.html",
    },
  },
});

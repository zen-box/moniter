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
    // Existing tabs may still import a chunk from the previous deployment.
    emptyOutDir: false,
    assetsDir: ".",
    rollupOptions: {
      input: "index.html",
    },
  },
});

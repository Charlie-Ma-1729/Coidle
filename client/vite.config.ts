import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: { "@coidle/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:2330",
      "/ws": { target: "ws://localhost:2330", ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});

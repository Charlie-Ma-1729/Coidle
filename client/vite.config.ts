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
    // 專案放在網路磁碟時檔案監看會失效（改了檔案不更新）；設 VITE_POLL=1 改用輪詢
    watch: process.env.VITE_POLL ? { usePolling: true, interval: 400 } : undefined,
    proxy: {
      "/api": "http://localhost:2330",
      "/ws": { target: "ws://localhost:2330", ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});

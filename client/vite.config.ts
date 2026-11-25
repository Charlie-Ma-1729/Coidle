import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";

/**
 * 每次打包產生一個版本代號：編進前端程式（__BUILD_ID__），同時寫進 dist/version.json。
 * 已經開著的前端定期去讀 /version.json，代號不同就知道有新版，會自己重新載入（見 src/updater.ts）。
 */
function versionFile(buildId: string): Plugin {
  return {
    name: "coidle-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: buildId }) });
    },
  };
}

export default defineConfig(({ command }) => {
  const buildId = command === "build" ? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : "dev";
  return {
    plugins: [preact(), versionFile(buildId)],
    define: { __BUILD_ID__: JSON.stringify(buildId) },
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
  };
});

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  resolve: {
    alias: { "@coidle/shared": fileURLToPath(new URL("./shared/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "client/**/*.test.{ts,tsx}"],
    // 網路磁碟上載入 happy-dom 很慢，forks worker 會啟動逾時；threads 比較穩
    pool: "threads",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

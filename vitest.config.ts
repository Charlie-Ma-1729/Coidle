import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  resolve: {
    alias: { "@coidle/shared": fileURLToPath(new URL("./shared/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "client/**/*.test.{ts,tsx}"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

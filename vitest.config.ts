import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@coidle/shared": fileURLToPath(new URL("./shared/src/index.ts", import.meta.url)) },
  },
  test: { include: ["shared/**/*.test.ts", "server/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 30_000 },
});

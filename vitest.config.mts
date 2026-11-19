import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^app\//, replacement: path.resolve("app") + "/" },
      { find: /^config\//, replacement: path.resolve("config") + "/" },
    ],
  },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});

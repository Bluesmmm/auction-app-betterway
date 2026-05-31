import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    environment: "node",
    testTimeout: 15_000
  },
  resolve: {
    alias: {
      "@auction/shared": "/packages/shared/src/index.ts"
    }
  }
});

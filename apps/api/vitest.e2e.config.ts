import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.e2e.ts"],
    globalSetup: ["test/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});

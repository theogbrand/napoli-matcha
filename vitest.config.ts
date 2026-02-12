import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 300_000, // 5 minutes — these are integration tests that create sandboxes
  },
});

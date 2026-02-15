import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 300_000, // 5 minutes — integration tests that create sandboxes
    exclude: [
      ...configDefaults.exclude,
      "dist/**",
    ],
  },
});

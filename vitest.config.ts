import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 14_400_000, // 5 minutes — integration tests that create sandboxes
    exclude: [
      ...configDefaults.exclude,
      "dist/**",
    ],
  },
});

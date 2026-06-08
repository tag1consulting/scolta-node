import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Long-running benchmark/scale tests are tagged with the `slow` describe
    // prefix; deselect with `vitest run -t '^(?!slow)'` or via CLI.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

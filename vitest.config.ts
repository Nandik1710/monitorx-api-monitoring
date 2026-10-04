import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "apps/**/tests/**/*.test.ts",
      "packages/**/tests/**/*.test.ts",
    ],
    environment: "node",
    passWithNoTests: true,
  },
  esbuild: { jsx: "automatic" },
});

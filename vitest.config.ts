import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/web/vitest.config.ts",
      "apps/extension/vitest.config.ts",
      {
        test: {
          name: "scripts",
          environment: "node",
          include: ["scripts/**/*.test.ts"]
        }
      }
    ]
  }
});

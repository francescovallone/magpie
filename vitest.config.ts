import { defineConfig, defineProject } from "vitest/config";

import { createMagpieVitestReporter } from "./src/vitest-reporter.js";

export default defineConfig({
  test: {
    reporters: [
      createMagpieVitestReporter({
        jsonOutputFile: ".magpie/reports/latest.json",
        jsonArchiveDirectory: ".magpie/reports/history",
      }),
    ],
    projects: [
      defineProject({
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
        },
      }),
      defineProject({
        test: {
          name: "acceptance",
          include: ["acceptance/**/*.test.ts"],
        },
      }),
    ],
  },
});
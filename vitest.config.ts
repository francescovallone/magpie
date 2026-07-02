import { defineConfig } from "vitest/config";

import { createMagpieVitestReporter } from "./src/vitest-reporter.js";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "acceptance/**/*.test.ts"],
    reporters: [
      createMagpieVitestReporter({
        jsonOutputFile: ".magpie/reports/latest.json",
      }),
    ],
  },
});
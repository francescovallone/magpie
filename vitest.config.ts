import { defineConfig, defineProject } from "vitest/config";

import { isOutputEnabled } from "./src/cli.js";
import { createMagpieVitestReporter } from "./src/vitest-reporter.js";

const htmlReportingEnabled = isOutputEnabled("html", {
  argv: process.argv,
  env: process.env,
});

export default defineConfig({
  test: {
    reporters: [
      createMagpieVitestReporter({
        jsonOutputFile: ".magpie/reports/latest.json",
        jsonArchiveDirectory: ".magpie/reports/history",
        ...(htmlReportingEnabled
          ? {
              htmlOutputFile: ".magpie/reports/latest.html",
              htmlArchiveDirectory: ".magpie/reports/history",
            }
          : {}),
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
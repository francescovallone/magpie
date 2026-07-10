import { defineConfig, defineProject } from "vitest/config";

import { isOutputEnabled } from "./src/cli.js";
import { magpiePlugin } from "./src/plugin.js";

const htmlReportingEnabled = isOutputEnabled("html", {
  argv: process.argv,
  env: process.env,
});

export default defineConfig({
  plugins: [
    magpiePlugin({
      jsonOutputFile: ".magpie/reports/latest.json",
      jsonArchiveDirectory: ".magpie/reports/history",
      junitOutputFile: ".magpie/reports/junit.xml",
      ...(htmlReportingEnabled
        ? {
            htmlOutputFile: ".magpie/reports/latest.html",
            htmlArchiveDirectory: ".magpie/reports/history",
          }
        : {}),
    }),
  ],
  test: {
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
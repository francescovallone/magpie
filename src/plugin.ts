import type { Plugin } from "vitest/config";

import { createMagpieVitestReporter, type MagpieVitestReporterOptions } from "./vitest-reporter.js";

export interface MagpiePluginOptions extends MagpieVitestReporterOptions {}

/**
 * Vite/Vitest plugin that registers the Magpie reporter without requiring
 * consumers to import and wire up `createMagpieVitestReporter()` themselves.
 *
 * Add it to the `plugins` array in `vite.config.ts`/`vitest.config.ts`:
 *
 * ```ts
 * import { defineConfig } from "vitest/config";
 * import { magpiePlugin } from "magpie";
 *
 * export default defineConfig({
 *   plugins: [magpiePlugin({ jsonOutputFile: ".magpie/reports/latest.json" })],
 * });
 * ```
 *
 * Vite merges array-valued config returned from a plugin's `config()` hook
 * with the rest of the resolved config, so this composes with any reporters
 * already listed in `test.reporters` instead of replacing them.
 */
export function magpiePlugin(options: MagpiePluginOptions = {}): Plugin {
  return {
    name: "magpie:reporter",
    config() {
      return {
        test: {
          reporters: [createMagpieVitestReporter(options)],
        },
      };
    },
  };
}

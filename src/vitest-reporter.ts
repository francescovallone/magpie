import type { Reporter, TestRunEndReason } from "vitest/reporters";

import { writeJsonReport } from "./io.js";
import { formatExecutionRunReport, type ReportBuildOptions } from "./reporting.js";
import {
  buildVitestReporterExecutionReport,
  resetVitestReporterRecords,
  type VitestReporterBridgeOptions,
} from "./vitest-bridge.js";

export interface MagpieVitestReporterOptions
  extends ReportBuildOptions<Record<string, unknown>>,
    VitestReporterBridgeOptions {
  readonly jsonOutputFile?: string;
  readonly spacing?: number;
  readonly write?: (text: string) => Promise<void> | void;
}

export class MagpieVitestReporter implements Reporter {
  constructor(private readonly options: MagpieVitestReporterOptions = {}) {}

  async onTestRunStart(): Promise<void> {
    await resetVitestReporterRecords(this.options);
  }

  async onTestRunEnd(
    _testModules: ReadonlyArray<unknown>,
    _unhandledErrors: ReadonlyArray<unknown>,
    _reason: TestRunEndReason,
  ): Promise<void> {
    const report = await buildVitestReporterExecutionReport(this.options);

    if (report.totals.scenarioCount === 0) {
      return;
    }

    const output = formatExecutionRunReport(report);
    const write = this.options.write ?? ((text: string) => process.stdout.write(`\n${text}\n`));

    await write(output);

    if (this.options.jsonOutputFile) {
      await writeJsonReport(this.options.jsonOutputFile, report, {
        ...(this.options.spacing !== undefined ? { spacing: this.options.spacing } : {}),
      });
    }
  }
}

export function createMagpieVitestReporter(
  options: MagpieVitestReporterOptions = {},
): MagpieVitestReporter {
  return new MagpieVitestReporter(options);
}
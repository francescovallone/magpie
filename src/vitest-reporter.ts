import { dirname, join } from "node:path";

import type { Reporter, TestRunEndReason } from "vitest/reporters";

import { writeJsonReport } from "./io.js";
import { formatExecutionRunReport, writeHtmlReport, type ReportBuildOptions } from "./reporting.js";
import {
  buildVitestReporterExecutionReport,
  resetVitestReporterRecords,
  type VitestReporterBridgeOptions,
} from "./vitest-bridge.js";

export interface MagpieVitestReporterOptions
  extends ReportBuildOptions<Record<string, unknown>>,
    VitestReporterBridgeOptions {
  readonly jsonOutputFile?: string;
  readonly jsonArchiveDirectory?: string;
  readonly htmlOutputFile?: string;
  readonly htmlArchiveDirectory?: string;
  readonly spacing?: number;
  readonly write?: (text: string) => Promise<void> | void;
}

function createTimestampedReportFileName(timestamp: number, extension: string): string {
  return new Date(timestamp).toISOString().replace(/[:.]/g, "-") + extension;
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
    const write = this.options.write ?? ((text: string) => process.stdout.write(`\n${text}\n`));

    if (report.totals.scenarioCount === 0) {
      await write("\nMagpie Report\n  No acceptance scenarios were recorded in this run.\n");
      return;
    }

    const output = formatExecutionRunReport(report);

    await write(output);

    if (this.options.jsonOutputFile) {
      await writeJsonReport(this.options.jsonOutputFile, report, {
        ...(this.options.spacing !== undefined ? { spacing: this.options.spacing } : {}),
      });

      const archiveDirectory = this.options.jsonArchiveDirectory ?? join(dirname(this.options.jsonOutputFile), "history");
      await writeJsonReport(join(archiveDirectory, createTimestampedReportFileName(report.generatedAt, ".json")), report, {
        ...(this.options.spacing !== undefined ? { spacing: this.options.spacing } : {}),
      });
    }

    if (this.options.htmlOutputFile) {
      await writeHtmlReport(this.options.htmlOutputFile, report);

      const archiveDirectory = this.options.htmlArchiveDirectory ?? join(dirname(this.options.htmlOutputFile), "history");
      await writeHtmlReport(join(archiveDirectory, createTimestampedReportFileName(report.generatedAt, ".html")), report);
    }
  }
}

export function createMagpieVitestReporter(
  options: MagpieVitestReporterOptions = {},
): MagpieVitestReporter {
  return new MagpieVitestReporter(options);
}
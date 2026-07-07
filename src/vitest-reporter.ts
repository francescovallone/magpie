import { readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Reporter, TestRunEndReason } from "vitest/reporters";

import { writeJsonReport } from "./io.js";
import { formatExecutionRunReport, writeHtmlReport, type ReportBuildOptions } from "./reporting.js";
import {
  buildVitestReporterExecutionReport,
  resetVitestReporterRecords,
  type VitestReporterBridgeOptions,
} from "./vitest-bridge.js";

export const DEFAULT_HISTORY_FILE_LIMIT = 3;

export interface MagpieVitestReporterOptions
  extends ReportBuildOptions<Record<string, unknown>>,
    VitestReporterBridgeOptions {
  readonly jsonOutputFile?: string;
  readonly jsonArchiveDirectory?: string;
  readonly jsonHistoryLimit?: number;
  readonly htmlOutputFile?: string;
  readonly htmlArchiveDirectory?: string;
  readonly htmlHistoryLimit?: number;
  readonly spacing?: number;
  readonly write?: (text: string) => Promise<void> | void;
}

function createTimestampedReportFileName(timestamp: number, extension: string): string {
  return new Date(timestamp).toISOString().replace(/[:.]/g, "-") + extension;
}

async function pruneArchiveDirectory(directory: string, limit: number): Promise<void> {
  if (!Number.isFinite(limit) || limit < 0) {
    return;
  }

  let entries: ReadonlyArray<string>;
  try {
    entries = await readdir(directory);
  } catch {
    return;
  }

  const excess = entries.length - limit;
  if (excess <= 0) {
    return;
  }

  const staleEntries = [...entries].sort().slice(0, excess);
  await Promise.all(staleEntries.map((name) => rm(join(directory, name), { force: true })));
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

      await pruneArchiveDirectory(archiveDirectory, this.options.jsonHistoryLimit ?? DEFAULT_HISTORY_FILE_LIMIT);
    }

    if (this.options.htmlOutputFile) {
      await writeHtmlReport(this.options.htmlOutputFile, report);

      const archiveDirectory = this.options.htmlArchiveDirectory ?? join(dirname(this.options.htmlOutputFile), "history");
      await writeHtmlReport(join(archiveDirectory, createTimestampedReportFileName(report.generatedAt, ".html")), report);

      await pruneArchiveDirectory(archiveDirectory, this.options.htmlHistoryLimit ?? DEFAULT_HISTORY_FILE_LIMIT);
    }
  }
}

export function createMagpieVitestReporter(
  options: MagpieVitestReporterOptions = {},
): MagpieVitestReporter {
  return new MagpieVitestReporter(options);
}
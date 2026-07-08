import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Scenario, StoryReference } from "./domain.js";
import type { ScenarioExecutionResult } from "./engine.js";
import {
  buildExecutionRunReportFromScenarioReports,
  createScenarioReport,
  resolveAcceptanceIds,
  type ExecutionRunReport,
  type ReportBuildOptions,
  type ScenarioDescriptor,
  type ScenarioReportRecord,
} from "./reporting.js";

const DEFAULT_RECORDS_DIRECTORY = ".magpie/vitest-records";

export interface VitestReporterBridgeOptions {
  readonly recordsDirectory?: string;
}

export interface VitestAdapterBridgeOptions extends VitestReporterBridgeOptions {
  readonly enabled?: boolean;
}

export interface MagpieVitestReportOptions extends ReportBuildOptions<Record<string, unknown>> {
  readonly recordsDirectory?: string;
}

function normalizeStory(story?: StoryReference): StoryReference | undefined {
  if (!story) {
    return undefined;
  }

  return {
    ...(story.id !== undefined ? { id: story.id } : {}),
    ...(story.description !== undefined ? { description: story.description } : {}),
    title: story.title,
  };
}

export function getVitestReporterRecordsDirectory(options: VitestReporterBridgeOptions = {}): string {
  return options.recordsDirectory ?? DEFAULT_RECORDS_DIRECTORY;
}

export function createScenarioDescriptor<TContext extends object>(
  scenario: Scenario<TContext>,
): ScenarioDescriptor {
  const descriptor: ScenarioDescriptor = {
    id: scenario.id,
    title: scenario.title,
    acceptance: resolveAcceptanceIds(scenario),
    tags: scenario.tags,
  };

  if (scenario.description !== undefined) {
    Object.assign(descriptor, { description: scenario.description });
  }

  if (scenario.story) {
    Object.assign(descriptor, { story: normalizeStory(scenario.story)! });
  }

  return descriptor;
}

export function createScenarioReportRecord<TContext extends object>(
  scenario: Scenario<TContext>,
  result: ScenarioExecutionResult<TContext>,
): ScenarioReportRecord {
  return {
    scenario: createScenarioDescriptor(scenario),
    report: createScenarioReport(scenario, result),
  };
}

export async function resetVitestReporterRecords(
  options: VitestReporterBridgeOptions = {},
): Promise<void> {
  const directory = getVitestReporterRecordsDirectory(options);

  await rm(directory, { force: true, recursive: true });
  await mkdir(directory, { recursive: true });
}

export async function appendVitestReporterRecord<TContext extends object>(
  scenario: Scenario<TContext>,
  result: ScenarioExecutionResult<TContext>,
  options: VitestReporterBridgeOptions = {},
): Promise<void> {
  const directory = getVitestReporterRecordsDirectory(options);

  await mkdir(directory, { recursive: true });

  const filePath = join(
    directory,
    `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}.json`,
  );

  await writeFile(filePath, `${JSON.stringify(createScenarioReportRecord(scenario, result))}\n`, "utf8");
}

export async function readVitestReporterRecords(
  options: VitestReporterBridgeOptions = {},
): Promise<ReadonlyArray<ScenarioReportRecord>> {
  const directory = getVitestReporterRecordsDirectory(options);

  try {
    const names = await readdir(directory);
    const records = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          const content = await readFile(join(directory, name), "utf8");
          return JSON.parse(content) as ScenarioReportRecord;
        }),
    );

    return records.sort((left, right) => left.report.title.localeCompare(right.report.title));
  } catch {
    return [];
  }
}

export async function buildVitestReporterExecutionReport(
  options: MagpieVitestReportOptions = {},
): Promise<ExecutionRunReport> {
  const records = await readVitestReporterRecords(options);
  return buildExecutionRunReportFromScenarioReports(records, options);
}
import type { Scenario, Story } from "./domain.js";
import type { ExecutionHooks, ScenarioExecutionResult } from "./engine.js";
import { writeJsonReport, type JsonReportWriteOptions } from "./io.js";

export interface StepReport {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly lifecycle: string;
  readonly duration: number;
  readonly status: "passed" | "failed" | "skipped";
  readonly error?: string;
}

export interface ScenarioReport {
  readonly id: string;
  readonly title: string;
  readonly story?: string;
  readonly acceptance: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  readonly duration: number;
  readonly status: "passed" | "failed";
  readonly error?: string;
  readonly steps: ReadonlyArray<StepReport>;
}

export interface StoryReport {
  readonly id?: string;
  readonly title: string;
  readonly description?: string;
  readonly scenarios: ReadonlyArray<ScenarioReport>;
}

export interface AcceptanceTraceabilityReport {
  readonly implemented: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<string>;
}

export interface ScenarioExecutionRecord<TContext extends object> {
  readonly scenario: Scenario<TContext>;
  readonly result: ScenarioExecutionResult<TContext>;
}

export interface ScenarioDescriptor {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly acceptance: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  readonly story?: {
    readonly id?: string;
    readonly title: string;
    readonly description?: string;
  };
}

export interface ScenarioReportRecord {
  readonly scenario: ScenarioDescriptor;
  readonly report: ScenarioReport;
}

export interface ExecutionRunTotals {
  readonly scenarioCount: number;
  readonly passedScenarioCount: number;
  readonly failedScenarioCount: number;
  readonly stepCount: number;
  readonly passedStepCount: number;
  readonly failedStepCount: number;
  readonly skippedStepCount: number;
  readonly duration: number;
}

export interface ExecutionRunReport {
  readonly generatedAt: number;
  readonly totals: ExecutionRunTotals;
  readonly stories: ReadonlyArray<StoryReport>;
  readonly scenarios: ReadonlyArray<ScenarioReport>;
  readonly traceability: AcceptanceTraceabilityReport;
}

export interface ReportBuildOptions<TContext extends object> {
  readonly stories?: ReadonlyArray<Story<TContext>>;
  readonly expectedAcceptanceIds?: ReadonlyArray<string>;
  readonly now?: () => number;
}

export interface AcceptanceReporter<TContext extends object> {
  readonly entries: ReadonlyArray<ScenarioExecutionRecord<TContext>>;
  recordScenario(
    scenario: Scenario<TContext>,
    result: ScenarioExecutionResult<TContext>,
  ): Promise<void> | void;
  buildReport(options?: ReportBuildOptions<TContext>): ExecutionRunReport;
  flush(options?: ReportBuildOptions<TContext>): Promise<ExecutionRunReport> | ExecutionRunReport;
}

export interface ConsoleReporterOptions<TContext extends object> extends ReportBuildOptions<TContext> {
  readonly write?: (text: string) => Promise<void> | void;
}

export interface JsonReporterOptions<TContext extends object>
  extends ReportBuildOptions<TContext>,
    JsonReportWriteOptions {
  readonly outputPath: string;
}

function createImplicitStories<TContext extends object>(
  records: ReadonlyArray<ScenarioExecutionRecord<TContext>>,
): ReadonlyArray<Story<TContext>> {
  const groups = new Map<string, Story<TContext>>();

  for (const record of records) {
    const storyId = record.scenario.story?.id ?? record.scenario.story?.title ?? "__ungrouped__";
    const storyTitle = record.scenario.story?.title ?? "Ungrouped";
    const existing = groups.get(storyId);

    if (existing) {
      groups.set(storyId, {
        ...existing,
        scenarios: Object.freeze([...existing.scenarios, record.scenario]),
      });
      continue;
    }

    groups.set(storyId, {
      ...(record.scenario.story?.id ? { id: record.scenario.story.id } : {}),
      ...(record.scenario.story?.description ? { description: record.scenario.story.description } : {}),
      title: storyTitle,
      metadata: {},
      scenarios: Object.freeze([record.scenario]),
    });
  }

  return Object.freeze(Array.from(groups.values()));
}

function createTotals(scenarios: ReadonlyArray<ScenarioReport>): ExecutionRunTotals {
  const stepCount = scenarios.reduce((total, scenario) => total + scenario.steps.length, 0);
  const passedStepCount = scenarios.reduce(
    (total, scenario) => total + scenario.steps.filter((step) => step.status === "passed").length,
    0,
  );
  const failedStepCount = scenarios.reduce(
    (total, scenario) => total + scenario.steps.filter((step) => step.status === "failed").length,
    0,
  );
  const skippedStepCount = scenarios.reduce(
    (total, scenario) => total + scenario.steps.filter((step) => step.status === "skipped").length,
    0,
  );
  const duration = scenarios.reduce((total, scenario) => total + scenario.duration, 0);
  const passedScenarioCount = scenarios.filter((scenario) => scenario.status === "passed").length;
  const failedScenarioCount = scenarios.length - passedScenarioCount;

  return {
    scenarioCount: scenarios.length,
    passedScenarioCount,
    failedScenarioCount,
    stepCount,
    passedStepCount,
    failedStepCount,
    skippedStepCount,
    duration,
  };
}

function createStoryReportsFromScenarioReports(
  scenarios: ReadonlyArray<ScenarioReport>,
  descriptors: ReadonlyArray<ScenarioDescriptor>,
): ReadonlyArray<StoryReport> {
  const groups = new Map<string, StoryReport>();

  for (const scenario of scenarios) {
    const descriptor = descriptors.find((candidate) => candidate.id === scenario.id);
    const storyId = descriptor?.story?.id ?? descriptor?.story?.title ?? "__ungrouped__";
    const storyTitle = descriptor?.story?.title ?? scenario.story ?? "Ungrouped";
    const existing = groups.get(storyId);

    if (existing) {
      groups.set(storyId, {
        ...existing,
        scenarios: Object.freeze([...existing.scenarios, scenario]),
      });
      continue;
    }

    groups.set(storyId, {
      ...(descriptor?.story?.id !== undefined ? { id: descriptor.story.id } : {}),
      ...(descriptor?.story?.description !== undefined
        ? { description: descriptor.story.description }
        : {}),
      title: storyTitle,
      scenarios: Object.freeze([scenario]),
    });
  }

  return Object.freeze(Array.from(groups.values()));
}

export function createScenarioReport<TContext extends object>(
  scenario: Scenario<TContext>,
  result: ScenarioExecutionResult<TContext>,
): ScenarioReport {
  const report: ScenarioReport = {
    id: scenario.id,
    title: scenario.title,
    acceptance: scenario.acceptance,
    tags: scenario.tags,
    duration: result.duration,
    status: result.success ? "passed" : "failed",
    steps: result.steps.map((step) => ({
      ...(step.error ? { error: step.error.message } : {}),
      id: step.stepId,
      name: step.stepName,
      type: step.type,
      lifecycle: step.lifecycle,
      duration: step.duration,
      status: step.status,
    })),
  };

  if (scenario.story?.title !== undefined) {
    Object.assign(report, { story: scenario.story.title });
  }

  if (result.failure?.error.message !== undefined) {
    Object.assign(report, { error: result.failure.error.message });
  }

  return report;
}

export function createStoryReport<TContext extends object>(
  story: Story<TContext>,
  results: ReadonlyArray<ScenarioExecutionResult<TContext>>,
): StoryReport {
  const byId = new Map(results.map((result) => [result.scenarioId, result]));

  const report: StoryReport = {
    title: story.title,
    scenarios: story.scenarios.flatMap((scenario) => {
      const result = byId.get(scenario.id);
      return result ? [createScenarioReport(scenario, result)] : [];
    }),
  };

  if (story.id !== undefined) {
    Object.assign(report, { id: story.id });
  }

  if (story.description !== undefined) {
    Object.assign(report, { description: story.description });
  }

  return report;
}

export function createAcceptanceTraceabilityReport<TContext extends object>(
  scenarios: ReadonlyArray<Scenario<TContext>>,
  expectedAcceptanceIds: ReadonlyArray<string> = [],
): AcceptanceTraceabilityReport {
  const implemented = Array.from(new Set(scenarios.flatMap((scenario) => scenario.acceptance))).sort();
  const missing = expectedAcceptanceIds
    .filter((acceptanceId) => !implemented.includes(acceptanceId))
    .sort();

  return { implemented, missing };
}

export function buildExecutionRunReport<TContext extends object>(
  records: ReadonlyArray<ScenarioExecutionRecord<TContext>>,
  options: ReportBuildOptions<TContext> = {},
): ExecutionRunReport {
  const now = options.now ?? (() => Date.now());
  const scenarioRecords = records.map((record) => ({
    scenario: {
      ...(record.scenario.description !== undefined ? { description: record.scenario.description } : {}),
      ...(record.scenario.story
        ? {
            story: {
              ...(record.scenario.story.id !== undefined ? { id: record.scenario.story.id } : {}),
              ...(record.scenario.story.description !== undefined
                ? { description: record.scenario.story.description }
                : {}),
              title: record.scenario.story.title,
            },
          }
        : {}),
      id: record.scenario.id,
      title: record.scenario.title,
      acceptance: record.scenario.acceptance,
      tags: record.scenario.tags,
    },
    report: createScenarioReport(record.scenario, record.result),
  }));

  const normalizedOptions: ReportBuildOptions<Record<string, unknown>> = { now };

  if (options.expectedAcceptanceIds !== undefined) {
    Object.assign(normalizedOptions, { expectedAcceptanceIds: options.expectedAcceptanceIds });
  }

  if (options.stories !== undefined) {
    Object.assign(normalizedOptions, {
      stories: options.stories as ReadonlyArray<Story<Record<string, unknown>>>,
    });
  }

  return buildExecutionRunReportFromScenarioReports(scenarioRecords, normalizedOptions);
}

export function buildExecutionRunReportFromScenarioReports(
  records: ReadonlyArray<ScenarioReportRecord>,
  options: ReportBuildOptions<Record<string, unknown>> = {},
): ExecutionRunReport {
  const now = options.now ?? (() => Date.now());
  const scenarios = Object.freeze(records.map((record) => record.report));
  const stories = options.stories
    ? Object.freeze(
        options.stories.map((story) => ({
          ...(story.id !== undefined ? { id: story.id } : {}),
          ...(story.description !== undefined ? { description: story.description } : {}),
          title: story.title,
          scenarios: Object.freeze(
            story.scenarios.flatMap((scenario) => scenarios.filter((candidate) => candidate.id === scenario.id)),
          ),
        })),
      )
    : createStoryReportsFromScenarioReports(
        scenarios,
        records.map((record) => record.scenario),
      );

  return {
    generatedAt: now(),
    totals: createTotals(scenarios),
    stories,
    scenarios,
    traceability: {
      implemented: Array.from(
        new Set(records.flatMap((record) => record.scenario.acceptance)),
      ).sort(),
      missing: (options.expectedAcceptanceIds ?? [])
        .filter(
          (acceptanceId) => !records.some((record) => record.scenario.acceptance.includes(acceptanceId)),
        )
        .sort(),
    },
  };
}

export function createReporter<TContext extends object>(): AcceptanceReporter<TContext> {
  const entries: Array<ScenarioExecutionRecord<TContext>> = [];

  return {
    get entries() {
      return entries;
    },
    recordScenario(scenario, result) {
      entries.push({ scenario, result });
    },
    buildReport(options = {}) {
      return buildExecutionRunReport(entries, options);
    },
    flush(options = {}) {
      return buildExecutionRunReport(entries, options);
    },
  };
}

export function createReportingHooks<TContext extends object>(
  reporter: AcceptanceReporter<TContext>,
  hooks: ExecutionHooks<TContext> = {},
): ExecutionHooks<TContext> {
  const merged: ExecutionHooks<TContext> = {
    async afterScenario(scenario, context, result) {
      await reporter.recordScenario(scenario, result);
      await hooks.afterScenario?.(scenario, context, result);
    },
  };

  if (hooks.beforeScenario) {
    Object.assign(merged, { beforeScenario: hooks.beforeScenario });
  }

  if (hooks.beforeStep) {
    Object.assign(merged, { beforeStep: hooks.beforeStep });
  }

  if (hooks.afterStep) {
    Object.assign(merged, { afterStep: hooks.afterStep });
  }

  return merged;
}

export function createConsoleReporter<TContext extends object>(
  options: ConsoleReporterOptions<TContext> = {},
): AcceptanceReporter<TContext> {
  const base = createReporter<TContext>();
  const write = options.write ?? ((text: string) => {
    console.log(text);
  });

  return {
    get entries() {
      return base.entries;
    },
    recordScenario(scenario, result) {
      return base.recordScenario(scenario, result);
    },
    buildReport(reportOptions = {}) {
      return base.buildReport({ ...options, ...reportOptions });
    },
    async flush(reportOptions = {}) {
      const report = base.buildReport({ ...options, ...reportOptions });
      await write(formatExecutionRunReport(report));
      return report;
    },
  };
}

export function createJsonReporter<TContext extends object>(
  options: JsonReporterOptions<TContext>,
): AcceptanceReporter<TContext> {
  const base = createReporter<TContext>();

  return {
    get entries() {
      return base.entries;
    },
    recordScenario(scenario, result) {
      return base.recordScenario(scenario, result);
    },
    buildReport(reportOptions = {}) {
      return base.buildReport({ ...options, ...reportOptions });
    },
    async flush(reportOptions = {}) {
      const report = base.buildReport({ ...options, ...reportOptions });
      await writeJsonReport(
        options.outputPath,
        report,
        options.spacing === undefined ? {} : { spacing: options.spacing },
      );
      return report;
    },
  };
}

export function formatStoryReport(report: StoryReport): string {
  const lines = ["Story", `  ${report.title}`, ""];

  for (const scenario of report.scenarios) {
    lines.push("  Scenario");
    lines.push(`    ${scenario.title}`);

    for (const step of scenario.steps) {
      const status = step.status === "passed" ? "✓" : "✗";
      lines.push(`      ${status} ${step.type} ${step.name}`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function formatExecutionRunReport(report: ExecutionRunReport): string {
  const lines = [
    "Execution Report",
    `  Scenarios: ${report.totals.passedScenarioCount}/${report.totals.scenarioCount} passed`,
    `  Steps: ${report.totals.passedStepCount}/${report.totals.stepCount} passed`,
    `  Duration: ${report.totals.duration}ms`,
    "",
  ];

  for (const story of report.stories) {
    lines.push(formatStoryReport(story));
    lines.push("");
  }

  lines.push("Acceptance");
  lines.push(`  Implemented: ${report.traceability.implemented.join(", ") || "none"}`);
  lines.push(`  Missing: ${report.traceability.missing.join(", ") || "none"}`);

  return lines.join("\n").trimEnd();
}
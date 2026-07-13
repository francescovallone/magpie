import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Scenario, ScenarioStep, Story } from "./domain.js";
import type {
  ExecutionAttachment,
  ExecutionHooks,
  ExecutionLogEntry,
  ScenarioExecutionResult,
  SerializedError,
  StepExecutionResult,
} from "./engine.js";
import { slugify } from "./slug.js";
import { writeJsonReport, writeTextFile, type JsonReportWriteOptions } from "./io.js";

/** Tags that mark a scenario as quarantined when no custom tags are configured. */
export const DEFAULT_QUARANTINE_TAGS: ReadonlyArray<string> = Object.freeze(["quarantine"]);

export interface ReportLogEntry {
  readonly timestamp: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface ReportAttachment {
  readonly name: string;
  readonly contentType: string;
  /** Path to the file on disk (inline bodies are written under `attachments.directory` at report-build time). */
  readonly path: string;
}

export interface StepReport {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly lifecycle: string;
  readonly duration: number;
  readonly status: "passed" | "failed" | "skipped";
  readonly error?: string;
  /** Full error (stack when available) regardless of `errors.verbose` — HTML reports show this in a collapsible detail. */
  readonly errorDetail?: string;
  /** Present when log reporting is enabled and the step emitted logs via `api.log`. */
  readonly logs?: ReadonlyArray<ReportLogEntry>;
  /** Present when attachment reporting is enabled and the step emitted attachments via `api.attach`. */
  readonly attachments?: ReadonlyArray<ReportAttachment>;
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
  /** Full error (stack when available) regardless of `errors.verbose` — HTML reports show this in a collapsible detail. */
  readonly errorDetail?: string;
  readonly steps: ReadonlyArray<StepReport>;
  /** Present when log reporting is enabled; scenario-level entries only (step logs live on each step). */
  readonly logs?: ReadonlyArray<ReportLogEntry>;
  /** Present when attachment reporting is enabled; scenario-level entries only (step attachments live on each step). */
  readonly attachments?: ReadonlyArray<ReportAttachment>;
  /** Present when the scenario was retried; total number of attempts executed. */
  readonly attempts?: number;
  /** Present when the scenario carries a quarantine tag; quarantined failures do not fail the run. */
  readonly quarantined?: boolean;
  /** Present when the scenario had more than one "given" step; one report per sub-scenario. */
  readonly subScenarios?: ReadonlyArray<ScenarioReport>;
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
  /**
   * Number of quarantined scenarios. Quarantined scenarios are excluded from
   * both `passedScenarioCount` and `failedScenarioCount`.
   */
  readonly quarantinedScenarioCount: number;
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

export interface ErrorReportingOptions {
  /**
   * When `true`, reports include the full error (stack trace when
   * available). By default only the first line of the error message is
   * reported.
   */
  readonly verbose?: boolean;
}

export interface LogReportingOptions {
  /**
   * When `true`, reports include the logs captured during execution: step
   * logs emitted via `api.log` on each step report, and scenario-level
   * entries on the scenario report. Disabled by default.
   */
  readonly enabled?: boolean;
}

export interface AttachmentReportingOptions {
  /**
   * When `true`, reports include attachments emitted via `api.attach`.
   * Inline bodies are written to `directory` at report-build time; `{ path }`
   * attachments are referenced as-is. Disabled by default.
   */
  readonly enabled?: boolean;
  /**
   * Directory inline attachment bodies are written to. Defaults to
   * `"attachments"` (relative to the process cwd).
   * ponytail: not auto-resolved relative to a reporter's `outputPath` — pass
   * an explicit directory (e.g. based on `path.dirname(outputPath)`) to
   * colocate attachments with a specific report file.
   */
  readonly directory?: string;
}

/** Options that influence how a single scenario report is built. */
export interface ScenarioReportOptions {
  readonly errors?: ErrorReportingOptions;
  readonly logs?: LogReportingOptions;
  readonly attachments?: AttachmentReportingOptions;
  /**
   * Tags that mark a scenario as quarantined. Defaults to
   * `DEFAULT_QUARANTINE_TAGS` (`["quarantine"]`).
   */
  readonly quarantineTags?: ReadonlyArray<string>;
}

export interface ReportBuildOptions<TContext extends object> extends ScenarioReportOptions {
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

export interface HtmlReporterOptions<TContext extends object> extends ReportBuildOptions<TContext> {
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
  const quarantinedScenarioCount = scenarios.filter((scenario) => scenario.quarantined).length;
  const passedScenarioCount = scenarios.filter(
    (scenario) => scenario.status === "passed" && !scenario.quarantined,
  ).length;
  const failedScenarioCount = scenarios.filter(
    (scenario) => scenario.status === "failed" && !scenario.quarantined,
  ).length;

  return {
    scenarioCount: scenarios.length,
    passedScenarioCount,
    failedScenarioCount,
    quarantinedScenarioCount,
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

function formatReportError(error: SerializedError, options?: ErrorReportingOptions): string {
  if (options?.verbose) {
    return error.stack ?? error.message;
  }

  return error.message.split("\n", 1)[0] ?? error.message;
}

/** Full error text (stack when available), independent of `errors.verbose` — always kept for HTML's collapsible detail. */
function formatReportErrorDetail(error: SerializedError): string {
  return error.stack ?? error.message;
}

function toReportLogEntries(
  logs: ReadonlyArray<ExecutionLogEntry>,
): ReadonlyArray<ReportLogEntry> {
  return logs.map((entry) => ({
    timestamp: entry.timestamp,
    message: entry.message,
    ...(entry.data !== undefined ? { data: entry.data } : {}),
  }));
}

function isQuarantined(
  tags: ReadonlyArray<string>,
  quarantineTags: ReadonlyArray<string> = DEFAULT_QUARANTINE_TAGS,
): boolean {
  return tags.some((tag) => quarantineTags.includes(tag));
}

/** ponytail: no size limit/dedup on written attachments; add if reports start bloating a run's output directory. */
function writeAttachmentBody(
  directory: string,
  scenarioId: string,
  stepId: string,
  attachment: ExecutionAttachment,
  index: number,
): string {
  const dotIndex = attachment.name.lastIndexOf(".");
  const ext = dotIndex > 0 ? attachment.name.slice(dotIndex) : "";
  const baseName = dotIndex > 0 ? attachment.name.slice(0, dotIndex) : attachment.name;
  const fileName = `${slugify(scenarioId)}-${slugify(stepId)}-${index}-${slugify(baseName, "attachment")}${ext}`;
  const filePath = join(directory, fileName);

  mkdirSync(directory, { recursive: true });
  writeFileSync(filePath, attachment.body ?? "");

  return filePath;
}

function toReportAttachments(
  scenarioId: string,
  stepId: string,
  attachments: ReadonlyArray<ExecutionAttachment>,
  options?: ScenarioReportOptions,
): ReadonlyArray<ReportAttachment> | undefined {
  if (!options?.attachments?.enabled || attachments.length === 0) {
    return undefined;
  }

  const directory = options.attachments.directory ?? "attachments";

  return attachments.map((attachment, index) => ({
    name: attachment.name,
    contentType: attachment.contentType,
    path: attachment.path ?? writeAttachmentBody(directory, scenarioId, stepId, attachment, index),
  }));
}

function toStepReports(
  scenarioId: string,
  steps: ReadonlyArray<StepExecutionResult>,
  options?: ScenarioReportOptions,
): ReadonlyArray<StepReport> {
  return steps.map((step) => {
    const attachments = toReportAttachments(scenarioId, step.stepId, step.attachments, options);

    return {
      ...(step.error
        ? {
            error: formatReportError(step.error, options?.errors),
            errorDetail: formatReportErrorDetail(step.error),
          }
        : {}),
      ...(options?.logs?.enabled && step.logs.length > 0
        ? { logs: toReportLogEntries(step.logs) }
        : {}),
      ...(attachments ? { attachments } : {}),
      id: step.stepId,
      name: step.stepName,
      type: step.type,
      lifecycle: step.lifecycle,
      duration: step.duration,
      status: step.status,
    };
  });
}

function toSkippedStepReport<TContext extends object>(step: ScenarioStep<TContext>): StepReport {
  return {
    id: step.id,
    name: step.name,
    type: step.type,
    lifecycle: step.lifecycle,
    duration: 0,
    status: "skipped",
  };
}

/**
 * Builds step reports preserving the scenario's full declared shape: steps
 * the engine never ran (those after a failure) are reported as "skipped"
 * instead of being omitted, in declaration order. Executed steps whose id is
 * not in the declared list (defensive) are appended at the end.
 */
function buildStepReports<TContext extends object>(
  scenarioId: string,
  declaredSteps: ReadonlyArray<ScenarioStep<TContext>>,
  executedSteps: ReadonlyArray<StepExecutionResult>,
  options?: ScenarioReportOptions,
): ReadonlyArray<StepReport> {
  const executedReports = toStepReports(scenarioId, executedSteps, options);
  const executedById = new Map(executedReports.map((report) => [report.id, report]));
  const declaredIds = new Set(declaredSteps.map((step) => step.id));

  return [
    ...declaredSteps.map((step) => executedById.get(step.id) ?? toSkippedStepReport(step)),
    ...executedReports.filter((report) => !declaredIds.has(report.id)),
  ];
}

/**
 * Resolves the acceptance criteria ids satisfied by a scenario for
 * traceability purposes. When the scenario has sub-scenarios (more than one
 * "given" step), the granular sub-scenario ids (e.g. `AC-001-01`) are used
 * instead of the parent scenario's own acceptance ids.
 */
export function resolveAcceptanceIds<TContext extends object>(
  scenario: Scenario<TContext>,
): ReadonlyArray<string> {
  if (scenario.subScenarios && scenario.subScenarios.length > 0) {
    return scenario.subScenarios.flatMap((subScenario) => subScenario.acceptance);
  }

  return scenario.acceptance;
}

export function createScenarioReport<TContext extends object>(
  scenario: Scenario<TContext>,
  result: ScenarioExecutionResult<TContext>,
  options?: ScenarioReportOptions,
): ScenarioReport {
  const cleanupSteps = scenario.steps.filter((step) => step.lifecycle === "cleanup");
  const subStepReports = (result.subScenarios ?? []).map((subResult) => {
    const subScenario = scenario.subScenarios?.find(
      (candidate) => candidate.id === subResult.subScenarioId,
    );

    return subScenario
      ? buildStepReports(scenario.id, [...subScenario.steps, ...cleanupSteps], subResult.steps, options)
      : toStepReports(scenario.id, subResult.steps, options);
  });

  const report: ScenarioReport = {
    id: scenario.id,
    title: scenario.title,
    acceptance: scenario.acceptance,
    tags: scenario.tags,
    duration: result.duration,
    status: result.success ? "passed" : "failed",
    steps:
      subStepReports.length > 0
        ? subStepReports.flat()
        : buildStepReports(scenario.id, scenario.steps, result.steps, options),
  };

  if (scenario.story?.title !== undefined) {
    Object.assign(report, { story: scenario.story.title });
  }

  if (result.failure !== undefined) {
    Object.assign(report, {
      error: formatReportError(result.failure.error, options?.errors),
      errorDetail: formatReportErrorDetail(result.failure.error),
    });
  }

  if (options?.logs?.enabled) {
    const scenarioLogs = result.logs.filter((entry) => entry.stepId === undefined);

    if (scenarioLogs.length > 0) {
      Object.assign(report, { logs: toReportLogEntries(scenarioLogs) });
    }
  }

  if (options?.attachments?.enabled) {
    const scenarioAttachments = result.attachments.filter((entry) => entry.stepId === undefined);
    const attachments = toReportAttachments(scenario.id, "scenario", scenarioAttachments, options);

    if (attachments) {
      Object.assign(report, { attachments });
    }
  }

  if (result.attempts !== undefined) {
    Object.assign(report, { attempts: result.attempts });
  }

  if (isQuarantined(scenario.tags, options?.quarantineTags)) {
    Object.assign(report, { quarantined: true });
  }

  if (result.subScenarios && result.subScenarios.length > 0) {
    Object.assign(report, {
      subScenarios: result.subScenarios.map((subResult, subIndex) => {
        const subReport: ScenarioReport = {
          id: subResult.subScenarioId,
          title: `${scenario.title} \u2013 ${subResult.subScenarioId}`,
          acceptance: subResult.acceptance,
          tags: scenario.tags,
          duration: subResult.duration,
          status: subResult.success ? "passed" : "failed",
          steps: subStepReports[subIndex] ?? toStepReports(scenario.id, subResult.steps, options),
        };

        if (scenario.story?.title !== undefined) {
          Object.assign(subReport, { story: scenario.story.title });
        }

        if (subResult.failure !== undefined) {
          Object.assign(subReport, {
            error: formatReportError(subResult.failure.error, options?.errors),
            errorDetail: formatReportErrorDetail(subResult.failure.error),
          });
        }

        if (subResult.attempts !== undefined) {
          Object.assign(subReport, { attempts: subResult.attempts });
        }

        return subReport;
      }),
    });
  }

  return report;
}

export function createStoryReport<TContext extends object>(
  story: Story<TContext>,
  results: ReadonlyArray<ScenarioExecutionResult<TContext>>,
  options?: ScenarioReportOptions,
): StoryReport {
  const byId = new Map(results.map((result) => [result.scenarioId, result]));

  const report: StoryReport = {
    title: story.title,
    scenarios: story.scenarios.flatMap((scenario) => {
      const result = byId.get(scenario.id);
      return result ? [createScenarioReport(scenario, result, options)] : [];
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
  const implemented = Array.from(
    new Set(scenarios.flatMap((scenario) => resolveAcceptanceIds(scenario))),
  ).sort();
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
      acceptance: resolveAcceptanceIds(record.scenario),
      tags: record.scenario.tags,
    },
    report: createScenarioReport(record.scenario, record.result, options),
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
  const scenarios = Object.freeze(
    records.map((record) => {
      const report = record.report;

      if (report.quarantined === undefined && isQuarantined(report.tags, options.quarantineTags)) {
        return { ...report, quarantined: true };
      }

      return report;
    }),
  );
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

export async function writeHtmlReport(outputPath: string, report: ExecutionRunReport): Promise<void> {
  await writeTextFile(outputPath, formatExecutionRunReportAsHtml(report));
}

export function createHtmlReporter<TContext extends object>(
  options: HtmlReporterOptions<TContext>,
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
      await writeHtmlReport(options.outputPath, report);
      return report;
    },
  };
}

function formatLogData(data: unknown): string {
  try {
    return JSON.stringify(data) ?? String(data);
  } catch {
    return String(data);
  }
}

function formatScenarioSteps(steps: ReadonlyArray<StepReport>, indent: string): string {
  const lines: Array<string> = [];

  for (const step of steps) {
    const status = step.status === "passed" ? "✓" : step.status === "skipped" ? "○" : "✗";
    lines.push(`${indent}${status} ${step.type} ${step.name}`);

    if (step.error) {
      lines.push(`${indent}  ↳ ${step.error}`);
    }

    for (const entry of step.logs ?? []) {
      const data = entry.data !== undefined ? ` ${formatLogData(entry.data)}` : "";
      lines.push(`${indent}  · ${entry.message}${data}`);
    }

    for (const attachment of step.attachments ?? []) {
      lines.push(`${indent}  📎 ${attachment.name} (${attachment.path})`);
    }
  }

  return lines.join("\n");
}

function formatScenarioTitleSuffix(scenario: ScenarioReport): string {
  const parts: Array<string> = [];

  if (scenario.quarantined) {
    parts.push("quarantined");
  }

  if (scenario.attempts !== undefined) {
    parts.push(`attempts: ${scenario.attempts}`);
  }

  return parts.length > 0 ? ` [${parts.join(", ")}]` : "";
}

export function formatStoryReport(report: StoryReport): string {
  const lines = ["Story", `  ${report.title}`, ""];

  for (const scenario of report.scenarios) {
    lines.push("  Scenario");
    lines.push(`    ${scenario.title}${formatScenarioTitleSuffix(scenario)}`);

    if (scenario.subScenarios && scenario.subScenarios.length > 0) {
      lines.push("    Sub-scenarios");

      for (const subScenario of scenario.subScenarios) {
        lines.push(`      ${subScenario.acceptance.join(", ")}`);
        lines.push(formatScenarioSteps(subScenario.steps, "        "));
      }
    } else {
      lines.push(formatScenarioSteps(scenario.steps, "      "));
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function formatExecutionRunReport(report: ExecutionRunReport): string {
  const lines = [
    "Execution Report",
    `  Scenarios: ${report.totals.passedScenarioCount}/${report.totals.scenarioCount} passed`,
    ...(report.totals.quarantinedScenarioCount > 0
      ? [`  Quarantined: ${report.totals.quarantinedScenarioCount}`]
      : []),
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stepStatusIcon(status: StepReport["status"]): string {
  if (status === "passed") {
    return "✓";
  }

  return status === "skipped" ? "○" : "✗";
}

/** Error markup for HTML reports: the one-liner plus, when there's more, a native `<details>` with the full stack. */
function renderErrorHtml(error?: string, errorDetail?: string): string {
  if (!error) {
    return "";
  }

  const detailHtml =
    errorDetail && errorDetail !== error
      ? `<details class="error-detail"><summary>Full error</summary><pre>${escapeHtml(errorDetail)}</pre></details>`
      : "";

  return `<p class="error">↳ ${escapeHtml(error)}</p>${detailHtml}`;
}

function renderAttachmentHtml(attachment: ReportAttachment): string {
  const href = escapeHtml(attachment.path);

  if (attachment.contentType.startsWith("image/")) {
    return `<a href="${href}" target="_blank"><img class="attachment-image" src="${href}" alt="${escapeHtml(attachment.name)}" /></a>`;
  }

  return `<a class="attachment-link" href="${href}" download>${escapeHtml(attachment.name)}</a>`;
}

function renderStepsHtml(steps: ReadonlyArray<StepReport>): string {
  return steps
    .map((step) => {
      const errorHtml = renderErrorHtml(step.error, step.errorDetail);
      const logsHtml = step.logs?.length
        ? `<ul class="logs">${step.logs
            .map((entry) => {
              const data = entry.data !== undefined ? ` ${formatLogData(entry.data)}` : "";
              return `<li>${escapeHtml(`${entry.message}${data}`)}</li>`;
            })
            .join("")}</ul>`
        : "";
      const attachmentsHtml = step.attachments?.length
        ? `<div class="attachments">${step.attachments.map(renderAttachmentHtml).join("")}</div>`
        : "";

      return `
        <li class="step step-${step.status}">
          <span class="icon">${stepStatusIcon(step.status)}</span>
          <span class="step-label">${escapeHtml(step.type)} ${escapeHtml(step.name)}</span>
          ${errorHtml}${logsHtml}${attachmentsHtml}
        </li>`;
    })
    .join("");
}

function renderSubScenarioHtml(subScenario: ScenarioReport): string {
  return `
        <article class="sub-scenario sub-scenario-${subScenario.status}">
          <h4>${escapeHtml(subScenario.acceptance.join(", "))}</h4>
          <ul class="steps">${renderStepsHtml(subScenario.steps)}
          </ul>
        </article>`;
}

function renderScenarioHtml(scenario: ScenarioReport): string {
  const hasSubScenarios = scenario.subScenarios && scenario.subScenarios.length > 0;
  const stepsHtml = hasSubScenarios ? "" : `<ul class="steps">${renderStepsHtml(scenario.steps)}
      </ul>`;
  const subScenariosHtml = hasSubScenarios
    ? `
      <div class="sub-scenarios">
        <h4>Sub-scenarios</h4>
        ${(scenario.subScenarios ?? []).map(renderSubScenarioHtml).join("")}
      </div>`
    : "";

  const badges = [
    ...(scenario.quarantined ? [`<span class="badge badge-quarantined">quarantined</span>`] : []),
    ...(scenario.attempts !== undefined
      ? [`<span class="badge badge-attempts">attempts: ${scenario.attempts}</span>`]
      : []),
  ].join(" ");

  return `
    <article class="scenario scenario-${scenario.status}${scenario.quarantined ? " scenario-quarantined" : ""}">
      <h3>${escapeHtml(scenario.title)} - ${escapeHtml(scenario.acceptance.join(", "))}${badges ? ` ${badges}` : ""}</h3>${stepsHtml}${subScenariosHtml}
    </article>`;
}

function renderStoryHtml(story: StoryReport): string {
  const scenariosHtml = story.scenarios.map(renderScenarioHtml).join("");

  return `
  <section class="story">
    <h2>${escapeHtml(story.title)}</h2>
    ${scenariosHtml}
  </section>`;
}

export function formatExecutionRunReportAsHtml(report: ExecutionRunReport): string {
  const storiesHtml = report.stories.map(renderStoryHtml).join("");
  const implemented = report.traceability.implemented.join(", ") || "none";
  const missing = report.traceability.missing.join(", ") || "none";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Magpie Execution Report</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; background: #fafafa; }
    h1 { margin-bottom: 0.25rem; }
    .summary { display: flex; gap: 1.5rem; margin-bottom: 1.5rem; color: #444; }
    .story { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
    .scenario { border-top: 1px solid #eee; padding-top: 0.75rem; margin-top: 0.75rem; }
    .scenario:first-of-type { border-top: none; margin-top: 0; }
    .scenario h3 { margin: 0 0 0.5rem; }
    .scenario-failed h3 { color: #b00020; }
    .scenario-passed h3 { color: #1b5e20; }
    .sub-scenarios { margin-top: 0.75rem; }
    .sub-scenarios > h4 { margin: 0 0 0.5rem; font-size: 0.95rem; color: #444; }
    .sub-scenario { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 0.5rem; }
    .sub-scenario h4 { margin: 0 0 0.5rem; font-size: 0.9rem; color: #555; }
    ul.steps { list-style: none; margin: 0; padding: 0; }
    li.step { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; padding: 0.15rem 0; }
    li.step-passed .icon { color: #1b5e20; }
    li.step-failed .icon { color: #b00020; }
    li.step-skipped .icon { color: #9e9e9e; }
    .error { flex-basis: 100%; margin: 0.1rem 0 0.25rem 1.75rem; color: #b00020; }
    .error-detail { flex-basis: 100%; margin: 0 0 0.25rem 1.75rem; }
    .error-detail summary { cursor: pointer; color: #b00020; font-size: 0.85rem; }
    .error-detail pre { margin: 0.25rem 0 0; padding: 0.5rem; background: #fff5f5; border: 1px solid #f3c9c9; border-radius: 4px; font-size: 0.8rem; overflow-x: auto; white-space: pre-wrap; }
    ul.logs { flex-basis: 100%; list-style: none; margin: 0.1rem 0 0.25rem 1.75rem; padding: 0; color: #666; font-size: 0.85rem; }
    ul.logs li::before { content: "· "; }
    .attachments { flex-basis: 100%; margin: 0.25rem 0 0.25rem 1.75rem; display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .attachment-image { max-width: 200px; max-height: 150px; border: 1px solid #ddd; border-radius: 4px; }
    .attachment-link { font-size: 0.85rem; }
    .badge { display: inline-block; font-size: 0.7rem; font-weight: 600; border-radius: 999px; padding: 0.1rem 0.5rem; vertical-align: middle; }
    .badge-quarantined { background: #fff3cd; color: #8a6d00; border: 1px solid #ffe08a; }
    .badge-attempts { background: #e3f2fd; color: #0d47a1; border: 1px solid #bbdefb; }
    .scenario-quarantined h3 { color: #8a6d00; }
    .acceptance { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1rem 1.25rem; }
  </style>
</head>
<body>
  <h1>Magpie Execution Report</h1>
  <div class="summary">
    <span>Scenarios: ${report.totals.passedScenarioCount}/${report.totals.scenarioCount} passed</span>${
      report.totals.quarantinedScenarioCount > 0
        ? `
    <span>Quarantined: ${report.totals.quarantinedScenarioCount}</span>`
        : ""
    }
    <span>Steps: ${report.totals.passedStepCount}/${report.totals.stepCount} passed</span>
    <span>Duration: ${report.totals.duration}ms</span>
  </div>
  ${storiesHtml}
  <section class="acceptance">
    <h2>Acceptance</h2>
    <p>Implemented: ${escapeHtml(implemented)}</p>
    <p>Missing: ${escapeHtml(missing)}</p>
  </section>
</body>
</html>
`;
}
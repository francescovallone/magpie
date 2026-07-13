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
import { writeJsonReport, type JsonReportWriteOptions } from "./io.js";

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

export interface ConsoleReporterOptions<
  TContext extends object,
> extends ReportBuildOptions<TContext> {
  readonly write?: (text: string) => Promise<void> | void;
}

export interface JsonReporterOptions<TContext extends object>
  extends ReportBuildOptions<TContext>, JsonReportWriteOptions {
  readonly outputPath: string;
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

function toReportLogEntries(logs: ReadonlyArray<ExecutionLogEntry>): ReadonlyArray<ReportLogEntry> {
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
      ? buildStepReports(
          scenario.id,
          [...subScenario.steps, ...cleanupSteps],
          subResult.steps,
          options,
        )
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
      ...(record.scenario.description !== undefined
        ? { description: record.scenario.description }
        : {}),
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
            story.scenarios.flatMap((scenario) =>
              scenarios.filter((candidate) => candidate.id === scenario.id),
            ),
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
          (acceptanceId) =>
            !records.some((record) => record.scenario.acceptance.includes(acceptanceId)),
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
  const write =
    options.write ??
    ((text: string) => {
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

/** @internal Shared by the text and HTML formatters. */
export function formatLogData(data: unknown): string {
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

import type { Scenario, Story } from "./domain.js";
import type { ExecutionHooks, ScenarioExecutionResult, StepExecutionResult } from "./engine.js";
import { writeJsonReport, writeTextFile, type JsonReportWriteOptions } from "./io.js";

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

function toStepReports(steps: ReadonlyArray<StepExecutionResult>): ReadonlyArray<StepReport> {
  return steps.map((step) => ({
    ...(step.error ? { error: step.error.message } : {}),
    id: step.stepId,
    name: step.stepName,
    type: step.type,
    lifecycle: step.lifecycle,
    duration: step.duration,
    status: step.status,
  }));
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
): ScenarioReport {
  const report: ScenarioReport = {
    id: scenario.id,
    title: scenario.title,
    acceptance: scenario.acceptance,
    tags: scenario.tags,
    duration: result.duration,
    status: result.success ? "passed" : "failed",
    steps: toStepReports(result.steps),
  };

  if (scenario.story?.title !== undefined) {
    Object.assign(report, { story: scenario.story.title });
  }

  if (result.failure?.error.message !== undefined) {
    Object.assign(report, { error: result.failure.error.message });
  }

  if (result.subScenarios && result.subScenarios.length > 0) {
    Object.assign(report, {
      subScenarios: result.subScenarios.map((subResult) => {
        const subReport: ScenarioReport = {
          id: subResult.subScenarioId,
          title: `${scenario.title} \u2013 ${subResult.subScenarioId}`,
          acceptance: subResult.acceptance,
          tags: scenario.tags,
          duration: subResult.duration,
          status: subResult.success ? "passed" : "failed",
          steps: toStepReports(subResult.steps),
        };

        if (scenario.story?.title !== undefined) {
          Object.assign(subReport, { story: scenario.story.title });
        }

        if (subResult.failure?.error.message !== undefined) {
          Object.assign(subReport, { error: subResult.failure.error.message });
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

export function formatStoryReport(report: StoryReport): string {
  const lines = ["Story", `  ${report.title}`, ""];

  for (const scenario of report.scenarios) {
    lines.push("  Scenario");
    lines.push(`    ${scenario.title}`);

    for (const step of scenario.steps) {
      const status = step.status === "passed" ? "✓" : step.status === "skipped" ? "○" : "✗";
      lines.push(`      ${status} ${step.type} ${step.name}`);

      if (step.error) {
        lines.push(`        ↳ ${step.error}`);
      }
    }

    for (const subScenario of scenario.subScenarios ?? []) {
      lines.push(`    Sub-scenario ${subScenario.acceptance.join(", ")}`);

      for (const step of subScenario.steps) {
        const status = step.status === "passed" ? "✓" : step.status === "skipped" ? "○" : "✗";
        lines.push(`        ${status} ${step.type} ${step.name}`);

        if (step.error) {
          lines.push(`          ↳ ${step.error}`);
        }
      }
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

function renderStepsHtml(steps: ReadonlyArray<StepReport>): string {
  return steps
    .map((step) => {
      const errorHtml = step.error
        ? `<p class="error">↳ ${escapeHtml(step.error)}</p>`
        : "";

      return `
        <li class="step step-${step.status}">
          <span class="icon">${stepStatusIcon(step.status)}</span>
          <span class="step-label">${escapeHtml(step.type)} ${escapeHtml(step.name)}</span>
          ${errorHtml}
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
  const stepsHtml = renderStepsHtml(scenario.steps);
  const subScenariosHtml = (scenario.subScenarios ?? []).map(renderSubScenarioHtml).join("");

  return `
    <article class="scenario scenario-${scenario.status}">
      <h3>${escapeHtml(scenario.title)}</h3>
      <ul class="steps">${stepsHtml}
      </ul>${subScenariosHtml}
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
    ul.steps { list-style: none; margin: 0; padding: 0; }
    li.step { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; padding: 0.15rem 0; }
    li.step-passed .icon { color: #1b5e20; }
    li.step-failed .icon { color: #b00020; }
    li.step-skipped .icon { color: #9e9e9e; }
    .error { flex-basis: 100%; margin: 0.1rem 0 0.25rem 1.75rem; color: #b00020; }
    .acceptance { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1rem 1.25rem; }
  </style>
</head>
<body>
  <h1>Magpie Execution Report</h1>
  <div class="summary">
    <span>Scenarios: ${report.totals.passedScenarioCount}/${report.totals.scenarioCount} passed</span>
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
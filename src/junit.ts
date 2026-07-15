import { writeTextFile } from "./io.js";
import {
  createReporter,
  type AcceptanceReporter,
  type ExecutionRunReport,
  type ReportBuildOptions,
  type ScenarioReport,
  type StoryReport,
} from "./reporting.js";

export interface JUnitReporterOptions<
  TContext extends object,
> extends ReportBuildOptions<TContext> {
  readonly outputPath: string;
  /** Name of the root `<testsuites>` element. Defaults to `"magpie"`. */
  readonly suiteName?: string;
}

export interface JUnitFormatOptions {
  /** Name of the root `<testsuites>` element. Defaults to `"magpie"`. */
  readonly suiteName?: string;
}

const XML_INVALID_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(XML_INVALID_CHARACTERS, "");
}

function toSeconds(durationMs: number): string {
  return (durationMs / 1000).toFixed(3);
}

interface SuiteCounts {
  readonly tests: number;
  readonly failures: number;
  readonly skipped: number;
}

function countScenarios(scenarios: ReadonlyArray<ScenarioReport>): SuiteCounts {
  let failures = 0;
  let skipped = 0;

  for (const scenario of scenarios) {
    if (scenario.status === "skipped" || (scenario.quarantined && scenario.status === "failed")) {
      skipped += 1;
    } else if (scenario.status === "failed") {
      failures += 1;
    }
  }

  return { tests: scenarios.length, failures, skipped };
}

/** `[[ATTACHMENT|path]]` in `<system-out>` — the convention Jenkins/GitLab already parse into report attachments. */
function renderAttachmentsSystemOut(scenario: ScenarioReport): string {
  const attachments = scenario.steps.flatMap((step) => step.attachments ?? []);

  if (attachments.length === 0) {
    return "";
  }

  const lines = attachments.map((attachment) => `[[ATTACHMENT|${attachment.path}]]`).join("\n");

  return `\n      <system-out>${escapeXml(lines)}</system-out>`;
}

function renderTestCase(scenario: ScenarioReport, storyTitle: string): string {
  const attributes = `classname="${escapeXml(storyTitle)}" name="${escapeXml(scenario.title)}" time="${toSeconds(scenario.duration)}"`;
  const systemOut = renderAttachmentsSystemOut(scenario);

  if (scenario.status === "skipped") {
    return `    <testcase ${attributes}>\n      <skipped/>${systemOut}\n    </testcase>`;
  }

  if (scenario.quarantined && scenario.status === "failed") {
    return `    <testcase ${attributes}>\n      <skipped message="quarantined: failed but excluded from the run result"/>${systemOut}\n    </testcase>`;
  }

  if (scenario.status === "failed") {
    const failedStep = scenario.steps.find((step) => step.status === "failed");
    const message = scenario.error ?? "Scenario failed";
    const body = failedStep
      ? `Failed step: ${failedStep.type} ${failedStep.name}\n${failedStep.error ?? message}`
      : message;

    return `    <testcase ${attributes}>\n      <failure message="${escapeXml(message)}">${escapeXml(body)}</failure>${systemOut}\n    </testcase>`;
  }

  if (systemOut) {
    return `    <testcase ${attributes}>${systemOut}\n    </testcase>`;
  }

  return `    <testcase ${attributes}/>`;
}

function renderTestSuite(story: StoryReport, generatedAt: number): string {
  const counts = countScenarios(story.scenarios);
  const duration = story.scenarios.reduce((total, scenario) => total + scenario.duration, 0);
  const testCases = story.scenarios
    .map((scenario) => renderTestCase(scenario, story.title))
    .join("\n");

  return (
    `  <testsuite name="${escapeXml(story.title)}" tests="${counts.tests}" failures="${counts.failures}" errors="0" skipped="${counts.skipped}" time="${toSeconds(duration)}" timestamp="${new Date(generatedAt).toISOString()}">\n` +
    `${testCases}\n` +
    "  </testsuite>"
  );
}

/**
 * Renders an execution run report as JUnit XML, the format consumed by the
 * test-result panes of Jenkins, GitLab, Azure DevOps, Buildkite, and most
 * other CI systems. One `<testsuite>` per story, one `<testcase>` per
 * scenario; failed quarantined scenarios are reported as skipped so they do
 * not fail the CI stage.
 */
export function formatExecutionRunReportAsJUnitXml(
  report: ExecutionRunReport,
  options: JUnitFormatOptions = {},
): string {
  const suiteName = options.suiteName ?? "magpie";
  const allScenarios = report.stories.flatMap((story) => story.scenarios);
  const counts = countScenarios(allScenarios);
  const suites = report.stories
    .map((story) => renderTestSuite(story, report.generatedAt))
    .join("\n");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<testsuites name="${escapeXml(suiteName)}" tests="${counts.tests}" failures="${counts.failures}" errors="0" skipped="${counts.skipped}" time="${toSeconds(report.totals.duration)}">\n` +
    `${suites}\n` +
    "</testsuites>\n"
  );
}

export async function writeJUnitReport(
  outputPath: string,
  report: ExecutionRunReport,
  options: JUnitFormatOptions = {},
): Promise<void> {
  await writeTextFile(outputPath, formatExecutionRunReportAsJUnitXml(report, options));
}

/** Drop-in equivalent of `createJsonReporter` that writes JUnit XML on `flush()`. */
export function createJUnitReporter<TContext extends object>(
  options: JUnitReporterOptions<TContext>,
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
      await writeJUnitReport(
        options.outputPath,
        report,
        options.suiteName === undefined ? {} : { suiteName: options.suiteName },
      );
      return report;
    },
  };
}

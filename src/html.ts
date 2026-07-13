import { writeTextFile } from "./io.js";
import {
  createReporter,
  formatLogData,
  type AcceptanceReporter,
  type ExecutionRunReport,
  type ReportAttachment,
  type ReportBuildOptions,
  type ScenarioReport,
  type StepReport,
  type StoryReport,
} from "./reporting.js";

export interface HtmlReporterOptions<TContext extends object> extends ReportBuildOptions<TContext> {
  readonly outputPath: string;
}

export async function writeHtmlReport(
  outputPath: string,
  report: ExecutionRunReport,
): Promise<void> {
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
  const stepsHtml = hasSubScenarios
    ? ""
    : `<ul class="steps">${renderStepsHtml(scenario.steps)}
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

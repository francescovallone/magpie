import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createConsoleReporter,
  createHtmlReporter,
  createJsonReporter,
  createReportingHooks,
  createReporter,
  defineAcceptanceScenario,
  defineStory,
  executeScenario,
  formatExecutionRunReport,
  formatExecutionRunReportAsHtml,
  registerScenario,
} from "../src/index.js";

describe("reporter", () => {
  it("prints the failing step's error message in the formatted report", async () => {
    const reporter = createReporter<{ response?: { status: number } }>();
    const scenario = defineAcceptanceScenario<{ response?: { status: number } }>({
      id: "auth-login",
      title: "Registered user logs in",
      acceptance: ["AUTH-001"],
      story: { title: "Authentication" },
      steps: [
        {
          id: "given-user",
          name: "registered user exists",
          type: "given",
          execute: (context) => {
            context.response = { status: 401 };
          },
        },
        {
          id: "then-token",
          name: "token is returned",
          type: "then",
          execute: (context) => {
            if (context.response?.status !== 200) {
              throw new Error("Expected a successful login");
            }
          },
        },
      ],
    });

    const result = await executeScenario(scenario);
    reporter.recordScenario(scenario, result);

    const report = reporter.buildReport({ now: () => 0 });
    const output = formatExecutionRunReport(report);

    expect(result.success).toBe(false);
    expect(output).toContain("✗ then token is returned");
    expect(output).toContain("↳ Expected a successful login");
  });

  it("reports only the first line of an error message by default", async () => {
    const reporter = createReporter<Record<string, unknown>>();
    const scenario = defineAcceptanceScenario<Record<string, unknown>>({
      id: "multi-line-error",
      title: "Failure with a multi-line error",
      acceptance: ["ERR-001"],
      steps: [
        {
          id: "then-fails",
          name: "step fails verbosely",
          type: "then",
          execute: () => {
            throw new Error("Expected 200\nReceived 500\nat request pipeline");
          },
        },
      ],
    });

    const result = await executeScenario(scenario);
    reporter.recordScenario(scenario, result);

    const report = reporter.buildReport({ now: () => 0 });

    expect(report.scenarios[0]?.error).toBe("Expected 200");
    expect(report.scenarios[0]?.steps.at(-1)?.error).toBe("Expected 200");
  });

  it("reports the full error when errors.verbose is enabled", async () => {
    const reporter = createReporter<Record<string, unknown>>();
    const scenario = defineAcceptanceScenario<Record<string, unknown>>({
      id: "verbose-error",
      title: "Failure reported verbosely",
      acceptance: ["ERR-002"],
      steps: [
        {
          id: "then-fails",
          name: "step fails verbosely",
          type: "then",
          execute: () => {
            throw new Error("Expected 200\nReceived 500");
          },
        },
      ],
    });

    const result = await executeScenario(scenario);
    reporter.recordScenario(scenario, result);

    const report = reporter.buildReport({ errors: { verbose: true }, now: () => 0 });
    const scenarioError = report.scenarios[0]?.error ?? "";

    expect(scenarioError).toContain("Expected 200");
    expect(scenarioError).toContain("Received 500");
    // The stack trace is included when available.
    expect(scenarioError).toContain("at ");
    expect(report.scenarios[0]?.steps.at(-1)?.error).toBe(scenarioError);
  });

  it("includes step and scenario logs only when logs.enabled is set", async () => {
    const reporter = createReporter<Record<string, unknown>>();
    const scenario = defineAcceptanceScenario<Record<string, unknown>>({
      id: "logged",
      title: "Scenario with logs",
      acceptance: ["LOG-001"],
      steps: [
        {
          id: "when-logs",
          name: "step emits logs",
          type: "when",
          execute: (_context, api) => {
            api.log("fetching token", { url: "https://example.test" });
            api.log("token received");
          },
        },
      ],
    });

    const result = await executeScenario(scenario);
    reporter.recordScenario(scenario, result);

    const defaultReport = reporter.buildReport({ now: () => 0 });
    expect(defaultReport.scenarios[0]?.logs).toBeUndefined();
    expect(defaultReport.scenarios[0]?.steps[0]?.logs).toBeUndefined();

    const verboseReport = reporter.buildReport({ logs: { enabled: true }, now: () => 0 });
    const stepLogs = verboseReport.scenarios[0]?.steps[0]?.logs;

    expect(stepLogs?.map((entry) => entry.message)).toEqual(["fetching token", "token received"]);
    expect(stepLogs?.[0]?.data).toEqual({ url: "https://example.test" });
    // Scenario-level logs hold engine lifecycle entries (no stepId), not step logs.
    expect(verboseReport.scenarios[0]?.logs?.map((entry) => entry.message)).toEqual([
      "scenario.started",
      "scenario.finished",
    ]);

    const output = formatExecutionRunReport(verboseReport);
    expect(output).toContain('· fetching token {"url":"https://example.test"}');
    expect(output).toContain("· token received");

    const html = formatExecutionRunReportAsHtml(verboseReport);
    expect(html).toContain("fetching token");
  });

  it("writes inline attachment bodies to disk and reports name/contentType/path", async () => {
    const reporter = createReporter<Record<string, unknown>>();
    const scenario = defineAcceptanceScenario<Record<string, unknown>>({
      id: "attached",
      title: "Scenario with attachments",
      acceptance: ["ATT-001"],
      steps: [
        {
          id: "when-attach",
          name: "step emits an attachment",
          type: "when",
          execute: (_context, api) => {
            api.attach("screenshot.png", Buffer.from("fake-png-bytes"));
            api.attach("notes.txt", "plain text body", "text/plain");
          },
        },
      ],
    });

    const result = await executeScenario(scenario);
    reporter.recordScenario(scenario, result);

    const defaultReport = reporter.buildReport({ now: () => 0 });
    expect(defaultReport.scenarios[0]?.steps[0]?.attachments).toBeUndefined();

    const directory = join(tmpdir(), `magpie-attachments-${Date.now()}`);
    const report = reporter.buildReport({
      attachments: { enabled: true, directory },
      now: () => 0,
    });
    const attachments = report.scenarios[0]?.steps[0]?.attachments ?? [];

    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({ name: "screenshot.png", contentType: "image/png" });
    expect(attachments[1]).toMatchObject({ name: "notes.txt", contentType: "text/plain" });

    const written = await readFile(attachments[1]!.path, "utf8");
    expect(written).toBe("plain text body");

    const output = formatExecutionRunReport(report);
    expect(output).toContain(`📎 screenshot.png (${attachments[0]!.path})`);

    const html = formatExecutionRunReportAsHtml(report);
    expect(html).toContain(`<img class="attachment-image"`);
    expect(html).toContain(`class="attachment-link"`);
  });

  it("marks quarantined scenarios and excludes them from pass/fail totals", async () => {
    const reporter = createReporter<Record<string, unknown>>();
    const quarantined = defineAcceptanceScenario<Record<string, unknown>>({
      id: "flaky-checkout",
      title: "Flaky checkout",
      acceptance: ["Q-001"],
      tags: ["quarantine"],
      steps: [
        {
          id: "then-fails",
          name: "fails for now",
          type: "then",
          execute: () => {
            throw new Error("known flake");
          },
        },
      ],
    });
    const healthy = defineAcceptanceScenario<Record<string, unknown>>({
      id: "healthy",
      title: "Healthy scenario",
      acceptance: ["Q-002"],
      steps: [{ id: "then-passes", name: "passes", type: "then", execute: () => undefined }],
    });

    reporter.recordScenario(quarantined, await executeScenario(quarantined));
    reporter.recordScenario(healthy, await executeScenario(healthy));

    const report = reporter.buildReport({ now: () => 0 });

    expect(report.scenarios[0]?.quarantined).toBe(true);
    expect(report.scenarios[0]?.status).toBe("failed");
    expect(report.scenarios[1]?.quarantined).toBeUndefined();
    expect(report.totals.scenarioCount).toBe(2);
    expect(report.totals.passedScenarioCount).toBe(1);
    expect(report.totals.failedScenarioCount).toBe(0);
    expect(report.totals.quarantinedScenarioCount).toBe(1);

    const output = formatExecutionRunReport(report);
    expect(output).toContain("Quarantined: 1");
    expect(output).toContain("Flaky checkout [quarantined]");
  });

  it("honors custom quarantine tags", async () => {
    const reporter = createReporter<Record<string, unknown>>();
    const scenario = defineAcceptanceScenario<Record<string, unknown>>({
      id: "custom-tag",
      title: "Custom quarantine tag",
      tags: ["known-flaky"],
      steps: [
        {
          id: "then-fails",
          name: "fails",
          type: "then",
          execute: () => {
            throw new Error("flake");
          },
        },
      ],
    });

    reporter.recordScenario(scenario, await executeScenario(scenario));

    const defaultReport = reporter.buildReport({ now: () => 0 });
    expect(defaultReport.scenarios[0]?.quarantined).toBeUndefined();
    expect(defaultReport.totals.failedScenarioCount).toBe(1);

    const customReport = reporter.buildReport({ quarantineTags: ["known-flaky"], now: () => 0 });
    expect(customReport.scenarios[0]?.quarantined).toBe(true);
    expect(customReport.totals.failedScenarioCount).toBe(0);
    expect(customReport.totals.quarantinedScenarioCount).toBe(1);
  });

  it("reports the attempt count for retried scenarios", async () => {
    const reporter = createReporter<Record<string, unknown>>();
    let executions = 0;
    const scenario = defineAcceptanceScenario<Record<string, unknown>>({
      id: "retried",
      title: "Retried scenario",
      retries: 1,
      steps: [
        {
          id: "then-flaky",
          name: "passes on retry",
          type: "then",
          execute: () => {
            executions += 1;
            if (executions === 1) {
              throw new Error("first attempt fails");
            }
          },
        },
      ],
    });

    reporter.recordScenario(scenario, await executeScenario(scenario));

    const report = reporter.buildReport({ now: () => 0 });
    expect(report.scenarios[0]?.status).toBe("passed");
    expect(report.scenarios[0]?.attempts).toBe(2);

    const output = formatExecutionRunReport(report);
    expect(output).toContain("Retried scenario [attempts: 2]");
  });

  it("reports sub-scenarios and their granular acceptance ids in traceability", async () => {
    const reporter = createReporter<{ value?: number }>();
    const subject = defineAcceptanceScenario<{ value?: number }>({
      id: "checkout",
      title: "Checkout flows",
      acceptance: ["AC-001"],
      steps: [
        {
          id: "given-valid-card",
          name: "customer has a valid card",
          type: "given",
          execute: (context) => {
            context.value = 1;
          },
        },
        {
          id: "then-success",
          name: "payment succeeds",
          type: "then",
          execute: () => undefined,
        },
        {
          id: "given-expired-card",
          name: "customer has an expired card",
          type: "given",
          execute: (context) => {
            context.value = 2;
          },
        },
        {
          id: "then-failure",
          name: "payment is declined",
          type: "then",
          execute: () => {
            throw new Error("card declined");
          },
        },
      ],
    });

    const result = await executeScenario(subject);
    reporter.recordScenario(subject, result);

    const report = reporter.buildReport({
      expectedAcceptanceIds: ["AC-001-01", "AC-001-02", "AC-001-03"],
      now: () => 0,
    });

    expect(result.success).toBe(false);
    expect(report.traceability.implemented).toEqual(["AC-001-01", "AC-001-02"]);
    expect(report.traceability.missing).toEqual(["AC-001-03"]);
    expect(report.scenarios[0]?.subScenarios).toHaveLength(2);
    expect(
      report.scenarios[0]?.subScenarios?.map((sub) => `${sub.status}:${sub.acceptance.join(",")}`),
    ).toEqual(["passed:AC-001-01", "failed:AC-001-02"]);

    const output = formatExecutionRunReport(report);
    expect(output).toContain("Sub-scenarios");
    expect(output).toContain("AC-001-01");
    expect(output).toContain("AC-001-02");
    expect(output).toContain("payment succeeds");
    expect(output).toContain("payment is declined");
  });

  it("collects scenario results and builds a run report", async () => {
    const reporter = createReporter<Record<string, unknown>>();
    const scenario = defineAcceptanceScenario<Record<string, unknown>>({
      id: "auth-1",
      title: "Registered user logs in",
      acceptance: ["AUTH-001"],
      tags: ["auth"],
      steps: [
        {
          id: "given-user",
          name: "registered user",
          type: "given",
          execute: () => undefined,
        },
      ],
    });
    const story = defineStory<Record<string, unknown>>({
      title: "Authentication",
      scenarios: [scenario],
    });

    const result = await executeScenario(scenario);

    reporter.recordScenario(scenario, result);

    const report = reporter.buildReport({
      stories: [story],
      expectedAcceptanceIds: ["AUTH-001", "AUTH-009"],
      now: () => 123,
    });

    expect(report.generatedAt).toBe(123);
    expect(report.totals.scenarioCount).toBe(1);
    expect(report.totals.passedScenarioCount).toBe(1);
    expect(report.traceability.implemented).toEqual(["AUTH-001"]);
    expect(report.traceability.missing).toEqual(["AUTH-009"]);
    expect(report.stories[0]?.title).toBe("Authentication");
    expect(formatExecutionRunReport(report)).toContain("Execution Report");
  });

  it("records executions through engine hooks", async () => {
    const reporter = createReporter<Record<string, unknown>>();
    const subject = defineAcceptanceScenario({
      id: "auth-2",
      title: "Locked user is rejected",
      acceptance: ["AUTH-002"],
      steps: [
        {
          id: "when-login",
          name: "submit credentials",
          type: "when",
          execute: () => undefined,
        },
      ],
    });

    await executeScenario(subject, {
      hooks: createReportingHooks(reporter),
    });

    expect(reporter.entries).toHaveLength(1);
    expect(reporter.entries[0]?.scenario.id).toBe("auth-2");
  });

  it("writes console and JSON reporter output on flush", async () => {
    const writer = vi.fn<(text: string) => void>();
    const consoleReporter = createConsoleReporter<Record<string, unknown>>({
      write: writer,
      expectedAcceptanceIds: ["AUTH-001"],
    });
    const jsonPath = join(tmpdir(), `magpie-report-${Date.now()}.json`);
    const jsonReporter = createJsonReporter<Record<string, unknown>>({
      outputPath: jsonPath,
      expectedAcceptanceIds: ["AUTH-001"],
    });
    const subject = defineAcceptanceScenario<Record<string, unknown>>({
      id: "auth-1",
      title: "Registered user logs in",
      acceptance: ["AUTH-001"],
      story: { title: "Authentication" },
      steps: [],
    });
    const result = await executeScenario(subject);

    consoleReporter.recordScenario(subject, result);
    jsonReporter.recordScenario(subject, result);

    await consoleReporter.flush();
    const jsonReport = await jsonReporter.flush();
    const fileContent = await readFile(jsonPath, "utf8");

    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer.mock.calls[0]?.[0]).toContain("Authentication");
    expect(JSON.parse(fileContent)).toEqual(jsonReport);
  });

  it("writes an HTML reporter artifact that contains scenario and failure details", async () => {
    const htmlPath = join(tmpdir(), `magpie-report-${Date.now()}.html`);
    const htmlReporter = createHtmlReporter<{ response?: { status: number } }>({
      outputPath: htmlPath,
      expectedAcceptanceIds: ["AUTH-001"],
    });
    const subject = defineAcceptanceScenario<{ response?: { status: number } }>({
      id: "auth-login",
      title: "Registered user logs in",
      acceptance: ["AUTH-001"],
      story: { title: "Authentication" },
      steps: [
        {
          id: "given-user",
          name: "registered user exists",
          type: "given",
          execute: (context) => {
            context.response = { status: 401 };
          },
        },
        {
          id: "then-token",
          name: "token is returned",
          type: "then",
          execute: (context) => {
            if (context.response?.status !== 200) {
              throw new Error("Expected a successful login");
            }
          },
        },
      ],
    });
    const result = await executeScenario(subject);

    htmlReporter.recordScenario(subject, result);
    const report = await htmlReporter.flush();
    const html = await readFile(htmlPath, "utf8");

    expect(result.success).toBe(false);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Authentication");
    expect(html).toContain("Registered user logs in");
    expect(html).toContain("Expected a successful login");
    expect(html).toBe(formatExecutionRunReportAsHtml(report));
  });

  it("hides main scenario steps and renders sub-scenarios separately in HTML", async () => {
    const htmlPath = join(tmpdir(), `magpie-report-${Date.now()}.html`);
    const htmlReporter = createHtmlReporter<{ value?: number }>({
      outputPath: htmlPath,
    });
    const subject = defineAcceptanceScenario<{ value?: number }>({
      id: "checkout",
      title: "Checkout flows",
      acceptance: ["AC-001"],
      steps: [
        {
          id: "given-valid-card",
          name: "customer has a valid card",
          type: "given",
          execute: (context) => {
            context.value = 1;
          },
        },
        {
          id: "then-success",
          name: "payment succeeds",
          type: "then",
          execute: () => undefined,
        },
        {
          id: "given-expired-card",
          name: "customer has an expired card",
          type: "given",
          execute: (context) => {
            context.value = 2;
          },
        },
        {
          id: "then-failure",
          name: "payment is declined",
          type: "then",
          execute: () => {
            throw new Error("card declined");
          },
        },
      ],
    });

    const result = await executeScenario(subject);
    htmlReporter.recordScenario(subject, result);
    const report = await htmlReporter.flush();
    const html = await readFile(htmlPath, "utf8");

    expect(html).toContain("Checkout flows");
    expect(html).toContain('class="sub-scenarios"');
    expect(html).toContain("AC-001-01");
    expect(html).toContain("AC-001-02");
    expect(html).toBe(formatExecutionRunReportAsHtml(report));
  });

  it("allows the Vitest adapter to report results without taking over execution", async () => {
    const reporter = createReporter<Record<string, unknown>>();
    const tests: Array<() => Promise<void> | void> = [];
    const subject = defineAcceptanceScenario({
      id: "auth-3",
      title: "Successful login",
      steps: [],
    });

    registerScenario(subject, {
      reporter,
      api: {
        describe(_name, run) {
          run();
        },
        it(_name, run) {
          tests.push(run);
        },
      },
      executor: async () => ({
        scenarioId: subject.id,
        scenarioTitle: subject.title,
        acceptance: [],
        success: true,
        duration: 1,
        startedAt: 0,
        finishedAt: 1,
        context: {},
        logs: [],
        attachments: [],
        steps: [],
      }),
    });

    await tests[0]?.();

    expect(reporter.entries).toHaveLength(1);
    expect(reporter.entries[0]?.scenario.title).toBe("Successful login");
  });
});

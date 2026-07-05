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
        steps: [],
      }),
    });

    await tests[0]?.();

    expect(reporter.entries).toHaveLength(1);
    expect(reporter.entries[0]?.scenario.title).toBe("Successful login");
  });
});
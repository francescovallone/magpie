import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  appendVitestReporterRecord,
  buildVitestReporterExecutionReport,
  createMagpieVitestReporter,
  DEFAULT_HISTORY_FILE_LIMIT,
  defineAcceptanceScenario,
  executeScenario,
  resetVitestReporterRecords,
} from "../src/index.js";

describe("MagpieVitestReporter", () => {
  it("builds a run report from persisted Vitest bridge records", async () => {
    const recordsDirectory = join(tmpdir(), `magpie-vitest-${Date.now()}`);
    const scenario = defineAcceptanceScenario<Record<string, unknown>>({
      id: "auth-1",
      title: "Registered user logs in",
      acceptance: ["AUTH-001"],
      story: { title: "Authentication" },
      steps: [],
    });
    const result = await executeScenario(scenario);

    await resetVitestReporterRecords({ recordsDirectory });
    await appendVitestReporterRecord(scenario, result, { recordsDirectory });

    const report = await buildVitestReporterExecutionReport({
      recordsDirectory,
      expectedAcceptanceIds: ["AUTH-001", "AUTH-007"],
      now: () => 123,
    });

    expect(report.generatedAt).toBe(123);
    expect(report.totals.scenarioCount).toBe(1);
    expect(report.traceability.missing).toEqual(["AUTH-007"]);
    expect(report.stories[0]?.title).toBe("Authentication");
  });

  it("prints and optionally writes JSON output on test-run end", async () => {
    const recordsDirectory = join(tmpdir(), `magpie-vitest-${Date.now()}-report`);
    const jsonOutputFile = join(tmpdir(), `magpie-vitest-${Date.now()}-report.json`);
    const jsonArchiveDirectory = join(tmpdir(), `magpie-vitest-${Date.now()}-history`);
    const write = vi.fn<(text: string) => void>();
    const reporter = createMagpieVitestReporter({
      recordsDirectory,
      jsonOutputFile,
      jsonArchiveDirectory,
      write,
    });
    const scenario = defineAcceptanceScenario<Record<string, unknown>>({
      id: "auth-1",
      title: "Registered user logs in",
      acceptance: ["AUTH-001"],
      story: { title: "Authentication" },
      steps: [],
    });
    const result = await executeScenario(scenario);

    await reporter.onTestRunStart?.();
    await appendVitestReporterRecord(scenario, result, { recordsDirectory });
    await reporter.onTestRunEnd?.([], [], "passed");

    const json = JSON.parse(await readFile(jsonOutputFile, "utf8"));
    const archivedFiles = await readFile(
      join(jsonArchiveDirectory, `${new Date(json.generatedAt).toISOString().replace(/[:.]/g, "-")}.json`),
      "utf8",
    );

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toContain("Execution Report");
    expect(json.totals.scenarioCount).toBe(1);
    expect(JSON.parse(archivedFiles).totals.scenarioCount).toBe(1);
  });

  it("prunes archived JSON history files down to the default limit of 3", async () => {
    const recordsDirectory = join(tmpdir(), `magpie-vitest-${Date.now()}-prune`);
    const jsonOutputFile = join(tmpdir(), `magpie-vitest-${Date.now()}-prune-report.json`);
    const jsonArchiveDirectory = join(tmpdir(), `magpie-vitest-${Date.now()}-prune-history`);
    const reporter = createMagpieVitestReporter({
      recordsDirectory,
      jsonOutputFile,
      jsonArchiveDirectory,
      write: vi.fn(),
    });
    const scenario = defineAcceptanceScenario<Record<string, unknown>>({
      id: "auth-1",
      title: "Registered user logs in",
      acceptance: ["AUTH-001"],
      story: { title: "Authentication" },
      steps: [],
    });

    await mkdir(jsonArchiveDirectory, { recursive: true });
    for (const name of ["2020-01-01T00-00-00-000Z.json", "2020-01-02T00-00-00-000Z.json", "2020-01-03T00-00-00-000Z.json"]) {
      await writeFile(join(jsonArchiveDirectory, name), "{}", "utf8");
    }

    const result = await executeScenario(scenario);
    await appendVitestReporterRecord(scenario, result, { recordsDirectory });
    await reporter.onTestRunEnd?.([], [], "passed");

    const archivedEntries = await readdir(jsonArchiveDirectory);

    expect(archivedEntries).toHaveLength(DEFAULT_HISTORY_FILE_LIMIT);
    expect(archivedEntries).not.toContain("2020-01-01T00-00-00-000Z.json");
  });

  it("honors a custom jsonHistoryLimit option", async () => {
    const recordsDirectory = join(tmpdir(), `magpie-vitest-${Date.now()}-prune-custom`);
    const jsonOutputFile = join(tmpdir(), `magpie-vitest-${Date.now()}-prune-custom-report.json`);
    const jsonArchiveDirectory = join(tmpdir(), `magpie-vitest-${Date.now()}-prune-custom-history`);
    const reporter = createMagpieVitestReporter({
      recordsDirectory,
      jsonOutputFile,
      jsonArchiveDirectory,
      jsonHistoryLimit: 1,
      write: vi.fn(),
    });
    const scenario = defineAcceptanceScenario<Record<string, unknown>>({
      id: "auth-1",
      title: "Registered user logs in",
      acceptance: ["AUTH-001"],
      story: { title: "Authentication" },
      steps: [],
    });

    await mkdir(jsonArchiveDirectory, { recursive: true });
    await writeFile(join(jsonArchiveDirectory, "2020-01-01T00-00-00-000Z.json"), "{}", "utf8");

    const result = await executeScenario(scenario);
    await appendVitestReporterRecord(scenario, result, { recordsDirectory });
    await reporter.onTestRunEnd?.([], [], "passed");

    const archivedEntries = await readdir(jsonArchiveDirectory);

    expect(archivedEntries).toHaveLength(1);
  });

  it("prints and optionally writes HTML output on test-run end", async () => {
    const recordsDirectory = join(tmpdir(), `magpie-vitest-${Date.now()}-html-report`);
    const htmlOutputFile = join(tmpdir(), `magpie-vitest-${Date.now()}-report.html`);
    const htmlArchiveDirectory = join(tmpdir(), `magpie-vitest-${Date.now()}-html-history`);
    const write = vi.fn<(text: string) => void>();
    const reporter = createMagpieVitestReporter({
      recordsDirectory,
      htmlOutputFile,
      htmlArchiveDirectory,
      write,
    });
    const scenario = defineAcceptanceScenario<Record<string, unknown>>({
      id: "auth-1",
      title: "Registered user logs in",
      acceptance: ["AUTH-001"],
      story: { title: "Authentication" },
      steps: [],
    });
    const result = await executeScenario(scenario);

    await reporter.onTestRunStart?.();
    await appendVitestReporterRecord(scenario, result, { recordsDirectory });
    await reporter.onTestRunEnd?.([], [], "passed");

    const html = await readFile(htmlOutputFile, "utf8");
    const archivedEntries = await readdir(htmlArchiveDirectory);
    const archivedHtml = await readFile(join(htmlArchiveDirectory, archivedEntries[0]!), "utf8");

    expect(write).toHaveBeenCalledTimes(1);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Authentication");
    expect(archivedEntries).toHaveLength(1);
    expect(archivedHtml).toBe(html);
  });

  it("prints a minimal message when no Magpie scenarios were recorded", async () => {
    const write = vi.fn<(text: string) => void>();
    const recordsDirectory = join(tmpdir(), `magpie-vitest-${Date.now()}-empty`);
    const reporter = createMagpieVitestReporter({
      recordsDirectory,
      write,
    });

    await reporter.onTestRunStart?.();
    await reporter.onTestRunEnd?.([], [], "passed");

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toContain("No acceptance scenarios were recorded");
  });
});
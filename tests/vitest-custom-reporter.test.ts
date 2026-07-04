import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  appendVitestReporterRecord,
  buildVitestReporterExecutionReport,
  createMagpieVitestReporter,
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
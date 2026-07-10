import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createReporter,
  defineAcceptanceScenario,
  executeScenario,
  formatExecutionRunReportAsHtml,
  loadAcceptanceIds,
} from "../src/index.js";

describe("HTML report full error detail", () => {
  it("always carries errorDetail with the full stack, regardless of errors.verbose", async () => {
    const reporter = createReporter();
    const scenario = defineAcceptanceScenario({
      id: "multi-line-error",
      title: "Failure with a multi-line error",
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

    reporter.recordScenario(scenario, await executeScenario(scenario));
    const report = reporter.buildReport({ now: () => 0 });
    const step = report.scenarios[0]?.steps.at(-1);

    expect(step?.error).toBe("Expected 200");
    expect(step?.errorDetail).toContain("Expected 200\nReceived 500");
    expect(report.scenarios[0]?.errorDetail).toContain("Expected 200\nReceived 500");
  });

  it("renders a collapsible <details> only when there is more than the one-liner", async () => {
    const reporter = createReporter();
    const scenario = defineAcceptanceScenario({
      id: "err",
      title: "Failing scenario",
      steps: [
        {
          id: "then-fails",
          name: "fails",
          type: "then",
          execute: () => {
            throw new Error("Expected 200\nReceived 500");
          },
        },
      ],
    });

    reporter.recordScenario(scenario, await executeScenario(scenario));
    const html = formatExecutionRunReportAsHtml(reporter.buildReport({ now: () => 0 }));

    expect(html).toContain('<details class="error-detail">');
    expect(html).toContain("Received 500");
  });

  it("skips the details block when the error is already a single line", async () => {
    const reporter = createReporter();
    const scenario = defineAcceptanceScenario({
      id: "single-line",
      title: "Single line failure",
      steps: [
        {
          id: "then-fails",
          name: "fails",
          type: "then",
          execute: () => {
            const error = new Error("Boom");
            delete error.stack;
            throw error;
          },
        },
      ],
    });

    reporter.recordScenario(scenario, await executeScenario(scenario));
    const html = formatExecutionRunReportAsHtml(reporter.buildReport({ now: () => 0 }));

    expect(html).not.toContain("<details");
  });
});

describe("loadAcceptanceIds", () => {
  it("loads a bare JSON array", async () => {
    const dir = await mkdtemp(join(tmpdir(), "magpie-ids-"));
    const file = join(dir, "ids.json");
    await writeFile(file, JSON.stringify(["AUTH-001", "AUTH-002"]), "utf8");

    expect(await loadAcceptanceIds(file)).toEqual(["AUTH-001", "AUTH-002"]);
  });

  it("rejects a JSON file that isn't an array", async () => {
    const dir = await mkdtemp(join(tmpdir(), "magpie-ids-"));
    const file = join(dir, "ids.json");
    await writeFile(file, JSON.stringify({ ids: ["AUTH-001"] }), "utf8");

    await expect(loadAcceptanceIds(file)).rejects.toThrow(/must contain a JSON array/);
  });

  it("loads a CSV/text export, skipping a header row and taking the first column", async () => {
    const dir = await mkdtemp(join(tmpdir(), "magpie-ids-"));
    const file = join(dir, "ids.csv");
    await writeFile(file, "Issue key,Summary\nAUTH-001,Login\nAUTH-002,Logout\n\n", "utf8");

    expect(await loadAcceptanceIds(file)).toEqual(["AUTH-001", "AUTH-002"]);
  });

  it("loads a plain one-id-per-line text file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "magpie-ids-"));
    const file = join(dir, "ids.txt");
    await writeFile(file, "AUTH-001\nAUTH-002\n", "utf8");

    expect(await loadAcceptanceIds(file)).toEqual(["AUTH-001", "AUTH-002"]);
  });
});

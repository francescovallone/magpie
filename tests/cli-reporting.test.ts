import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createAcceptanceTraceabilityReport,
  defineAcceptanceScenario,
  defineStory,
  isOutputEnabled,
  registerFilteredStory,
  resolveOutputKinds,
  resolveScenarioFilter,
  selectScenarios,
  writeJsonReport,
} from "../src/index.js";

describe("CLI filter helpers", () => {
  it("parses scenario filters from argv and env", () => {
    const filter = resolveScenarioFilter({
      argv: [
        "--tag=critical",
        "--tag",
        "auth",
        "--acceptance",
        "AUTH-*",
        "--story",
        "Authentication",
        "--scenario=Registered user logs in",
        "--grep",
        "token",
      ],
      env: {
        MAGPIE_TAGS: "payments",
      },
    });

    expect(filter).toEqual({
      tags: ["payments", "critical", "auth"],
      acceptance: ["AUTH-*"],
      story: "Authentication",
      scenario: "Registered user logs in",
      regex: "token",
    });
  });

  it("filters scenarios from process-like input", () => {
    const authScenario = defineAcceptanceScenario({
      id: "auth-1",
      title: "Registered user logs in",
      acceptance: ["AUTH-001"],
      tags: ["auth", "critical"],
      story: { title: "Authentication" },
      steps: [],
    });
    const paymentsScenario = defineAcceptanceScenario({
      id: "pay-1",
      title: "Payment completes",
      acceptance: ["PAY-001"],
      tags: ["payments"],
      story: { title: "Payments" },
      steps: [],
    });

    const selected = selectScenarios([authScenario, paymentsScenario], {
      argv: ["--acceptance", "AUTH-*"],
    });

    expect(selected).toEqual([authScenario]);
  });
});

describe("output selection", () => {
  it("parses output kinds from argv and env", () => {
    const kinds = resolveOutputKinds({
      argv: ["--output", "html", "--output=json"],
      env: { MAGPIE_OUTPUT: "console" },
    });

    expect(kinds).toEqual(new Set(["console", "html", "json"]));
  });

  it("checks whether a specific output kind is enabled", () => {
    expect(isOutputEnabled("html", { argv: ["--output", "html"] })).toBe(true);
    expect(isOutputEnabled("html", { argv: ["--output", "json"] })).toBe(false);
    expect(isOutputEnabled("html", { env: { MAGPIE_OUTPUT: "html" } })).toBe(true);
    expect(isOutputEnabled("HTML", { argv: ["--output=html"] })).toBe(true);
  });
});

describe("filtered Vitest registration", () => {
  it("registers only scenarios that match the filter", () => {
    const calls: Array<string> = [];
    const story = defineStory({
      title: "Authentication",
      scenarios: [
        defineAcceptanceScenario({
          id: "auth-1",
          title: "Registered user logs in",
          acceptance: ["AUTH-001"],
          tags: ["auth"],
          steps: [],
        }),
        defineAcceptanceScenario({
          id: "auth-2",
          title: "Locked user is rejected",
          acceptance: ["AUTH-002"],
          tags: ["security"],
          steps: [],
        }),
      ],
    });

    registerFilteredStory(story, {
      filter: { tags: ["auth"] },
      api: {
        describe(name, run) {
          calls.push(`describe:${name}`);
          run();
        },
        it(name) {
          calls.push(`it:${name}`);
        },
      },
      executor: async (scenario) => ({
        scenarioId: scenario.id,
        scenarioTitle: scenario.title,
        acceptance: scenario.acceptance,
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

    expect(calls).toEqual(["describe:Authentication", "it:Registered user logs in"]);
  });
});

describe("JSON report output", () => {
  it("writes JSON report artifacts to disk", async () => {
    const traceability = createAcceptanceTraceabilityReport(
      [
        defineAcceptanceScenario({
          id: "auth-1",
          title: "Registered user logs in",
          acceptance: ["AUTH-001"],
          steps: [],
        }),
      ],
      ["AUTH-001", "AUTH-007"],
    );
    const outputPath = join(tmpdir(), `magpie-${Date.now()}.json`);

    await writeJsonReport(outputPath, traceability);

    const content = await readFile(outputPath, "utf8");

    expect(JSON.parse(content)).toEqual({
      implemented: ["AUTH-001"],
      missing: ["AUTH-007"],
    });
  });
});
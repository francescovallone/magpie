import { describe, expect, it } from "vitest";

import {
  createScenarioReport,
  executeScenario,
  formatExecutionRunReportAsJUnitXml,
  buildExecutionRunReport,
  scenario,
  ScenarioSkip,
} from "../src/index.js";

describe("ScenarioSkip", () => {
  it("marks the scenario as skipped instead of failed, and skips the remaining steps", async () => {
    const subject = scenario("conditional", "Feature not enabled in this environment")
      .given("feature flag is checked", () => {
        throw new ScenarioSkip("feature flag disabled");
      })
      .then("feature behaves as expected", () => undefined)
      .build();

    const result = await executeScenario(subject);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.failure).toBeUndefined();

    const report = createScenarioReport(subject, result);
    expect(report.status).toBe("skipped");
    expect(report.steps.map((step) => step.status)).toEqual(["skipped", "skipped"]);
  });

  it("excludes skipped scenarios from passed/failed totals and reports them as JUnit skipped testcases", async () => {
    const subject = scenario("conditional", "Feature not enabled in this environment")
      .given("feature flag is checked", () => {
        throw new ScenarioSkip();
      })
      .build();

    const result = await executeScenario(subject);
    const report = buildExecutionRunReport([{ scenario: subject, result }]);

    expect(report.totals.passedScenarioCount).toBe(0);
    expect(report.totals.failedScenarioCount).toBe(0);

    const xml = formatExecutionRunReportAsJUnitXml(report);
    expect(xml).toContain("<skipped/>");
  });
});

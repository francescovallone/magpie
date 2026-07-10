import { describe, expect, it } from "vitest";

import {
  createReporter,
  createScenarioReport,
  defineAcceptanceScenario,
  executeScenario,
  formatExecutionRunReport,
  scenario,
} from "../src/index.js";

function failingLogin() {
  return defineAcceptanceScenario({
    id: "auth-login",
    title: "Registered user logs in",
    story: { title: "Authentication" },
    steps: [
      { name: "registered user exists", type: "given", execute: () => undefined },
      {
        name: "credentials are submitted",
        type: "when",
        execute: () => {
          throw new Error("Login service unavailable");
        },
      },
      { name: "token is returned", type: "then", execute: () => undefined },
      { name: "audit log entry is written", type: "then", execute: () => undefined },
      { name: "session is wiped", type: "cleanup", lifecycle: "cleanup", execute: () => undefined },
    ],
  });
}

describe("skipped steps in reports", () => {
  it("reports un-run steps as skipped, in declaration order", async () => {
    const login = failingLogin();
    const report = createScenarioReport(login, await executeScenario(login));

    expect(report.steps.map((step) => [step.name, step.status])).toEqual([
      ["registered user exists", "passed"],
      ["credentials are submitted", "failed"],
      ["token is returned", "skipped"],
      ["audit log entry is written", "skipped"],
      ["session is wiped", "passed"],
    ]);
    expect(report.steps.filter((step) => step.status === "skipped").every((step) => step.duration === 0)).toBe(
      true,
    );
  });

  it("keeps the full shape when the scenario passes (no skipped steps)", async () => {
    const passing = scenario("passing", "All steps run")
      .given("a", () => undefined)
      .then("b", () => undefined)
      .build();
    const report = createScenarioReport(passing, await executeScenario(passing));

    expect(report.steps.map((step) => step.status)).toEqual(["passed", "passed"]);
  });

  it("counts skipped steps in run totals and renders them with ○", async () => {
    const reporter = createReporter();
    const login = failingLogin();
    await reporter.recordScenario(login, await executeScenario(login));

    const report = reporter.buildReport();

    expect(report.totals.stepCount).toBe(5);
    expect(report.totals.skippedStepCount).toBe(2);
    expect(report.totals.failedStepCount).toBe(1);

    const text = formatExecutionRunReport(report);
    expect(text).toContain("○ then token is returned");
    expect(text).toContain("○ then audit log entry is written");
  });

  it("fills skipped steps per sub-scenario", async () => {
    const checkout = scenario<{ paid?: boolean }>("checkout", "Checkout flows")
      .acceptance("AC-001")
      .given("valid card", () => undefined)
      .when("customer pays", () => {
        throw new Error("Gateway timeout");
      })
      .then("payment succeeds", () => undefined)
      .given("expired card", () => undefined)
      .when("customer pays again", () => undefined)
      .then("payment is declined", () => undefined)
      .build();

    const report = createScenarioReport(checkout, await executeScenario(checkout));

    const firstSub = report.subScenarios?.[0];
    const secondSub = report.subScenarios?.[1];

    expect(firstSub?.steps.map((step) => step.status)).toEqual(["passed", "failed", "skipped"]);
    expect(firstSub?.steps[2]?.name).toBe("payment succeeds");
    expect(secondSub?.steps.map((step) => step.status)).toEqual(["passed", "passed", "passed"]);
  });
});

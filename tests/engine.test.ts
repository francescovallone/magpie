import { describe, expect, it } from "vitest";

import {
  createAcceptanceTraceabilityReport,
  createScenarioFilter,
  defineAcceptanceScenario,
  defineStory,
  executeScenario,
  formatStoryReport,
  mergeExecutionHooks,
  scenario,
} from "../src/index.js";

describe("executeScenario", () => {
  it("executes steps sequentially, shares context, stops on failure, and runs cleanup", async () => {
    const lifecycleEvents: Array<string> = [];

    const subject = defineAcceptanceScenario<{ value?: number; cleaned?: boolean }>({
      id: "auth-login",
      title: "Registered user logs in",
      acceptance: ["AUTH-001"],
      tags: ["auth", "critical"],
      steps: [
        {
          id: "setup-user",
          name: "registered user exists",
          type: "given",
          execute: (context, api) => {
            context.value = 1;
            lifecycleEvents.push("given");
            api.log("user seeded");
          },
        },
        {
          id: "submit-login",
          name: "submit credentials",
          type: "when",
          execute: () => {
            lifecycleEvents.push("when");
            throw new Error("invalid password");
          },
        },
        {
          id: "unreachable-assertion",
          name: "token returned",
          type: "then",
          execute: () => {
            lifecycleEvents.push("then");
          },
        },
        {
          id: "teardown",
          name: "cleanup session",
          type: "cleanup",
          lifecycle: "cleanup",
          execute: (context) => {
            context.cleaned = true;
            lifecycleEvents.push("cleanup");
          },
        },
      ],
    });

    const result = await executeScenario(subject, {
      hooks: {
        beforeScenario: () => {
          lifecycleEvents.push("beforeScenario");
        },
        afterScenario: () => {
          lifecycleEvents.push("afterScenario");
        },
        beforeStep: (step) => {
          lifecycleEvents.push(`before:${step.id}`);
        },
        afterStep: (step, _context, stepResult) => {
          lifecycleEvents.push(`after:${step.id}:${stepResult.status}`);
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.failure?.step.id).toBe("submit-login");
    expect(result.context.cleaned).toBe(true);
    expect(result.steps.map((step) => `${step.stepId}:${step.status}`)).toEqual([
      "setup-user:passed",
      "submit-login:failed",
      "teardown:passed",
    ]);
    expect(lifecycleEvents).toEqual([
      "beforeScenario",
      "before:setup-user",
      "given",
      "after:setup-user:passed",
      "before:submit-login",
      "when",
      "after:submit-login:failed",
      "before:teardown",
      "cleanup",
      "after:teardown:passed",
      "afterScenario",
    ]);
  });

  it("merges multiple hook sets in order", async () => {
    const calls: Array<string> = [];
    const subject = defineAcceptanceScenario<Record<string, unknown>>({
      id: "auth-hooks",
      title: "Hooks run in order",
      steps: [
        {
          id: "given-step",
          name: "given step",
          type: "given",
          execute: () => undefined,
        },
      ],
    });

    await executeScenario(subject, {
      hooks: mergeExecutionHooks(
        {
          beforeScenario: () => {
            calls.push("beforeScenario:first");
          },
          beforeStep: () => {
            calls.push("beforeStep:first");
          },
          afterStep: () => {
            calls.push("afterStep:first");
          },
          afterScenario: () => {
            calls.push("afterScenario:first");
          },
        },
        {
          beforeScenario: () => {
            calls.push("beforeScenario:second");
          },
          beforeStep: () => {
            calls.push("beforeStep:second");
          },
          afterStep: () => {
            calls.push("afterStep:second");
          },
          afterScenario: () => {
            calls.push("afterScenario:second");
          },
        },
      ),
    });

    expect(calls).toEqual([
      "beforeScenario:first",
      "beforeScenario:second",
      "beforeStep:first",
      "beforeStep:second",
      "afterStep:first",
      "afterStep:second",
      "afterScenario:first",
      "afterScenario:second",
    ]);
  });
});

describe("scenario definition", () => {
  it("stores immutable scenario data and supports the fluent builder as a wrapper", () => {
    const built = scenario<{ authenticated?: boolean }>("auth-success", "Registered user logs in")
      .acceptance("AUTH-001")
      .tag("auth")
      .given({
        id: "given-user",
        name: "registered user",
        execute: () => undefined,
      })
      .when({
        id: "when-login",
        name: "login submitted",
        execute: () => undefined,
      })
      .then({
        id: "then-token",
        name: "token returned",
        execute: () => undefined,
      })
      .build();

    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.steps)).toBe(true);
    expect(built.acceptance).toEqual(["AUTH-001"]);
    expect(built.steps.map((step) => step.type)).toEqual(["given", "when", "then"]);
  });
});

describe("reporting and filtering", () => {
  it("creates traceability, text reports, and filter predicates", async () => {
    const scenarioA = defineAcceptanceScenario({
      id: "auth-1",
      title: "Registered user logs in",
      acceptance: ["AUTH-001", "AUTH-002"],
      tags: ["auth"],
      story: { title: "Authentication" },
      steps: [
        {
          id: "given-user",
          name: "registered user",
          type: "given",
          execute: () => undefined,
        },
      ],
    });
    const scenarioB = defineAcceptanceScenario({
      id: "payments-1",
      title: "Payment completes",
      acceptance: ["PAY-001"],
      tags: ["payments"],
      story: { title: "Payments" },
      steps: [
        {
          id: "given-invoice",
          name: "invoice exists",
          type: "given",
          execute: () => undefined,
        },
      ],
    });

    const story = defineStory({
      title: "Authentication",
      scenarios: [scenarioA],
    });
    const result = await executeScenario(scenarioA);
    const report = formatStoryReport({
      title: story.title,
      scenarios: [
        {
          ...(scenarioA.story?.title ? { story: scenarioA.story.title } : {}),
          id: scenarioA.id,
          title: scenarioA.title,
          acceptance: scenarioA.acceptance,
          tags: scenarioA.tags,
          duration: result.duration,
          status: result.success ? "passed" : "failed",
          steps: result.steps.map((step) => ({
            id: step.stepId,
            name: step.stepName,
            type: step.type,
            lifecycle: step.lifecycle,
            duration: step.duration,
            status: step.status,
          })),
        },
      ],
    });
    const traceability = createAcceptanceTraceabilityReport([scenarioA, scenarioB], [
      "AUTH-001",
      "AUTH-002",
      "AUTH-007",
    ]);
    const filter = createScenarioFilter({ acceptance: ["AUTH-*"] });

    expect(filter(scenarioA)).toBe(true);
    expect(filter(scenarioB)).toBe(false);
    expect(traceability.implemented).toEqual(["AUTH-001", "AUTH-002", "PAY-001"]);
    expect(traceability.missing).toEqual(["AUTH-007"]);
    expect(report).toContain("Authentication");
    expect(report).toContain("Registered user logs in");
  });
});
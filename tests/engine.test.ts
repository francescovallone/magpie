import { describe, expect, it } from "vitest";

import {
  createAcceptanceTraceabilityReport,
  createScenarioFilter,
  defineAcceptanceScenario,
  defineStory,
  executeScenarios,
  executeScenario,
  formatStoryReport,
  mergeExecutionHooks,
  scenario,
} from "../src/index.js";

describe("executeScenario retries", () => {
  it("retries a failing scenario and reports the number of attempts", async () => {
    let executions = 0;
    const afterScenarioResults: Array<{ success: boolean; attempts?: number }> = [];

    const subject = defineAcceptanceScenario<Record<string, unknown>>({
      id: "flaky",
      title: "Flaky scenario",
      retries: 2,
      steps: [
        {
          id: "then-flaky",
          name: "eventually passes",
          type: "then",
          execute: () => {
            executions += 1;
            if (executions < 3) {
              throw new Error(`attempt ${executions} failed`);
            }
          },
        },
      ],
    });

    const result = await executeScenario(subject, {
      hooks: {
        afterScenario: (_scenario, _context, scenarioResult) => {
          afterScenarioResults.push({
            success: scenarioResult.success,
            ...(scenarioResult.attempts !== undefined
              ? { attempts: scenarioResult.attempts }
              : {}),
          });
        },
      },
    });

    expect(executions).toBe(3);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
    // afterScenario fires once, with the final result.
    expect(afterScenarioResults).toEqual([{ success: true, attempts: 3 }]);
  });

  it("stops retrying once the retry budget is exhausted", async () => {
    let executions = 0;

    const subject = defineAcceptanceScenario<Record<string, unknown>>({
      id: "always-fails",
      title: "Always fails",
      retries: 1,
      steps: [
        {
          id: "then-fails",
          name: "never passes",
          type: "then",
          execute: () => {
            executions += 1;
            throw new Error("nope");
          },
        },
      ],
    });

    const result = await executeScenario(subject);

    expect(executions).toBe(2);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.failure?.error.message).toBe("nope");
  });

  it("does not set attempts when the scenario passes on the first try", async () => {
    const subject = defineAcceptanceScenario<Record<string, unknown>>({
      id: "stable",
      title: "Stable scenario",
      retries: 3,
      steps: [
        { id: "then-passes", name: "passes", type: "then", execute: () => undefined },
      ],
    });

    const result = await executeScenario(subject);

    expect(result.success).toBe(true);
    expect(result.attempts).toBeUndefined();
  });

  it("applies the option-level retry default and lets scenario retries win", async () => {
    let optionRetried = 0;
    let scenarioRetried = 0;

    const usesDefault = defineAcceptanceScenario<Record<string, unknown>>({
      id: "uses-default",
      title: "Uses option default",
      steps: [
        {
          id: "then-fails",
          name: "fails",
          type: "then",
          execute: () => {
            optionRetried += 1;
            throw new Error("fail");
          },
        },
      ],
    });

    const overridesDefault = defineAcceptanceScenario<Record<string, unknown>>({
      id: "overrides-default",
      title: "Overrides option default",
      retries: 0,
      steps: [
        {
          id: "then-fails",
          name: "fails",
          type: "then",
          execute: () => {
            scenarioRetried += 1;
            throw new Error("fail");
          },
        },
      ],
    });

    await executeScenario(usesDefault, { retries: 2 });
    await executeScenario(overridesDefault, { retries: 2 });

    expect(optionRetried).toBe(3);
    expect(scenarioRetried).toBe(1);
  });

  it("retries failing sub-scenarios independently", async () => {
    const executionsByGiven = new Map<string, number>();
    const bump = (id: string) => {
      const count = (executionsByGiven.get(id) ?? 0) + 1;
      executionsByGiven.set(id, count);
      return count;
    };

    const subject = defineAcceptanceScenario<Record<string, unknown>>({
      id: "multi-given",
      title: "Multi given",
      acceptance: ["AC-100"],
      retries: 1,
      steps: [
        { id: "given-a", name: "case a", type: "given", execute: () => void bump("a") },
        { id: "then-a", name: "a passes", type: "then", execute: () => undefined },
        { id: "given-b", name: "case b", type: "given", execute: () => void bump("b") },
        {
          id: "then-b",
          name: "b passes on retry",
          type: "then",
          execute: () => {
            if (executionsByGiven.get("b") === 1) {
              throw new Error("first b attempt fails");
            }
          },
        },
      ],
    });

    const result = await executeScenario(subject);

    expect(result.success).toBe(true);
    // Sub-scenario "a" passed on its first attempt; only "b" was retried.
    expect(executionsByGiven.get("a")).toBe(1);
    expect(executionsByGiven.get("b")).toBe(2);
    expect(result.subScenarios?.[0]?.attempts).toBeUndefined();
    expect(result.subScenarios?.[1]?.attempts).toBe(2);
  });

  it("rejects a negative retry count", () => {
    expect(() =>
      defineAcceptanceScenario<Record<string, unknown>>({
        id: "bad-retries",
        title: "Bad retries",
        retries: -1,
        steps: [],
      }),
    ).toThrow("retries must be a non-negative integer");
  });
});

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

describe("executeScenarios", () => {
  it("executes independent scenarios in parallel and waits for dependencies", async () => {
    const started: Array<string> = [];
    const finished: Array<string> = [];
    let releaseIndependentScenarios: (() => void) | undefined;
    let resolveBothStarted: (() => void) | undefined;
    const bothStarted = new Promise<void>((resolve) => {
      resolveBothStarted = resolve;
    });
    const independentBarrier = new Promise<void>((resolve) => {
      releaseIndependentScenarios = resolve;
    });

    const markStarted = (scenarioId: string) => {
      started.push(scenarioId);

      if (started.includes("inventory-seeded") && started.includes("pricing-loaded")) {
        resolveBothStarted?.();
      }
    };

    const inventorySeeded = defineAcceptanceScenario({
      id: "inventory-seeded",
      title: "Inventory is seeded",
      steps: [
        {
          id: "seed-inventory",
          name: "seed inventory",
          type: "given",
          execute: async () => {
            markStarted("inventory-seeded");
            await independentBarrier;
            finished.push("inventory-seeded");
          },
        },
      ],
    });
    const pricingLoaded = defineAcceptanceScenario({
      id: "pricing-loaded",
      title: "Pricing is loaded",
      steps: [
        {
          id: "load-pricing",
          name: "load pricing",
          type: "given",
          execute: async () => {
            markStarted("pricing-loaded");
            await independentBarrier;
            finished.push("pricing-loaded");
          },
        },
      ],
    });
    const checkoutReady = defineAcceptanceScenario({
      id: "checkout-ready",
      title: "Checkout is ready",
      dependsOn: ["inventory-seeded", "pricing-loaded"],
      steps: [
        {
          id: "open-checkout",
          name: "open checkout",
          type: "when",
          execute: () => {
            started.push("checkout-ready");
            finished.push("checkout-ready");
          },
        },
      ],
    });

    const runPromise = executeScenarios([inventorySeeded, pricingLoaded, checkoutReady], {
      maxConcurrency: 2,
    });

    await bothStarted;

    expect(started).toEqual(expect.arrayContaining(["inventory-seeded", "pricing-loaded"]));
    expect(started).not.toContain("checkout-ready");

    releaseIndependentScenarios?.();

    const batch = await runPromise;

    expect(batch.results.map((result) => `${result.scenarioId}:${result.success}`)).toEqual([
      "inventory-seeded:true",
      "pricing-loaded:true",
      "checkout-ready:true",
    ]);
    expect(batch.skipped).toEqual([]);
    expect(finished).toEqual(["inventory-seeded", "pricing-loaded", "checkout-ready"]);
  });

  it("skips dependent scenarios when a dependency fails", async () => {
    const failedSetup = defineAcceptanceScenario({
      id: "failed-setup",
      title: "Setup fails",
      steps: [
        {
          id: "fail-setup",
          name: "fail setup",
          type: "given",
          execute: () => {
            throw new Error("seed failed");
          },
        },
      ],
    });
    const blockedScenario = defineAcceptanceScenario({
      id: "blocked-scenario",
      title: "Blocked by setup",
      dependsOn: ["failed-setup"],
      steps: [
        {
          id: "never-runs",
          name: "never runs",
          type: "when",
          execute: () => {
            throw new Error("should not execute");
          },
        },
      ],
    });
    const independentScenario = defineAcceptanceScenario({
      id: "independent-scenario",
      title: "Independent scenario",
      steps: [
        {
          id: "runs",
          name: "runs",
          type: "then",
          execute: () => undefined,
        },
      ],
    });

    const batch = await executeScenarios([failedSetup, blockedScenario, independentScenario], {
      maxConcurrency: 3,
    });

    expect(batch.results.map((result) => `${result.scenarioId}:${result.success}`)).toEqual([
      "failed-setup:false",
      "independent-scenario:true",
    ]);
    expect(batch.skipped).toEqual([
      {
        scenarioId: "blocked-scenario",
        scenarioTitle: "Blocked by setup",
        dependsOn: ["failed-setup"],
        reason: "dependency_failed",
      },
    ]);
  });

  it("rejects cyclic scenario dependencies", async () => {
    const first = defineAcceptanceScenario({
      id: "first",
      title: "First",
      dependsOn: ["second"],
      steps: [],
    });
    const second = defineAcceptanceScenario({
      id: "second",
      title: "Second",
      dependsOn: ["first"],
      steps: [],
    });

    await expect(executeScenarios([first, second])).rejects.toThrow(
      "Cyclic scenario dependency detected",
    );
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

describe("sub-scenarios", () => {
  it("does not compute sub-scenarios when there is a single given step", () => {
    const built = scenario("single-given", "Single given scenario")
      .acceptance("AC-001")
      .given({ id: "given-a", name: "a", execute: () => undefined })
      .when({ id: "when-a", name: "b", execute: () => undefined })
      .then({ id: "then-a", name: "c", execute: () => undefined })
      .build();

    expect(built.subScenarios).toBeUndefined();
  });

  it("auto-generates {acceptance}-{index} ids per given when there is more than one given", () => {
    const built = scenario("multi-given", "Multiple given scenario")
      .acceptance("AC-001")
      .given({ id: "given-a", name: "context A", execute: () => undefined })
      .when({ id: "when-a", name: "action A", execute: () => undefined })
      .then({ id: "then-a", name: "assert A", execute: () => undefined })
      .given({ id: "given-b", name: "context B", execute: () => undefined })
      .when({ id: "when-b", name: "action B", execute: () => undefined })
      .then({ id: "then-b", name: "assert B", execute: () => undefined })
      .build();

    expect(built.subScenarios).toHaveLength(2);
    expect(built.subScenarios?.map((sub) => sub.id)).toEqual(["multi-given-01", "multi-given-02"]);
    expect(built.subScenarios?.map((sub) => sub.acceptance)).toEqual([["AC-001-01"], ["AC-001-02"]]);
    expect(built.subScenarios?.[0]?.steps.map((step) => step.id)).toEqual([
      "given-a",
      "when-a",
      "then-a",
    ]);
    expect(built.subScenarios?.[1]?.steps.map((step) => step.id)).toEqual([
      "given-b",
      "when-b",
      "then-b",
    ]);
  });

  it("allows a custom acceptance id per given via the given() options", () => {
    const built = scenario("custom-given", "Custom acceptance ids")
      .acceptance("AC-001")
      .given(
        { id: "given-a", name: "context A", execute: () => undefined },
        { acceptance: "AC-CUSTOM" },
      )
      .given({ id: "given-b", name: "context B", execute: () => undefined })
      .build();

    expect(built.subScenarios?.map((sub) => sub.id)).toEqual(["AC-CUSTOM", "custom-given-02"]);
    expect(built.subScenarios?.map((sub) => sub.acceptance)).toEqual([["AC-CUSTOM"], ["AC-001-02"]]);
  });

  it("shares setup steps across sub-scenarios and executes each independently, failing the parent on any failure", async () => {
    const contexts: Array<{ value?: number }> = [];

    const built = defineAcceptanceScenario<{ value?: number }>({
      id: "checkout",
      title: "Checkout flows",
      acceptance: ["AC-001"],
      steps: [
        {
          id: "setup-store",
          name: "store is open",
          type: "setup",
          execute: (context) => {
            context.value = 0;
          },
        },
        {
          id: "given-valid-card",
          name: "customer has a valid card",
          type: "given",
          execute: (context) => {
            context.value = 1;
          },
        },
        {
          id: "when-pay-valid",
          name: "customer pays",
          type: "when",
          execute: (context) => {
            contexts.push(context);
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
          id: "when-pay-expired",
          name: "customer pays",
          type: "when",
          execute: (context) => {
            contexts.push(context);
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

    const result = await executeScenario(built);

    expect(result.success).toBe(false);
    expect(result.acceptance).toEqual(["AC-001"]);
    expect(result.subScenarios).toHaveLength(2);
    expect(result.subScenarios?.map((sub) => `${sub.subScenarioId}:${sub.success}`)).toEqual([
      "checkout-01:true",
      "checkout-02:false",
    ]);
    expect(result.failure?.step.id).toBe("then-failure");
    expect(contexts).toHaveLength(2);
    expect(contexts[0]).not.toBe(contexts[1]);
    expect(contexts[0]?.value).toBe(1);
    expect(contexts[1]?.value).toBe(2);
    expect(result.steps.map((step) => step.stepId)).toEqual([
      "setup-store",
      "given-valid-card",
      "when-pay-valid",
      "then-success",
      "setup-store",
      "given-expired-card",
      "when-pay-expired",
      "then-failure",
    ]);
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

describe("defineStory", () => {
  it("backfills story information onto pre-built scenarios defined before the story", () => {
    const preBuiltScenario = defineAcceptanceScenario({
      id: "auth-1",
      title: "Registered user logs in",
      acceptance: ["AUTH-001"],
      steps: [],
    });

    const story = defineStory({
      id: "story-auth",
      title: "Authentication",
      description: "Login related scenarios",
      scenarios: [preBuiltScenario],
    });

    expect(preBuiltScenario.story).toBeUndefined();
    expect(story.scenarios[0]?.story).toEqual({
      id: "story-auth",
      title: "Authentication",
      description: "Login related scenarios",
    });
  });

  it("backfills story information onto scenario definition inputs defined before the story", () => {
    const story = defineStory({
      title: "Authentication",
      scenarios: [
        {
          id: "auth-2",
          title: "Locked user is rejected",
          acceptance: ["AUTH-002"],
          steps: [],
        },
      ],
    });

    expect(story.scenarios[0]?.story).toEqual({ title: "Authentication" });
  });

  it("does not override a scenario's own explicit story reference", () => {
    const story = defineStory({
      title: "Authentication",
      scenarios: [
        {
          id: "auth-3",
          title: "Custom story scenario",
          acceptance: [],
          story: { title: "Custom Story" },
          steps: [],
        },
      ],
    });

    expect(story.scenarios[0]?.story).toEqual({ title: "Custom Story" });
  });
});
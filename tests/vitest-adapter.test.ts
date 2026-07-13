import { describe, expect, it, vi } from "vitest";

import { defineAcceptanceScenario, registerScenario, registerStory } from "../src/index.js";

describe("Vitest adapter", () => {
  it("maps a scenario into describe and it without embedding execution logic", async () => {
    const calls: Array<string> = [];
    const tests: Array<() => Promise<void> | void> = [];

    const subject = defineAcceptanceScenario({
      id: "auth-1",
      title: "Registered user logs in",
      story: { title: "Authentication" },
      steps: [],
    });

    registerScenario(subject, {
      api: {
        describe(name, run) {
          calls.push(`describe:${name}`);
          run();
        },
        it(name, run) {
          calls.push(`it:${name}`);
          tests.push(run);
        },
      },
      executor: vi.fn(async () => ({
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
      })),
    });

    expect(calls).toEqual(["describe:Authentication", "it:Registered user logs in"]);
    await tests[0]?.();
  });

  it("passes hook options through the adapter into scenario execution", async () => {
    const events: Array<string> = [];
    const tests: Array<() => Promise<void> | void> = [];
    const subject = defineAcceptanceScenario<Record<string, unknown>>({
      id: "auth-hooks",
      title: "Adapter forwards hooks",
      steps: [
        {
          id: "given-step",
          name: "given step",
          type: "given",
          execute: () => {
            events.push("execute");
          },
        },
      ],
    });

    registerScenario(subject, {
      api: {
        describe(_name, run) {
          run();
        },
        it(_name, run) {
          tests.push(run);
        },
      },
      hooks: {
        beforeScenario: () => {
          events.push("beforeScenario");
        },
        beforeStep: () => {
          events.push("beforeStep");
        },
        afterStep: () => {
          events.push("afterStep");
        },
        afterScenario: () => {
          events.push("afterScenario");
        },
      },
    });

    await tests[0]?.();

    expect(events).toEqual([
      "beforeScenario",
      "beforeStep",
      "execute",
      "afterStep",
      "afterScenario",
    ]);
  });

  it("throws the engine failure back into Vitest", async () => {
    const tests: Array<() => Promise<void> | void> = [];
    const subject = defineAcceptanceScenario({
      id: "auth-2",
      title: "Login fails",
      steps: [],
    });
    const error = new Error("boom");

    registerScenario(subject, {
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
        success: false,
        duration: 1,
        startedAt: 0,
        finishedAt: 1,
        context: {},
        logs: [],
        attachments: [],
        steps: [],
        failure: {
          step: {
            id: "then-error",
            name: "fails",
            type: "then",
            lifecycle: "main",
            metadata: {},
            execute: () => undefined,
          },
          error: {
            name: error.name,
            message: error.message,
            ...(error.stack ? { stack: error.stack } : {}),
          },
          cause: error,
        },
      }),
    });

    await expect(tests[0]?.()).rejects.toThrow("boom");
  });

  it("does not fail the run for a failing quarantined scenario", async () => {
    const tests: Array<() => Promise<void> | void> = [];
    const subject = defineAcceptanceScenario({
      id: "auth-quarantined",
      title: "Known flaky login",
      tags: ["quarantine"],
      steps: [],
    });
    const error = new Error("flaky boom");

    registerScenario(subject, {
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
        success: false,
        duration: 1,
        startedAt: 0,
        finishedAt: 1,
        context: {},
        logs: [],
        attachments: [],
        steps: [],
        failure: {
          step: {
            id: "then-error",
            name: "fails",
            type: "then",
            lifecycle: "main",
            metadata: {},
            execute: () => undefined,
          },
          error: { name: error.name, message: error.message },
          cause: error,
        },
      }),
    });

    await expect(tests[0]?.()).resolves.toBeUndefined();
  });

  it("still fails when the quarantine tag does not match the configured tags", async () => {
    const tests: Array<() => Promise<void> | void> = [];
    const subject = defineAcceptanceScenario({
      id: "auth-tagged",
      title: "Tagged but not quarantined",
      tags: ["quarantine"],
      steps: [],
    });
    const error = new Error("boom");

    registerScenario(subject, {
      quarantineTags: ["known-flaky"],
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
        success: false,
        duration: 1,
        startedAt: 0,
        finishedAt: 1,
        context: {},
        logs: [],
        attachments: [],
        steps: [],
        failure: {
          step: {
            id: "then-error",
            name: "fails",
            type: "then",
            lifecycle: "main",
            metadata: {},
            execute: () => undefined,
          },
          error: { name: error.name, message: error.message },
          cause: error,
        },
      }),
    });

    await expect(tests[0]?.()).rejects.toThrow("boom");
  });

  it("registers all scenarios in a story", () => {
    const calls: Array<string> = [];

    registerStory(
      {
        title: "Authentication",
        metadata: {},
        scenarios: [
          defineAcceptanceScenario({ id: "a", title: "A", steps: [] }),
          defineAcceptanceScenario({ id: "b", title: "B", steps: [] }),
        ],
      },
      {
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
      },
    );

    expect(calls).toEqual(["describe:Authentication", "it:A", "it:B"]);
  });
});
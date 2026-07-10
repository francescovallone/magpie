import { describe, expect, it } from "vitest";

import {
  createGherkinStory,
  defineAcceptanceScenario,
  defineGherkinStep,
  executeScenario,
  scenario,
} from "../src/index.js";

describe("splitOnGiven", () => {
  it("splits on multiple givens by default", () => {
    const built = scenario("multi", "Multiple givens")
      .acceptance("AC-001")
      .given("context A", () => undefined)
      .then("assert A", () => undefined)
      .given("context B", () => undefined)
      .then("assert B", () => undefined)
      .build();

    expect(built.subScenarios).toHaveLength(2);
  });

  it("runs all steps as one linear scenario with splitOnGiven(false)", async () => {
    const executed: Array<string> = [];
    const built = scenario("linear", "Linear scenario")
      .acceptance("AC-001")
      .splitOnGiven(false)
      .given("context A", () => void executed.push("given-a"))
      .then("assert A", () => void executed.push("then-a"))
      .given("context B", () => void executed.push("given-b"))
      .then("assert B", () => void executed.push("then-b"))
      .build();

    expect(built.subScenarios).toBeUndefined();

    const result = await executeScenario(built);

    expect(result.success).toBe(true);
    expect(result.subScenarios).toBeUndefined();
    expect(executed).toEqual(["given-a", "then-a", "given-b", "then-b"]);
  });

  it("shares one context across all givens when the split is disabled", async () => {
    const built = defineAcceptanceScenario<{ values: Array<number> }>({
      id: "shared-context",
      title: "Shared context",
      splitOnGiven: false,
      steps: [
        { name: "first given", type: "given", execute: (context) => void context.values.push(1) },
        { name: "second given", type: "given", execute: (context) => void context.values.push(2) },
        {
          name: "both are visible",
          type: "then",
          execute: (context) => {
            if (context.values.join(",") !== "1,2") {
              throw new Error("Expected a single shared context");
            }
          },
        },
      ],
    });

    const result = await executeScenario(built, { createContext: () => ({ values: [] }) });
    expect(result.success).toBe(true);
  });

  it("is forwarded by the Gherkin importer", () => {
    const feature = `
Feature: Withdrawals

  Scenario: Multiple explicit givens
    Given a balance of 100
    Given a daily limit of 50
    Then the withdrawal is capped
`;
    const stepDefinitions = [
      defineGherkinStep({ expression: "a balance of {int}", execute: () => undefined }),
      defineGherkinStep({ expression: "a daily limit of {int}", execute: () => undefined }),
      defineGherkinStep({ expression: "the withdrawal is capped", execute: () => undefined }),
    ];

    const splitStory = createGherkinStory(feature, { uri: "w.feature", stepDefinitions });
    expect(splitStory.scenarios[0]?.subScenarios).toHaveLength(2);

    const linearStory = createGherkinStory(feature, {
      uri: "w.feature",
      stepDefinitions,
      splitOnGiven: false,
    });
    expect(linearStory.scenarios[0]?.subScenarios).toBeUndefined();
  });

  it("And continuation steps never split, even with the default", () => {
    const feature = `
Feature: Withdrawals

  Scenario: Given with And continuation
    Given a balance of 100
    And a daily limit of 50
    Then the withdrawal is capped
`;
    const story = createGherkinStory(feature, {
      uri: "w.feature",
      stepDefinitions: [
        defineGherkinStep({ expression: "a balance of {int}", execute: () => undefined }),
        defineGherkinStep({ expression: "a daily limit of {int}", execute: () => undefined }),
        defineGherkinStep({ expression: "the withdrawal is capped", execute: () => undefined }),
      ],
    });

    expect(story.scenarios[0]?.subScenarios).toBeUndefined();
    expect(story.scenarios[0]?.steps.map((step) => step.type)).toEqual(["given", "and", "then"]);
  });
});

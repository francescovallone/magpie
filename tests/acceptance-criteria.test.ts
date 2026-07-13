import { describe, expect, it } from "vitest";

import {
  createGherkinScenarios,
  createScenariosFromAcceptanceCriteria,
  defineGherkinStep,
  normalizeAcceptanceCriteriaContent,
} from "../src/index.js";

const stepDefinitions = [
  defineGherkinStep({ expression: "a registered user exists", execute: () => {} }),
  defineGherkinStep({ expression: "they submit valid credentials", execute: () => {} }),
  defineGherkinStep({ expression: "a token is returned", execute: () => {} }),
  defineGherkinStep({ expression: "they submit an invalid password", execute: () => {} }),
  defineGherkinStep({ expression: "an error is shown", execute: () => {} }),
];

describe("createScenariosFromAcceptanceCriteria", () => {
  it("parses Markdown acceptance criteria into one scenario per Scenario/Given block", () => {
    const markdown = `
Scenario: Successful login
- Given a registered user exists
- When they submit valid credentials
- Then a token is returned

Scenario: Invalid password
- Given a registered user exists
- When they submit an invalid password
- Then an error is shown
`;

    const scenarios = createScenariosFromAcceptanceCriteria(markdown, { stepDefinitions });

    expect(scenarios).toHaveLength(2);
    expect(scenarios[0]?.title).toBe("Successful login");
    expect(scenarios[0]?.steps.map((step) => step.type)).toEqual(["given", "when", "then"]);
    expect(scenarios[1]?.title).toBe("Invalid password");
  });

  it("parses equivalent HTML acceptance criteria identically to Markdown", () => {
    const html = `
      <p><strong>Scenario: Successful login</strong></p>
      <ul>
        <li>Given a registered user exists</li>
        <li>When they submit valid credentials</li>
        <li>Then a token is returned</li>
      </ul>
    `;

    const scenarios = createScenariosFromAcceptanceCriteria(html, { stepDefinitions });

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.title).toBe("Successful login");
    expect(scenarios[0]?.steps.map((step) => step.name)).toEqual([
      "a registered user exists",
      "they submit valid credentials",
      "a token is returned",
    ]);
  });

  it("splits on a repeated Given even without explicit Scenario headings", () => {
    const markdown = `
- Given a registered user exists
- When they submit valid credentials
- Then a token is returned
- Given a registered user exists
- When they submit an invalid password
- Then an error is shown
`;

    const scenarios = createScenariosFromAcceptanceCriteria(markdown, { stepDefinitions });

    expect(scenarios).toHaveLength(2);
  });

  it("tags generated scenarios with the DevOps work item id for acceptance traceability", () => {
    const markdown = `
- Given a registered user exists
- When they submit valid credentials
- Then a token is returned
`;
    const scenarios = createScenariosFromAcceptanceCriteria(markdown, {
      stepDefinitions,
      workItemId: "AUTH-001",
    });

    expect(scenarios[0]?.acceptance).toEqual(["001"]);
  });

  it("normalizes a custom parser's single-scenario return value into a list", () => {
    const scenario = createGherkinScenarios("Feature: F\n\nScenario: S\n  Given a registered user exists\n", {
      stepDefinitions,
    })[0]!;

    const scenarios = createScenariosFromAcceptanceCriteria("irrelevant content", {
      stepDefinitions,
      parser: () => scenario,
    });

    expect(scenarios).toEqual([scenario]);
  });

  it("throws when no Given/When/Then steps can be found", () => {
    expect(() =>
      createScenariosFromAcceptanceCriteria("just some prose with no steps", { stepDefinitions }),
    ).toThrow("No Given/When/Then steps found");
  });
});

describe("normalizeAcceptanceCriteriaContent", () => {
  it("auto-detects HTML vs. Markdown and converges on the same plain text", () => {
    const markdown = "- Given a thing\n- When it happens\n- Then it works";
    const html = "<ul><li>Given a thing</li><li>When it happens</li><li>Then it works</li></ul>";

    expect(normalizeAcceptanceCriteriaContent(html)).toBe(normalizeAcceptanceCriteriaContent(markdown));
  });

  it("decodes common HTML entities", () => {
    expect(normalizeAcceptanceCriteriaContent("<p>Tom &amp; Jerry &gt; cat &amp; mouse</p>")).toBe(
      "Tom & Jerry > cat & mouse",
    );
  });
});

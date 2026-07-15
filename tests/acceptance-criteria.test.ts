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

  it("normalizes rich-text typography: non-breaking spaces, curly quotes, numeric entities", () => {
    // "the cart" (NBSP), curly apostrophe (’), curly double quotes
    // (“/”), and an &#8217; numeric entity — the transformations
    // Azure DevOps' rich-text editor applies to typed text.
    const html = [
      "<ul>",
      "<li>Given items are in the cart</li>",
      "<li>When the customer’s order is placed</li>",
      "<li>Then the receipt says “paid”</li>",
      "<li>And the buyer&#8217;s email is sent</li>",
      // zero-width space inside "confirmation", en dash in "e-mail"
      `<li>And the confir${String.fromCharCode(0x200b)}mation e${String.fromCharCode(0x2013)}mail is queued</li>`,
      "</ul>",
    ].join("");

    const scenarios = createScenariosFromAcceptanceCriteria(html, {
      stepDefinitions: [
        defineGherkinStep({ expression: "items are in the cart", execute: () => {} }),
        defineGherkinStep({ expression: "the customer's order is placed", execute: () => {} }),
        defineGherkinStep({ expression: "the receipt says {string}", execute: () => {} }),
        defineGherkinStep({ expression: "the buyer's email is sent", execute: () => {} }),
        defineGherkinStep({ expression: "the confirmation e-mail is queued", execute: () => {} }),
      ],
    });

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.steps.map((step) => step.name)).toEqual([
      "items are in the cart",
      "the customer's order is placed",
      'the receipt says "paid"',
      "the buyer's email is sent",
      "the confirmation e-mail is queued",
    ]);
  });

  it("strips prose punctuation around step texts", () => {
    // Keyword followed by a comma, leading comma after the keyword, and
    // trailing sentence punctuation — all common in prose-style criteria.
    const markdown = `
- Given , a registered user exists,
- When, they submit valid credentials.
- Then a token is returned!
- And an error is shown:
`;

    const scenarios = createScenariosFromAcceptanceCriteria(markdown, { stepDefinitions });

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.steps.map((step) => step.name)).toEqual([
      "a registered user exists",
      "they submit valid credentials",
      "a token is returned",
      "an error is shown",
    ]);
  });

  it("splits prose lines chaining several steps with inline keywords (`, THEN ...`)", () => {
    const markdown =
      "GIVEN a registered user exists, WHEN they submit valid credentials ,THEN a token is returned";

    const scenarios = createScenariosFromAcceptanceCriteria(markdown, { stepDefinitions });

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.steps.map((step) => [step.type, step.name])).toEqual([
      ["given", "a registered user exists"],
      ["when", "they submit valid credentials"],
      ["then", "a token is returned"],
    ]);
  });

  it("names hidden non-ASCII characters in the undefined-step error", () => {
    const html = `<ul><li>Given items are in the${String.fromCharCode(0xa0)}cart</li></ul>`;

    expect(() =>
      createGherkinScenarios(
        `Feature: F\n\n  Scenario: S\n    Given items are in the${String.fromCharCode(0xa0)}cart\n`,
        { stepDefinitions: [] },
      ),
    ).toThrowError(/U\+00A0/);

    // ...while the acceptance-criteria path normalizes it away entirely.
    expect(() =>
      createScenariosFromAcceptanceCriteria(html, {
        stepDefinitions: [
          defineGherkinStep({ expression: "items are in the cart", execute: () => {} }),
        ],
      }),
    ).not.toThrow();
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
    const scenario = createGherkinScenarios(
      "Feature: F\n\nScenario: S\n  Given a registered user exists\n",
      {
        stepDefinitions,
      },
    )[0]!;

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

    expect(normalizeAcceptanceCriteriaContent(html)).toBe(
      normalizeAcceptanceCriteriaContent(markdown),
    );
  });

  it("decodes common HTML entities", () => {
    expect(normalizeAcceptanceCriteriaContent("<p>Tom &amp; Jerry &gt; cat &amp; mouse</p>")).toBe(
      "Tom & Jerry > cat & mouse",
    );
  });
});

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createGherkinScenarios,
  createGherkinScenariosFromFile,
  createGherkinStory,
  defineGherkinStep,
  executeScenario,
} from "../src/index.js";

describe("Gherkin importer", () => {
  it("creates immutable Magpie scenarios from feature text with backgrounds and outlines", async () => {
    const calls: Array<string> = [];
    const story = createGherkinStory<{ users: string[]; response?: { status: number } }>(
      `
Feature: Authentication
  Verifies authentication behavior.

  Background:
    Given a registered user "alice"

  @auth @critical @AUTH-001
  Scenario Outline: Registered user logs in
    When the user logs in with password <password>
    Then the response status is <status>

    Examples:
      | password | status |
      | secret   | 200    |
      | invalid  | 401    |
`,
      {
        uri: "authentication.feature",
        stepDefinitions: [
          defineGherkinStep({
            expression: "a registered user {string}",
            execute: ({ arguments: [name], context }) => {
              context.users = [...(context.users ?? []), String(name)];
              calls.push(`given:${name}`);
            },
          }),
          defineGherkinStep({
            expression: "the user logs in with password {word}",
            execute: ({ arguments: [password], context }) => {
              context.response = { status: password === "secret" ? 200 : 401 };
              calls.push(`when:${password}`);
            },
          }),
          defineGherkinStep({
            expression: "the response status is {int}",
            execute: ({ arguments: [status], context }) => {
              calls.push(`then:${status}`);

              if (context.response?.status !== status) {
                throw new Error(`Expected ${status} but received ${context.response?.status}`);
              }
            },
          }),
        ],
      },
    );

    expect(story.title).toBe("Authentication");
    expect(story.scenarios).toHaveLength(2);
    expect(Object.isFrozen(story.scenarios[0])).toBe(true);
    expect(story.scenarios[0]?.acceptance).toEqual(["001"]);
    expect(story.scenarios[0]?.steps.map((step) => step.type)).toEqual(["given", "when", "then"]);

    const firstResult = await executeScenario(story.scenarios[0]!);
    const secondResult = await executeScenario(story.scenarios[1]!);

    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(true);
    expect(calls).toEqual([
      "given:alice",
      "when:secret",
      "then:200",
      "given:alice",
      "when:invalid",
      "then:401",
    ]);
  });

  it("assigns stable, deterministic scenario and step ids across parses", () => {
    const feature = `
Feature: Authentication

  Scenario: Registered user logs in
    Given a step

  Scenario Outline: Login fails with <password>
    Given a step

    Examples:
      | password |
      | wrong    |
      | expired  |
`;
    const options = {
      stepDefinitions: [defineGherkinStep({ expression: "a step", execute: () => undefined })],
    };

    const first = createGherkinScenarios<Record<string, unknown>>(feature, options);
    const second = createGherkinScenarios<Record<string, unknown>>(feature, options);

    expect(first.map((scenario) => scenario.id)).toEqual([
      "authentication:registered-user-logs-in",
      "authentication:login-fails-with-wrong",
      "authentication:login-fails-with-expired",
    ]);
    // Same feature text always produces the same ids.
    expect(second.map((scenario) => scenario.id)).toEqual(first.map((scenario) => scenario.id));
    expect(first[0]?.steps[0]?.id).toBe("authentication:registered-user-logs-in:step-1");
  });

  it("disambiguates outline examples whose title has no placeholders", () => {
    const scenarios = createGherkinScenarios<Record<string, unknown>>(
      `
Feature: Withdrawals

  Scenario Outline: Withdraw from account
    Given a withdrawal of <amount>

    Examples:
      | amount |
      | 20     |
      | 50     |
`,
      {
        stepDefinitions: [
          defineGherkinStep({ expression: "a withdrawal of {int}", execute: () => undefined }),
        ],
      },
    );

    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      "withdrawals:withdraw-from-account:1",
      "withdrawals:withdraw-from-account:2",
    ]);
    expect(scenarios.map((scenario) => scenario.title)).toEqual([
      "Withdraw from account #1",
      "Withdraw from account #2",
    ]);
  });

  it("preserves doc strings and tables in step metadata and execution match data", async () => {
    const capturedArguments: Array<unknown> = [];
    const capturedDocStrings: Array<string> = [];
    const capturedTables: Array<ReadonlyArray<ReadonlyArray<string>>> = [];
    const scenarios = createGherkinScenarios<{ captured?: boolean }>(
      `
Feature: Messaging

  @MSG-001
  Scenario: Submit message
    Given a message body
      """
      hello world
      """
    When the following recipients exist
      | name  | role  |
      | alice | admin |
      | bob   | user  |
    Then the message is accepted
`,
      {
        uri: "messaging.feature",
        acceptanceTagPrefix: "MSG-",
        stepDefinitions: [
          defineGherkinStep({
            expression: "a message body",
            execute: ({ argumentData }) => {
              capturedDocStrings.push(argumentData?.docString?.content ?? "");
            },
          }),
          defineGherkinStep({
            expression: "the following recipients exist",
            execute: ({ argumentData }) => {
              capturedTables.push(argumentData?.dataTable?.rows ?? []);
            },
          }),
          defineGherkinStep({
            expression: "the message is accepted",
            execute: ({ context }) => {
              context.captured = true;
              capturedArguments.push(context.captured);
            },
          }),
        ],
      },
    );

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.acceptance).toEqual(["001"]);
    expect(scenarios[0]?.steps[0]?.metadata).toMatchObject({
      gherkin: {
        argument: {
          docString: {
            content: "hello world",
          },
        },
      },
    });

    const result = await executeScenario(scenarios[0]!);

    expect(result.success).toBe(true);
    expect(capturedDocStrings).toEqual(["hello world"]);
    expect(capturedTables).toEqual([[ ["name", "role"], ["alice", "admin"], ["bob", "user"] ]]);
    expect(capturedArguments).toEqual([true]);
  });

  it("loads feature files from disk and extracts acceptance ids from tags and metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "magpie-gherkin-"));
    const filePath = join(directory, "payments.feature");

    await writeFile(
      filePath,
      `
Feature: Payments
  Acceptance: PAY-100, PAY-101

  @domain @acceptance(PAY-102)
  Scenario: Invoice is paid
    Acceptance: PAY-103
    Given an invoice exists
    Then the invoice is paid
`,
      "utf8",
    );

    const scenarios = await createGherkinScenariosFromFile<Record<string, unknown>>(filePath, {
      acceptanceTagPattern: /acceptance\(([^)]+)\)/,
      acceptanceMetadataPattern: /PAY-\d+/g,
      stepDefinitions: [
        defineGherkinStep({
          expression: "an invoice exists",
          execute: () => undefined,
        }),
        defineGherkinStep({
          expression: "the invoice is paid",
          execute: () => undefined,
        }),
      ],
    });

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.acceptance).toEqual(["PAY-102", "PAY-100", "PAY-101", "PAY-103"]);
    expect(scenarios[0]?.metadata).toMatchObject({
      gherkin: {
        feature: {
          uri: filePath,
        },
      },
    });
  });
});
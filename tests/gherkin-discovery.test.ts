import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createGherkinStepRegistry,
  createGherkinStoriesFromDirectory,
  createGherkinStory,
  defineGherkinStep,
  findFeatureFiles,
  generateGherkinStepSnippet,
} from "../src/index.js";

const FEATURE = `
Feature: Authentication

  Scenario: Registered user logs in
    Given a registered user "alice"
    Then the login succeeds
`;

function createRegistry() {
  return createGherkinStepRegistry<{ user?: string }>()
    .define({
      expression: "a registered user {string}",
      execute: ({ arguments: [user], context }) => {
        context.user = String(user);
      },
    })
    .define({
      expression: "the login succeeds",
      execute: () => undefined,
    });
}

describe("Gherkin step registry", () => {
  it("is accepted directly as stepDefinitions", () => {
    const story = createGherkinStory(FEATURE, {
      uri: "auth.feature",
      stepDefinitions: createRegistry(),
    });

    expect(story.scenarios).toHaveLength(1);
    expect(story.scenarios[0]?.steps).toHaveLength(2);
  });

  it("merges other registries and plain definitions", () => {
    const base = createGherkinStepRegistry<{ user?: string }>().define({
      expression: "a registered user {string}",
      execute: () => undefined,
    });
    const merged = createGherkinStepRegistry<{ user?: string }>()
      .merge(base)
      .add(defineGherkinStep({ expression: "the login succeeds", execute: () => undefined }));

    expect(merged.stepDefinitions).toHaveLength(2);
    expect(() =>
      createGherkinStory(FEATURE, { uri: "auth.feature", stepDefinitions: merged }),
    ).not.toThrow();
  });
});

describe("undefined step snippets", () => {
  it("suggests an expression with {string}, {int} and {float} placeholders", () => {
    const snippet = generateGherkinStepSnippet('the user "alice" buys 3 items for 9.99 euro');

    expect(snippet).toContain('expression: "the user {string} buys {int} items for {float} euro"');
    expect(snippet).toContain("arguments: [string1, int1, float1]");
    expect(snippet).toContain("defineGherkinStep({");
  });

  it("does not treat numbers embedded in words as parameters", () => {
    const snippet = generateGherkinStepSnippet("the user-1 opens page v2");

    expect(snippet).toContain('expression: "the user-1 opens page v2"');
    expect(snippet).toContain("({ context })");
  });

  it("reports every undefined step of a feature at once, with snippets", () => {
    expect(() =>
      createGherkinStory(FEATURE, { uri: "auth.feature", stepDefinitions: [] }),
    ).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining("2 Gherkin step(s) in auth.feature"),
      }),
    );

    try {
      createGherkinStory(FEATURE, { uri: "auth.feature", stepDefinitions: [] });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('- a registered user "alice"');
      expect(message).toContain("- the login succeeds");
      expect(message).toContain('expression: "a registered user {string}"');
      expect(message).toContain('expression: "the login succeeds"');
    }
  });
});

describe("feature file discovery", () => {
  it("finds feature files recursively, sorted and filtered by extension", async () => {
    const directory = await mkdtemp(join(tmpdir(), "magpie-features-"));
    await mkdir(join(directory, "nested"), { recursive: true });
    await writeFile(join(directory, "b.feature"), FEATURE, "utf8");
    await writeFile(join(directory, "nested", "a.feature"), FEATURE, "utf8");
    await writeFile(join(directory, "notes.txt"), "not a feature", "utf8");

    const files = await findFeatureFiles(directory);

    expect(files).toHaveLength(2);
    expect(files[0]?.endsWith("b.feature")).toBe(true);
    expect(files[1]?.endsWith("a.feature")).toBe(true);
  });

  it("creates one story per feature file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "magpie-features-"));
    await writeFile(join(directory, "auth.feature"), FEATURE, "utf8");
    await writeFile(
      join(directory, "logout.feature"),
      FEATURE.replace("Feature: Authentication", "Feature: Logout"),
      "utf8",
    );

    const stories = await createGherkinStoriesFromDirectory(directory, {
      stepDefinitions: createRegistry(),
    });

    expect(stories.map((story) => story.title)).toEqual(["Authentication", "Logout"]);
  });

  it("throws when the directory has no feature files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "magpie-empty-"));

    await expect(
      createGherkinStoriesFromDirectory(directory, { stepDefinitions: [] }),
    ).rejects.toThrowError(/No feature files found/);
  });
});

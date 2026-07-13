import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createJUnitReporter,
  defineAcceptanceScenario,
  defineStory,
  executeScenario,
  formatExecutionRunReportAsJUnitXml,
  createReporter,
} from "../src/index.js";

function passingScenario(id: string, title: string, storyTitle = "Authentication") {
  return defineAcceptanceScenario({
    id,
    title,
    acceptance: ["AUTH-001"],
    story: { title: storyTitle },
    steps: [{ name: "noop", type: "given", execute: () => undefined }],
  });
}

function failingScenario(tags: ReadonlyArray<string> = []) {
  return defineAcceptanceScenario({
    id: "auth-fail",
    title: 'Login fails with "bad" <input> & co',
    tags,
    story: { title: "Authentication" },
    steps: [
      {
        name: "login is rejected",
        type: "then",
        execute: () => {
          throw new Error('Expected <token> & got "nothing"');
        },
      },
    ],
  });
}

describe("JUnit XML reporter", () => {
  it("renders one testsuite per story and one testcase per scenario", async () => {
    const reporter = createReporter();
    const passing = passingScenario("auth-login", "Registered user logs in");
    await reporter.recordScenario(passing, await executeScenario(passing));

    const xml = formatExecutionRunReportAsJUnitXml(reporter.buildReport());

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<testsuites name="magpie" tests="1" failures="0" errors="0" skipped="0"',
    );
    expect(xml).toContain('<testsuite name="Authentication" tests="1" failures="0"');
    expect(xml).toContain('classname="Authentication" name="Registered user logs in"');
  });

  it("renders failures with the failing step and escapes XML characters", async () => {
    const reporter = createReporter();
    const failing = failingScenario();
    await reporter.recordScenario(failing, await executeScenario(failing));

    const xml = formatExecutionRunReportAsJUnitXml(reporter.buildReport());

    expect(xml).toContain('failures="1"');
    expect(xml).toContain("&lt;input&gt; &amp; co");
    expect(xml).toContain("Failed step: then login is rejected");
    expect(xml).toContain("Expected &lt;token&gt; &amp; got &quot;nothing&quot;");
    expect(xml).not.toContain("<input>");
  });

  it("reports failed quarantined scenarios as skipped", async () => {
    const reporter = createReporter();
    const quarantined = failingScenario(["quarantine"]);
    await reporter.recordScenario(quarantined, await executeScenario(quarantined));

    const xml = formatExecutionRunReportAsJUnitXml(reporter.buildReport());

    expect(xml).toContain('failures="0"');
    expect(xml).toContain('skipped="1"');
    expect(xml).toContain('<skipped message="quarantined');
  });

  it("createJUnitReporter writes the file on flush", async () => {
    const directory = await mkdtemp(join(tmpdir(), "magpie-junit-"));
    const outputPath = join(directory, "reports", "junit.xml");
    const reporter = createJUnitReporter({ outputPath, suiteName: "acceptance" });

    const passing = passingScenario("auth-login", "Registered user logs in");
    await reporter.recordScenario(passing, await executeScenario(passing));
    await reporter.flush();

    const written = await readFile(outputPath, "utf8");
    expect(written).toContain('<testsuites name="acceptance"');
    expect(written).toContain('name="Registered user logs in"');
  });

  it("emits [[ATTACHMENT|path]] in system-out when attachments are enabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "magpie-junit-attach-"));
    const scenario = defineAcceptanceScenario({
      id: "attached",
      title: "Scenario with an attachment",
      story: { title: "Authentication" },
      steps: [
        {
          name: "step emits an attachment",
          type: "when",
          execute: (_context, api) => {
            api.attach("notes.txt", "body");
          },
        },
      ],
    });

    const reporter = createReporter();
    await reporter.recordScenario(scenario, await executeScenario(scenario));

    const xml = formatExecutionRunReportAsJUnitXml(
      reporter.buildReport({ attachments: { enabled: true, directory } }),
    );

    expect(xml).toMatch(/<system-out>\[\[ATTACHMENT\|.*notes\.txt\]\]<\/system-out>/);
  });

  it("uses stories from defineStory groupings", async () => {
    const reporter = createReporter();
    const scenarioA = passingScenario("a", "A", "Story One");
    const scenarioB = passingScenario("b", "B", "Story Two");
    await reporter.recordScenario(scenarioA, await executeScenario(scenarioA));
    await reporter.recordScenario(scenarioB, await executeScenario(scenarioB));

    const xml = formatExecutionRunReportAsJUnitXml(
      reporter.buildReport({
        stories: [
          defineStory({ title: "Story One", scenarios: [scenarioA] }),
          defineStory({ title: "Story Two", scenarios: [scenarioB] }),
        ],
      }),
    );

    expect(xml).toContain('<testsuite name="Story One"');
    expect(xml).toContain('<testsuite name="Story Two"');
  });
});

# Magpie

Magpie is an acceptance-scenario framework built on top of Vitest.

It is not an assertion library and it does not replace Vitest. Its job is to model acceptance criteria as immutable scenario data, execute them through a runner-agnostic engine, and report the results with traceability back to requirements.

## Why it exists

- executable acceptance criteria
- reusable scenario steps
- traceability between requirements and tests
- rich execution results and reporting
- thin integration with Vitest instead of a replacement runtime

## Install

```bash
npm install
```

## Core concepts

Magpie separates description, execution, and reporting:

```text
Scenario data
  -> execution engine
  -> Vitest adapter
  -> reporter
```

Scenarios are defined as immutable data.

```ts
import { defineAcceptanceScenario } from "magpie";

const loginScenario = defineAcceptanceScenario({
  id: "auth-login",
  title: "Registered user logs in",
  acceptance: ["AUTH-001"],
  tags: ["auth", "critical"],
  steps: [
    {
      id: "given-user",
      name: "registered user exists",
      type: "given",
      execute: (context) => {
        context.user = { username: "alice" };
      },
    },
    {
      id: "when-login",
      name: "credentials are submitted",
      type: "when",
      execute: async (context) => {
        context.response = { status: 200, token: "token-123" };
      },
    },
    {
      id: "then-token",
      name: "token is returned",
      type: "then",
      execute: (context) => {
        if (context.response?.status !== 200) {
          throw new Error("Expected a successful login");
        }
      },
    },
  ],
});
```

The fluent builder is only a wrapper over the same internal model.

```ts
import { scenario } from "magpie";

const loginScenario = scenario<{ response?: { status: number; token?: string } }>(
  "auth-login",
  "Registered user logs in",
)
  .acceptance("AUTH-001")
  .tag("auth", "critical")
  .given({
    id: "given-user",
    name: "registered user exists",
    execute: () => undefined,
  })
  .when({
    id: "when-login",
    name: "credentials are submitted",
    execute: (context) => {
      context.response = { status: 200, token: "token-123" };
    },
  })
  .then({
    id: "then-token",
    name: "token is returned",
    execute: (context) => {
      if (!context.response?.token) {
        throw new Error("Expected a token");
      }
    },
  })
  .build();
```

## Running through Vitest

Use the Vitest adapter to map scenario data into `describe()` and `it()`.

```ts
import { registerScenario } from "magpie";

registerScenario(loginScenario);
```

Stories can be grouped and filtered.

```ts
import {
  defineStory,
  registerFilteredStory,
  resolveScenarioFilter,
} from "magpie";

const story = defineStory({
  title: "Authentication",
  scenarios: [loginScenario],
});

const filter = resolveScenarioFilter({
  argv: process.argv.slice(2),
  env: process.env,
});

registerFilteredStory(story, { filter });
```

## Gherkin and Cucumber

You can generate Magpie scenarios directly from Gherkin feature text and resolve steps with Cucumber expressions.

```ts
import {
  createGherkinStory,
  defineGherkinStep,
  registerFilteredStory,
} from "magpie";

const story = createGherkinStory(
  `
Feature: Authentication

  @auth @AUTH-001
  Scenario: Registered user logs in
    Given a registered user "alice"
    When the user logs in with password secret
    Then the response status is 200
`,
  {
    uri: "authentication.feature",
    stepDefinitions: [
      defineGherkinStep({
        expression: "a registered user {string}",
        execute: ({ arguments: [username], context }) => {
          context.user = username;
        },
      }),
      defineGherkinStep({
        expression: "the user logs in with password {word}",
        execute: ({ arguments: [password], context }) => {
          context.response = { status: password === "secret" ? 200 : 401 };
        },
      }),
      defineGherkinStep({
        expression: "the response status is {int}",
        execute: ({ arguments: [status], context }) => {
          if (context.response?.status !== status) {
            throw new Error("Unexpected response status");
          }
        },
      }),
    ],
  },
);

registerFilteredStory(story, {
  reportToVitest: true,
});
```

The importer expands scenario outlines, includes background steps, preserves Gherkin doc strings and data tables in step metadata, and extracts acceptance references from tags by prefix. The default prefix is `AUTH-`, and you can override it with `acceptanceTagPrefix`.

You can also load `.feature` files directly from disk:

```ts
import { createGherkinStoryFromFile, defineGherkinStep } from "magpie";

const story = await createGherkinStoryFromFile("./features/authentication.feature", {
  stepDefinitions: [
    defineGherkinStep({
      expression: "a registered user {string}",
      execute: () => undefined,
    }),
  ],
});
```

Acceptance references can also be extracted with tag and metadata patterns:

```ts
const story = await createGherkinStoryFromFile("./features/payments.feature", {
  acceptanceTagPattern: /acceptance\(([^)]+)\)/,
  acceptanceMetadataPattern: /PAY-\d+/g,
  stepDefinitions,
});
```

That supports conventions like `@acceptance(PAY-123)` and description lines such as `Acceptance: PAY-123` on the feature, rule, or scenario.

Supported CLI flags:

- `--tag auth`
- `--acceptance AUTH-*`
- `--story Authentication`
- `--scenario "Registered user logs in"`
- `--regex critical`
- `--grep critical`

Supported environment variables:

- `MAGPIE_TAGS=auth,critical`
- `MAGPIE_ACCEPTANCE=AUTH-*`
- `MAGPIE_STORY=Authentication`
- `MAGPIE_SCENARIO=Registered user logs in`
- `MAGPIE_REGEX=critical`

## Vitest reporter

This package now configures Vitest to use the Magpie custom reporter as the primary terminal reporter.

- `npm test` prints the Magpie acceptance report at the end of the run
- a JSON artifact is written automatically to `.magpie/reports/latest.json`
- every run is also archived under `.magpie/reports/history/`
- acceptance-style suites can opt in by using `reportToVitest: true`

Example:

```ts
import {
  defineStory,
  registerFilteredStory,
  resolveScenarioFilter,
} from "magpie";

const story = defineStory({
  title: "Authentication",
  scenarios: [loginScenario],
});

registerFilteredStory(story, {
  filter: resolveScenarioFilter({
    argv: process.argv.slice(2),
    env: process.env,
  }),
  reportToVitest: true,
});
```

Run specific suites with:

- `npm run test:unit`
- `npm run test:acceptance`

`test:unit` and `test:acceptance` now target separate named Vitest projects.

## CI artifacts

The repository includes a GitHub Actions workflow that:

- installs dependencies
- runs typecheck, unit tests, acceptance tests, and the full test run
- uploads `.magpie/reports/` as a build artifact

The latest report is always available at `.magpie/reports/latest.json`, while historical JSON reports are archived in `.magpie/reports/history/`.

## Reporting

Run the engine directly when you want rich programmatic results.

```ts
import {
  createAcceptanceTraceabilityReport,
  createStoryReport,
  defineStory,
  executeScenario,
  formatStoryReport,
  writeJsonReport,
} from "magpie";

const story = defineStory({
  title: "Authentication",
  scenarios: [loginScenario],
});

const results = await Promise.all(story.scenarios.map((scenario) => executeScenario(scenario)));
const storyReport = createStoryReport(story, results);
const traceability = createAcceptanceTraceabilityReport(story.scenarios, ["AUTH-001", "AUTH-007"]);

console.log(formatStoryReport(storyReport));

await writeJsonReport("./artifacts/authentication.report.json", storyReport);
await writeJsonReport("./artifacts/authentication.traceability.json", traceability);
```

For multi-scenario runs, use a reporter to collect scenario results incrementally and emit a final run report.

```ts
import {
  createConsoleReporter,
  createJsonReporter,
  createReportingHooks,
  defineStory,
  executeScenario,
} from "magpie";

const story = defineStory({
  title: "Authentication",
  scenarios: [loginScenario],
});

const consoleReporter = createConsoleReporter({
  stories: [story],
  expectedAcceptanceIds: ["AUTH-001", "AUTH-007"],
});

const jsonReporter = createJsonReporter({
  outputPath: "./artifacts/authentication.run.json",
  stories: [story],
  expectedAcceptanceIds: ["AUTH-001", "AUTH-007"],
});

for (const scenario of story.scenarios) {
  await executeScenario(scenario, {
    hooks: createReportingHooks(consoleReporter),
  });
}

await consoleReporter.flush();

for (const entry of consoleReporter.entries) {
  jsonReporter.recordScenario(entry.scenario, entry.result);
}

await jsonReporter.flush();
```

The Vitest adapter can also record scenario results by passing `reporter` into `registerScenario()`, `registerStory()`, or `registerFilteredStory()`.

## Hooks

The execution engine supports:

- `beforeScenario`
- `afterScenario`
- `beforeStep`
- `afterStep`

Use hooks directly with `executeScenario()`:

```ts
import { executeScenario } from "magpie";

await executeScenario(loginScenario, {
  hooks: {
    beforeScenario: (_scenario, context) => {
      context.started = true;
    },
    beforeStep: (step) => {
      console.log(`starting ${step.name}`);
    },
    afterStep: (step, _context, result) => {
      console.log(`${step.name}: ${result.status}`);
    },
    afterScenario: (_scenario, _context, result) => {
      console.log(result.success ? "scenario passed" : "scenario failed");
    },
  },
});
```

If you need to combine multiple hook sets, use `mergeExecutionHooks()`.

```ts
import { createReportingHooks, executeScenario, mergeExecutionHooks } from "magpie";

const hooks = mergeExecutionHooks(
  createReportingHooks(reporter),
  {
    beforeScenario: () => {
      console.log("scenario starting");
    },
  },
);

await executeScenario(loginScenario, { hooks });
```

## Project scripts

- `npm run typecheck`
- `npm test`
- `npm run test:unit`
- `npm run test:acceptance`
- `npm run build`

## Current scope

Implemented now:

- immutable scenario and story data model
- runner-agnostic execution engine
- Vitest adapter
- reusable steps and extensible step types
- hooks
- filtering
- reporting and JSON artifact output
- acceptance traceability

Not implemented yet:

- Gherkin generation
- HTML reporting
- live dashboards
- parallel dependency-aware scenario execution
- Playwright or non-Vitest adapters
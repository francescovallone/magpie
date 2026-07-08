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

## Sub-scenarios

A scenario with more than one `given` step is automatically split into
independent sub-scenarios: each `given` starts a new sub-scenario made up of
that `given` and every step up to (but excluding) the next `given` step, plus
any steps that come before the first `given` (e.g. `setup`). Sub-scenarios run
independently (each gets its own fresh context and result), but if any
sub-scenario fails, the parent scenario is reported as failed too.

Each sub-scenario is assigned an acceptance criteria id automatically by
appending a two-digit index to the scenario's own acceptance ids, e.g.
`AC-001` becomes `AC-001-01`, `AC-001-02`, etc. You can override this with a
custom id via the second argument to `given()`:

```ts
const checkoutScenario = scenario<{ status?: number }>("checkout", "Checkout flows")
  .acceptance("AC-001")
  .given({
    id: "given-valid-card",
    name: "customer has a valid card",
    execute: () => undefined,
  }) // -> AC-001-01
  .when({ id: "when-pay", name: "customer pays", execute: () => undefined })
  .then({ id: "then-success", name: "payment succeeds", execute: () => undefined })
  .given(
    {
      id: "given-expired-card",
      name: "customer has an expired card",
      execute: () => undefined,
    },
    { acceptance: "AC-001-EXPIRED" }, // custom id instead of AC-001-02
  )
  .when({ id: "when-pay-2", name: "customer pays", execute: () => undefined })
  .then({ id: "then-decline", name: "payment is declined", execute: () => undefined })
  .build();
```

`ScenarioExecutionResult.subScenarios` and `ScenarioReport.subScenarios` expose
the per-sub-scenario results, and acceptance traceability reports
(`createAcceptanceTraceabilityReport`, `buildExecutionRunReport`) use the
granular sub-scenario ids instead of the parent scenario's ids when present.

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

## Batch execution

Use `executeScenarios()` to run a scenario set with dependency-aware scheduling.

```ts
import { defineAcceptanceScenario, executeScenarios } from "magpie";

const seedInventory = defineAcceptanceScenario({
  id: "inventory-seeded",
  title: "Inventory is seeded",
  steps: [
    {
      id: "seed-inventory",
      name: "seed inventory",
      type: "given",
      execute: () => undefined,
    },
  ],
});

const loadPricing = defineAcceptanceScenario({
  id: "pricing-loaded",
  title: "Pricing is loaded",
  steps: [
    {
      id: "load-pricing",
      name: "load pricing",
      type: "given",
      execute: () => undefined,
    },
  ],
});

const openCheckout = defineAcceptanceScenario({
  id: "checkout-ready",
  title: "Checkout is ready",
  dependsOn: ["inventory-seeded", "pricing-loaded"],
  steps: [
    {
      id: "open-checkout",
      name: "open checkout",
      type: "when",
      execute: () => undefined,
    },
  ],
});

const batch = await executeScenarios([seedInventory, loadPricing, openCheckout], {
  maxConcurrency: 2,
  createContext: () => ({}),
});

console.log(batch.results.map((result) => result.scenarioId));
console.log(batch.skipped);
```

Dependencies are declared with `dependsOn`. Independent scenarios can run in parallel up to `maxConcurrency`, dependents wait for all prerequisites to finish, and downstream scenarios are skipped when an upstream dependency fails. For parallel runs, prefer `createContext()` so each scenario gets its own context object.

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

Vitest has no auto-discovery mechanism for reporters (unlike ESLint/Babel plugin resolution) — `test.reporters` is a plain array read from your config, so it must be wired up explicitly. `magpie` exposes both the low-level reporter and a Vite plugin that does that wiring for you.

### Option 1: `magpiePlugin()` (recommended)

Add it to `plugins` in `vite.config.ts`/`vitest.config.ts`. Its `config()` hook merges a `MagpieVitestReporter` into `test.reporters` automatically (Vite concatenates array-valued config returned from plugin hooks, so this composes with any reporters you already list instead of replacing them):

```ts
import { defineConfig } from "vitest/config";
import { magpiePlugin } from "magpie";

export default defineConfig({
  plugins: [
    magpiePlugin({
      jsonOutputFile: ".magpie/reports/latest.json",
      jsonArchiveDirectory: ".magpie/reports/history",
    }),
  ],
});
```

### Option 2: `createMagpieVitestReporter()` directly

If you'd rather control the `reporters` array yourself:

```ts
import { defineConfig } from "vitest/config";
import { createMagpieVitestReporter } from "magpie";

export default defineConfig({
  test: {
    reporters: [
      createMagpieVitestReporter({
        jsonOutputFile: ".magpie/reports/latest.json",
        jsonArchiveDirectory: ".magpie/reports/history",
      }),
    ],
  },
});
```

Either way, once configured:

- `npm test` prints the Magpie acceptance report at the end of the run
- a JSON artifact is written automatically to `.magpie/reports/latest.json`
- every run is also archived under `.magpie/reports/history/`, keeping the most recent 3 archives by default (override with `jsonHistoryLimit`/`htmlHistoryLimit`)
- acceptance-style suites can opt in by using `reportToVitest: true`
- pass `htmlOutputFile` (and optionally `htmlArchiveDirectory`) to also write a human-friendly HTML report, archived the same way as the JSON report

### Enabling the HTML report from the CLI

`vitest.config.ts` checks `isOutputEnabled("html", ...)` and only turns on `htmlOutputFile`/`htmlArchiveDirectory` when asked to, so the HTML report is opt-in.

Turn it on with either:

- an environment variable: `MAGPIE_OUTPUT=html npm test`
- a CLI flag through `npm test`: `npm test -- -- --output html`
- a CLI flag calling `vitest` directly: `vitest run -- --output html`

`--output` is a Magpie-specific flag, not a Vitest one, but Vitest's own CLI parser still rejects any flag it doesn't recognize, so `--output` always needs to come after a `--` that reaches Vitest. Calling `vitest` directly only needs one `--` (Vitest's own separator). Going through `npm test` needs two: the first `--` stops npm from parsing the flag itself, and the second is the one Vitest needs.

`resolveOutputKinds()` and `isOutputEnabled()` are exported from `magpie` so you can reuse the same argv/env parsing in your own config or scripts:

```ts
import { isOutputEnabled } from "magpie";

const htmlEnabled = isOutputEnabled("html", { argv: process.argv, env: process.env });
```

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

## Debugging a failed scenario

When a step throws, execution stops after that step (cleanup steps still run), and the failure is captured on the result instead of only a boolean pass/fail.

`executeScenario()` resolves with a `failure` object describing which step threw and the serialized error:

```ts
const result = await executeScenario(loginScenario);

// result.success === false
// result.failure === {
//   step: { id: "then-token", name: "token is returned", ... },
//   error: { name: "Error", message: "Expected a successful login", stack: "..." },
//   cause: Error: Expected a successful login
// }
```

Only steps that actually ran are present in `result.steps` — if the failing step is not the last one, later main steps are omitted entirely rather than marked "skipped"; cleanup steps still run and are appended after the failure.

The text report produced by `formatExecutionRunReport()` (and printed by the Magpie Vitest reporter, `createConsoleReporter`, etc.) prints the failing step's error message inline:

```text
Execution Report
  Scenarios: 0/1 passed
  Steps: 1/2 passed
  Duration: 4ms

Story
  Authentication

  Scenario
    Registered user logs in
      ✓ given registered user exists
      ✗ then token is returned
        ↳ Expected a successful login

Acceptance
  Implemented: AUTH-001
  Missing: none
```

The JSON artifact written to `.magpie/reports/latest.json` (and archived under `.magpie/reports/history/`) keeps the same information in structured form, with `error` set on the failing step and on the scenario (fields trimmed below for brevity):

```json
{
  "id": "auth-login",
  "title": "Registered user logs in",
  "status": "failed",
  "error": "Expected a successful login",
  "steps": [
    { "id": "given-user", "status": "passed" },
    { "id": "then-token", "status": "failed", "error": "Expected a successful login" }
  ]
}
```

When running through the Vitest adapter (`registerScenario`, `registerStory`, `registerFilteredStory`), a failed scenario also throws the original error inside the generated `it()` block, so Vitest's own failure output (stack trace, diff, etc.) still shows up alongside the Magpie report.

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

### HTML reporter

`createHtmlReporter()` works the same way as `createJsonReporter()`, but it writes a self-contained HTML page (inline CSS, no external dependencies) instead of JSON. It is a drop-in `AcceptanceReporter`, so it can be used on its own or alongside the console and JSON reporters.

```ts
import { createHtmlReporter, defineStory, executeScenario } from "magpie";

const story = defineStory({
  title: "Authentication",
  scenarios: [loginScenario],
});

const htmlReporter = createHtmlReporter({
  outputPath: "./artifacts/authentication.report.html",
  stories: [story],
  expectedAcceptanceIds: ["AUTH-001", "AUTH-007"],
});

for (const scenario of story.scenarios) {
  const result = await executeScenario(scenario);
  htmlReporter.recordScenario(scenario, result);
}

await htmlReporter.flush();
```

Open `./artifacts/authentication.report.html` in a browser to see the same totals, story/scenario breakdown, and per-step pass/fail/error details as the text report, laid out as a page. If you already have an `ExecutionRunReport` (for example from `buildExecutionRunReport()`), you can also turn it into an HTML string directly with `formatExecutionRunReportAsHtml(report)`, or write it to disk with `writeHtmlReport(outputPath, report)`.

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
- reporting, JSON artifact output, and HTML artifact output
- acceptance traceability

Not implemented yet:

- live dashboards
- Playwright or non-Vitest adapters
